from __future__ import annotations

import json
import sqlite3
from collections.abc import Generator
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pycore.core.config import ConfigManager
from src.db.models import Chunk
from src.db.session import AppSettings, reset_engine
from src.integrations.bailian import BailianError
from src.services.qa import (
    ClassifiedIssue,
    filter_chunks_for_issue,
    set_llm_override,
)

_TEST_SECRET = "test-secret-placeholder"
_TEST_PASSWORD = "it-help123"
_FALLBACK = "抱歉，这个问题我暂时无法根据现有知识准确回答。你可以换个说法再问，或点击转人工。"
_CUSTOM_FALLBACK = "这是配置里的兜底原文。"
_CLARIFY_QUESTION = "请问你说的是哪件商品？"


def _settings(database_path: str, fallback_reply: str = _FALLBACK) -> dict:
    return {
        "debug": True,
        "secret_key": _TEST_SECRET,
        "host": "127.0.0.1",
        "port": 8099,
        "cors_origins": [
            "http://localhost:5199",
            "http://127.0.0.1:5199",
            "http://localhost:5175",
            "http://127.0.0.1:5175",
        ],
        "database_path": database_path,
        "upload_dir": "data/uploads",
        "shared_username": "it-help",
        "shared_password": _TEST_PASSWORD,
        "jwt_expire_minutes": 720,
        "llm_api_key": "placeholder-llm-key",
        "llm_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "llm_model": "qwen-plus",
        "llm_temperature": 0.2,
        "llm_timeout_seconds": 45,
        "llm_max_retries": 2,
        "embedding_model": "text-embedding-v4",
        "embedding_dimensions": 1024,
        "embedding_batch_size": 10,
        "max_upload_bytes": 5242880,
        "chunk_max_chars": 800,
        "chunk_overlap_chars": 80,
        "ingest_max_chars": 24000,
        "context_message_limit": 20,
        "faq_hit_threshold": 0.82,
        "retrieve_top_k": 5,
        "retrieve_min_score": 0.55,
        "poll_interval_ms": 3000,
        "ingest_stale_seconds": 300,
        "fallback_reply": fallback_reply,
        "clarification_max_rounds": 5,
    }


class FakeLlm:
    def __init__(self) -> None:
        self.chat_calls: list[dict] = []
        self.embed_calls: list[list[str]] = []
        self.classify_raw: str | list[str] = ""
        self.text_raw: str = "根据分块，先检查显示器电源。"
        self.embed_vectors: list[list[float]] | None = None
        self.chat_error: Exception | None = None
        self.embed_error: Exception | None = None
        self._classify_i = 0

    async def chat_completions(
        self, messages: list[dict[str, str]], *, json_object: bool = False
    ) -> str:
        if self.chat_error is not None:
            raise self.chat_error
        self.chat_calls.append({"json_object": json_object, "messages": messages})
        if json_object:
            if isinstance(self.classify_raw, list):
                raw = self.classify_raw[min(self._classify_i, len(self.classify_raw) - 1)]
                self._classify_i += 1
                return raw
            return self.classify_raw
        return self.text_raw

    async def embeddings(self, inputs: list[str]) -> list[list[float]]:
        if self.embed_error is not None:
            raise self.embed_error
        self.embed_calls.append(list(inputs))
        if self.embed_vectors is not None:
            return [list(vec) for vec in self.embed_vectors]
        return [[1.0, 0.0, 0.0] for _ in inputs]


def _classify_json(
    *,
    rewritten: str | None = "补全后的问法",
    message_type: str = "service_request",
    status: str = "needs_clarification",
    issues: list[dict] | None = None,
    **issue_overrides: Any,
) -> str:
    if issues is None:
        issue: dict[str, Any] = {
            "issue_id": "1",
            "summary": "意图不清",
            "primary_object_type": None,
            "related_object_types": [],
            "request_type": None,
            "entities": [],
            "symptom": None,
            "error_message": None,
            "processing_status": status,
            "retrieval_query": None,
            "missing_information": ["对象"],
            "clarification_question": _CLARIFY_QUESTION,
        }
        issue.update(issue_overrides)
        issues = [issue]
    payload: dict = {"query_output": {"message_type": message_type, "issues": issues}}
    if rewritten is not None:
        payload["rewritten_query"] = rewritten
    return json.dumps(payload, ensure_ascii=False)


def _issue(
    *,
    issue_id: str,
    status: str,
    primary: str | None,
    retrieval: str,
    related: list[str] | None = None,
    request_type: str | None = "troubleshooting",
) -> dict:
    return {
        "issue_id": issue_id,
        "summary": retrieval,
        "primary_object_type": primary,
        "related_object_types": related or [],
        "request_type": request_type,
        "entities": [],
        "symptom": None,
        "error_message": None,
        "processing_status": status,
        "retrieval_query": retrieval,
        "missing_information": [],
        "clarification_question": None,
    }


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "test.db"


@pytest.fixture
def client(db_path: Path) -> Generator[TestClient, None, None]:
    ConfigManager.reset()
    reset_engine()
    ConfigManager().load_from_dict(AppSettings, _settings(str(db_path)))
    from src.main import app

    with TestClient(app) as test_client:
        yield test_client
    set_llm_override(None)
    reset_engine()
    ConfigManager.reset()


@pytest.fixture
def client_custom_fallback(db_path: Path) -> Generator[TestClient, None, None]:
    ConfigManager.reset()
    reset_engine()
    ConfigManager().load_from_dict(
        AppSettings, _settings(str(db_path), fallback_reply=_CUSTOM_FALLBACK)
    )
    from src.main import app

    with TestClient(app) as test_client:
        yield test_client
    set_llm_override(None)
    reset_engine()
    ConfigManager.reset()


@pytest.fixture
def fake_llm() -> Generator[FakeLlm, None, None]:
    fake = FakeLlm()
    set_llm_override(fake)
    yield fake
    set_llm_override(None)


def _auth_header(client: TestClient) -> dict[str, str]:
    login = client.post(
        "/api/sessions",
        json={"username": "it-help", "password": _TEST_PASSWORD},
    )
    token = login.json()["data"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _create_conversation(client: TestClient) -> tuple[dict[str, str], str]:
    headers = _auth_header(client)
    created = client.post("/api/conversations", headers=headers)
    assert created.status_code == 200
    return headers, created.json()["data"]["id"]


def _post_message(client: TestClient, headers: dict[str, str], conversation_id: str, content: str):
    return client.post(
        f"/api/conversations/{conversation_id}/messages",
        headers=headers,
        json={"content": content},
    )


def _insert_document(
    db_path: Path,
    *,
    doc_id: str,
    status: str,
    object_types: list[str],
    created_at: str,
    faqs: list[tuple[str, str, str, list[float]]] | None = None,
    chunks: list[tuple[str, str, list[str], list[float]]] | None = None,
) -> None:
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        INSERT INTO documents (
            id, filename, ingest_status, ingest_error,
            object_types_json, request_types_json, entities_json,
            created_at, updated_at
        ) VALUES (?, ?, ?, NULL, ?, ?, '[]', ?, ?)
        """,
        (
            doc_id,
            f"{doc_id}.md",
            status,
            json.dumps(object_types),
            json.dumps(["troubleshooting"]),
            created_at,
            created_at,
        ),
    )
    for faq_id, question, answer, embedding in faqs or []:
        conn.execute(
            """
            INSERT INTO faqs (id, document_id, question, answer, embedding)
            VALUES (?, ?, ?, ?, ?)
            """,
            (faq_id, doc_id, question, answer, json.dumps(embedding)),
        )
    for index, (chunk_id, content, chunk_objects, embedding) in enumerate(
        chunks or [], start=1
    ):
        conn.execute(
            """
            INSERT INTO chunks (
                id, document_id, position, heading_path, content,
                object_types_json, request_types_json, entities_json, embedding
            ) VALUES (?, ?, ?, '', ?, ?, ?, '[]', ?)
            """,
            (
                chunk_id,
                doc_id,
                index,
                content,
                json.dumps(chunk_objects),
                json.dumps(["troubleshooting"]),
                json.dumps(embedding),
            ),
        )
    conn.commit()
    conn.close()


def test_messages_require_bearer(client: TestClient) -> None:
    response = client.post(
        f"/api/conversations/{uuid4()}/messages",
        json={"content": "这款耳机怎么连两台手机"},
    )
    assert response.status_code == 401
    assert response.json()["error_code"] == "UNAUTHORIZED"


def test_empty_content_is_400(client: TestClient) -> None:
    headers, conversation_id = _create_conversation(client)
    response = _post_message(client, headers, conversation_id, "   ")
    assert response.status_code == 400
    assert response.json()["error_code"] == "VALIDATION_ERROR"


def test_missing_conversation_is_404(client: TestClient, fake_llm: FakeLlm) -> None:
    headers = _auth_header(client)
    response = _post_message(client, headers, str(uuid4()), "这款耳机怎么连两台手机")
    assert response.status_code == 404
    assert response.json()["error_code"] == "NOT_FOUND"
    assert fake_llm.chat_calls == []
    assert fake_llm.embed_calls == []


def test_handed_off_does_not_call_bailian(client: TestClient, fake_llm: FakeLlm) -> None:
    fake_llm.chat_error = AssertionError("不应调用 chat")
    fake_llm.embed_error = AssertionError("不应调用 embedding")
    headers, conversation_id = _create_conversation(client)
    transferred = client.post(
        f"/api/conversations/{conversation_id}/transfer", headers=headers
    )
    assert transferred.status_code == 200
    response = _post_message(client, headers, conversation_id, "这款耳机保修几年")
    assert response.status_code == 200
    body = response.json()
    reply = body["data"]["reply"]
    conversation = body["data"]["conversation"]
    assert reply["kind"] == "waiting_for_agent"
    assert reply["role"] == "system"
    assert conversation["status"] == "handed_off"
    assert conversation["waiting_for_agent"] is True
    employee = next(
        item for item in conversation["messages"] if item["kind"] == "employee_turn"
    )
    assert employee["original_content"] == "这款耳机保修几年"
    assert employee["rewritten_content"] is None
    assert fake_llm.chat_calls == []
    assert fake_llm.embed_calls == []

    second = _post_message(client, headers, conversation_id, "还是连不上")
    assert second.status_code == 200
    second_body = second.json()["data"]
    waiting_messages = [
        item
        for item in second_body["conversation"]["messages"]
        if item["kind"] == "waiting_for_agent"
    ]
    assert len(waiting_messages) == 1
    assert second_body["reply"]["kind"] == "waiting_for_agent"
    assert fake_llm.chat_calls == []


def test_six_needs_clarification_then_config_fallback(
    client_custom_fallback: TestClient, fake_llm: FakeLlm
) -> None:
    fake_llm.classify_raw = _classify_json(rewritten="连不上")
    headers, conversation_id = _create_conversation(client_custom_fallback)
    kinds: list[str] = []
    contents: list[str] = []
    rounds: list[int] = []
    for index in range(6):
        response = _post_message(
            client_custom_fallback, headers, conversation_id, f"连不上 {index}"
        )
        assert response.status_code == 200
        data = response.json()["data"]
        kinds.append(data["reply"]["kind"])
        contents.append(data["reply"]["content"])
        rounds.append(data["conversation"]["clarification_round"])
        employee = next(
            item
            for item in data["conversation"]["messages"]
            if item["content"] == f"连不上 {index}"
        )
        assert employee["kind"] == "employee_turn"
        assert employee["original_content"] == f"连不上 {index}"
        assert employee["rewritten_content"] == "连不上"
    assert kinds[:5] == ["clarification"] * 5
    assert contents[:5] == [_CLARIFY_QUESTION] * 5
    assert rounds[:5] == [1, 2, 3, 4, 5]
    assert kinds[5] == "fallback"
    assert contents[5] == _CUSTOM_FALLBACK
    assert rounds[5] == 0
    assert fake_llm.embed_calls == []
    assert all(call["json_object"] is True for call in fake_llm.chat_calls)


def test_rewrite_missing_uses_original(client: TestClient, fake_llm: FakeLlm) -> None:
    fake_llm.classify_raw = _classify_json(
        rewritten=None,
        status="out_of_scope",
        clarification_question=None,
        retrieval_query=None,
    )
    headers, conversation_id = _create_conversation(client)
    response = _post_message(client, headers, conversation_id, "今天天气怎么样")
    assert response.status_code == 200
    data = response.json()["data"]
    employee = next(
        item for item in data["conversation"]["messages"] if item["kind"] == "employee_turn"
    )
    assert employee["original_content"] == "今天天气怎么样"
    assert employee["rewritten_content"] == "今天天气怎么样"
    assert data["reply"]["kind"] == "fallback"
    assert data["reply"]["content"] == _FALLBACK


def test_classify_failure_is_502_keeps_employee(client: TestClient, fake_llm: FakeLlm) -> None:
    fake_llm.classify_raw = "not-json"
    headers, conversation_id = _create_conversation(client)
    response = _post_message(client, headers, conversation_id, "这款耳机怎么连两台手机")
    assert response.status_code == 502
    body = response.json()
    assert body["error_code"] == "INTERNAL_ERROR"
    assert body["error"] == "服务暂时不可用，请稍后重试。"
    assert body["error"] != _FALLBACK
    detail = client.get(f"/api/conversations/{conversation_id}", headers=headers)
    messages = detail.json()["data"]["messages"]
    assert len(messages) == 1
    assert messages[0]["kind"] == "employee_turn"
    assert messages[0]["original_content"] == "这款耳机怎么连两台手机"


def test_rate_limit_is_unavailable_not_fallback(client: TestClient, fake_llm: FakeLlm) -> None:
    fake_llm.chat_error = BailianError("HTTP 429", 429)
    headers, conversation_id = _create_conversation(client)
    response = _post_message(client, headers, conversation_id, "这款耳机怎么连两台手机")
    assert response.status_code == 502
    assert response.json()["error"] == "服务暂时不可用，请稍后重试。"


def test_faq_hits_only_ready_documents(
    client: TestClient, fake_llm: FakeLlm, db_path: Path
) -> None:
    fake_llm.classify_raw = _classify_json(
        rewritten="这款耳机能连两台手机吗",
        status="ready",
        primary_object_type="product_3c",
        retrieval_query="这款耳机能连两台手机吗",
        clarification_question=None,
    )
    fake_llm.embed_vectors = [[1.0, 0.0, 0.0]]
    headers, conversation_id = _create_conversation(client)
    _insert_document(
        db_path,
        doc_id="ingesting-doc",
        status="ingesting",
        object_types=["product_3c"],
        created_at="2026-01-01T00:00:00+00:00",
        faqs=[
            (
                "faq-ingesting",
                "这款耳机能连两台手机吗",
                "不应命中入库中 FAQ",
                [1.0, 0.0, 0.0],
            )
        ],
    )
    _insert_document(
        db_path,
        doc_id="failed-doc",
        status="failed",
        object_types=["product_3c"],
        created_at="2026-01-02T00:00:00+00:00",
        faqs=[
            (
                "faq-failed",
                "这款耳机能连两台手机吗",
                "不应命中失败 FAQ",
                [1.0, 0.0, 0.0],
            )
        ],
    )
    _insert_document(
        db_path,
        doc_id="ready-doc",
        status="ready",
        object_types=["product_3c"],
        created_at="2026-01-03T00:00:00+00:00",
        faqs=[
            (
                "faq-ready",
                "这款耳机能连两台手机吗",
                "就绪 FAQ 答案",
                [1.0, 0.0, 0.0],
            )
        ],
    )
    response = _post_message(client, headers, conversation_id, "这款耳机怎么连两台手机")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["reply"]["kind"] == "faq"
    assert data["reply"]["content"] == "就绪 FAQ 答案"
    assert data["conversation"]["status"] == "bot"
    text_calls = [call for call in fake_llm.chat_calls if call["json_object"] is False]
    assert text_calls == []


def test_tag_filter_skips_other_object_chunks(
    client: TestClient, fake_llm: FakeLlm, db_path: Path
) -> None:
    fake_llm.classify_raw = _classify_json(
        rewritten="这款耳机保修几年",
        issues=[
            _issue(
                issue_id="1",
                status="ready",
                primary="product_3c",
                related=["product_fashion"],
                retrieval="这款耳机保修几年",
                request_type="policy_process",
            )
        ],
    )
    fake_llm.embed_vectors = [[0.7, 0.8, 0.0]]
    fake_llm.text_raw = "耳机保修两年，只换不修。"
    headers, conversation_id = _create_conversation(client)
    _insert_document(
        db_path,
        doc_id="doc-3c",
        status="ready",
        object_types=["product_3c"],
        created_at="2026-01-01T00:00:00+00:00",
        chunks=[
            ("chunk-3c", "耳机保修两年，只换不修。", ["product_3c"], [1.0, 0.0, 0.0]),
        ],
    )
    _insert_document(
        db_path,
        doc_id="doc-fashion",
        status="ready",
        object_types=["product_fashion"],
        created_at="2026-01-02T00:00:00+00:00",
        chunks=[
            (
                "chunk-fashion",
                "连衣裙七天无理由退货。",
                ["product_fashion"],
                [0.0, 1.0, 0.0],
            ),
        ],
    )
    response = _post_message(client, headers, conversation_id, "这款耳机保修几年")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["reply"]["kind"] == "knowledge"
    answer_calls = [call for call in fake_llm.chat_calls if call["json_object"] is False]
    assert len(answer_calls) == 1
    prompt = answer_calls[0]["messages"][1]["content"]
    assert "耳机保修两年，只换不修。" in prompt
    assert "连衣裙七天无理由退货。" not in prompt
    assert "chunk-3c" in prompt
    assert "chunk-fashion" not in prompt


def test_multi_issue_returns_one_knowledge_reply(
    client: TestClient, fake_llm: FakeLlm, db_path: Path
) -> None:
    fake_llm.classify_raw = _classify_json(
        rewritten="耳机规格以及连衣裙退货时限",
        issues=[
            _issue(
                issue_id="1",
                status="ready",
                primary="product_3c",
                retrieval="这款耳机的规格是什么",
                request_type="pre_sale_consult",
            ),
            _issue(
                issue_id="2",
                status="ready",
                primary="product_fashion",
                retrieval="连衣裙退货时限是多久",
                request_type="policy_process",
            ),
        ],
    )
    fake_llm.embed_vectors = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]
    fake_llm.text_raw = "第一段：耳机支持双设备。\n第二段：连衣裙七天可退。"
    headers, conversation_id = _create_conversation(client)
    _insert_document(
        db_path,
        doc_id="doc-3c",
        status="ready",
        object_types=["product_3c"],
        created_at="2026-01-01T00:00:00+00:00",
        chunks=[("chunk-3c", "耳机支持同时连接两台手机。", ["product_3c"], [1.0, 0.0, 0.0])],
    )
    _insert_document(
        db_path,
        doc_id="doc-fashion",
        status="ready",
        object_types=["product_fashion"],
        created_at="2026-01-02T00:00:00+00:00",
        chunks=[
            ("chunk-fashion", "连衣裙七天无理由退货。", ["product_fashion"], [0.0, 1.0, 0.0])
        ],
    )
    response = _post_message(
        client, headers, conversation_id, "耳机规格是什么，连衣裙退货时限多久"
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["reply"]["kind"] == "knowledge"
    system_messages = [
        item for item in data["conversation"]["messages"] if item["role"] == "system"
    ]
    assert len(system_messages) == 1
    assert data["reply"]["content"] == "第一段：耳机支持双设备。\n第二段：连衣裙七天可退。"


def test_small_talk_does_not_retrieve(client: TestClient, fake_llm: FakeLlm) -> None:
    fake_llm.classify_raw = _classify_json(
        rewritten="你好",
        message_type="small_talk",
        issues=[],
    )
    fake_llm.text_raw = "你好，有购物问题随时问我。"
    headers, conversation_id = _create_conversation(client)
    response = _post_message(client, headers, conversation_id, "你好")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["reply"]["kind"] == "small_talk"
    assert data["reply"]["content"] == "你好，有购物问题随时问我。"
    assert fake_llm.embed_calls == []


def test_filter_chunks_requires_object_tags() -> None:
    chunk_3c = Chunk(
        id="c3c",
        document_id="d1",
        position=1,
        heading_path="",
        content="3C 保修",
        object_types_json=["product_3c"],
        request_types_json=["policy_process"],
        entities_json=[],
        embedding=[1.0, 0.0],
    )
    chunk_fashion = Chunk(
        id="cfashion",
        document_id="d2",
        position=1,
        heading_path="",
        content="服饰退货",
        object_types_json=["product_fashion"],
        request_types_json=["policy_process"],
        entities_json=[],
        embedding=[0.0, 1.0],
    )
    issue = ClassifiedIssue(
        issue_id="1",
        summary="耳机保修",
        primary_object_type="product_3c",
        related_object_types=["product_fashion"],
        request_type="policy_process",
        entities=[],
        symptom=None,
        error_message=None,
        processing_status="ready",
        retrieval_query="这款耳机保修几年",
        missing_information=[],
        clarification_question=None,
    )
    matched = filter_chunks_for_issue([chunk_3c, chunk_fashion], issue)
    assert [item.id for item in matched] == ["c3c"]
    empty = ClassifiedIssue(
        issue_id="2",
        summary="不清",
        primary_object_type=None,
        related_object_types=[],
        request_type=None,
        entities=[],
        symptom=None,
        error_message=None,
        processing_status="ready",
        retrieval_query=None,
        missing_information=[],
        clarification_question=None,
    )
    assert filter_chunks_for_issue([chunk_3c, chunk_fashion], empty) == []


def test_fallback_reply_comes_from_config_only() -> None:
    qa_text = Path("backend/src/services/qa.py").read_text(encoding="utf-8")
    assert _FALLBACK not in qa_text
    assert "dashscope" not in qa_text.lower()
    assert "plugin" not in qa_text.lower()
    assert "工单" not in qa_text


def _ticket_row_count(db_path: Path) -> int:
    conn = sqlite3.connect(db_path)
    try:
        names = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        if "tickets" not in names:
            return 0
        return int(conn.execute("SELECT COUNT(*) FROM tickets").fetchone()[0])
    finally:
        conn.close()


def test_bot_turn_does_not_insert_tickets(
    client: TestClient, fake_llm: FakeLlm, db_path: Path
) -> None:
    fake_llm.classify_raw = _classify_json(
        rewritten="我的订单现在到哪了",
        status="requires_live_data",
        clarification_question=None,
        retrieval_query=None,
    )
    headers, conversation_id = _create_conversation(client)
    response = _post_message(client, headers, conversation_id, "我的订单现在到哪了")
    assert response.status_code == 200
    assert response.json()["data"]["conversation"]["status"] == "bot"
    assert response.json()["data"]["reply"]["kind"] == "fallback"
    assert _ticket_row_count(db_path) == 0
    embed_after = list(fake_llm.embed_calls)
    assert embed_after == []


def test_live_data_and_out_of_scope_use_same_config_fallback(
    client_custom_fallback: TestClient, fake_llm: FakeLlm
) -> None:
    fake_llm.classify_raw = _classify_json(
        rewritten="物流到哪了",
        status="requires_live_data",
        clarification_question=None,
        retrieval_query=None,
    )
    headers, conversation_id = _create_conversation(client_custom_fallback)
    live = _post_message(client_custom_fallback, headers, conversation_id, "物流到哪了")
    assert live.status_code == 200
    assert live.json()["data"]["reply"]["kind"] == "fallback"
    assert live.json()["data"]["reply"]["content"] == _CUSTOM_FALLBACK
    assert fake_llm.embed_calls == []

    fake_llm.classify_raw = _classify_json(
        rewritten="公司 VPN 怎么连",
        status="out_of_scope",
        clarification_question=None,
        retrieval_query=None,
    )
    scope = _post_message(
        client_custom_fallback, headers, conversation_id, "公司 VPN 怎么连"
    )
    assert scope.status_code == 200
    assert scope.json()["data"]["reply"]["kind"] == "fallback"
    assert scope.json()["data"]["reply"]["content"] == _CUSTOM_FALLBACK
    assert fake_llm.embed_calls == []
    text_calls = [call for call in fake_llm.chat_calls if call["json_object"] is False]
    assert text_calls == []


def test_existing_create_and_reply_routes_still_work(client: TestClient) -> None:
    headers, conversation_id = _create_conversation(client)
    listed = client.get("/api/conversations", headers=headers)
    assert listed.status_code == 200
    assert conversation_id not in [item["id"] for item in listed.json()["data"]]
    transferred = client.post(
        f"/api/conversations/{conversation_id}/transfer", headers=headers
    )
    assert transferred.json()["data"]["status"] == "handed_off"
    reply = client.post(
        f"/api/conversations/{conversation_id}/replies",
        headers=headers,
        json={"content": "客服已接手"},
    )
    assert reply.status_code == 200
    assert reply.json()["data"]["reply"]["kind"] == "agent"
