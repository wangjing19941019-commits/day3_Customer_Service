from __future__ import annotations

import json
import sqlite3
from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pycore.core.config import ConfigManager
from src.db.session import AppSettings, reset_engine
from src.integrations.bailian import BailianError
from src.services.agent_knowledge import set_knowledge_llm_override
from src.services.ticket import set_extract_llm_override

_TEST_SECRET = "test-secret-placeholder"
_TEST_PASSWORD = "it-help123"
_EMPTY_MESSAGE = "当前没有可推送的政策或流程"
_UNAVAILABLE = "服务暂时不可用，请稍后重试。"
_ENVELOPE = {
    "success",
    "data",
    "error",
    "error_code",
    "message",
    "timestamp",
    "request_id",
    "metadata",
}
_SUGGESTION_KEYS = {
    "conversation_id",
    "ticket_type",
    "business_line",
    "business_line_locked",
    "suggestions",
    "empty_message",
}
_ITEM_KEYS = {
    "document_id",
    "filename",
    "heading_path",
    "main_answer",
    "summary",
    "source",
    "effective_from",
    "effective_to",
    "applicable_category",
    "visibility",
}
_HIT_VECTOR = [1.0, 0.0, 0.0]
_MISS_VECTOR = [0.0, 1.0, 0.0]
_HIGH_RISK_ANSWER = "屏幕进液高风险赔付内部口径，不得自动发给用户。"
_EFFECTIVE_FROM = "2026-01-01T00:00:00+00:00"
_EFFECTIVE_TO = "2027-12-31T23:59:59+00:00"


def _settings(database_path: str, llm_api_key: str = "placeholder-llm-key") -> dict:
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
        "llm_api_key": llm_api_key,
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
        "chunk_overlap_chars": 160,
        "ingest_max_chars": 24000,
        "context_message_limit": 20,
        "faq_hit_threshold": 0.82,
        "retrieve_top_k": 5,
        "retrieve_min_score": 0.55,
        "poll_interval_ms": 3000,
        "ingest_stale_seconds": 300,
        "fallback_reply": (
            "抱歉，这个问题我暂时无法根据现有知识准确回答。你可以换个说法再问，或点击转人工。"
        ),
        "clarification_max_rounds": 5,
    }


class FakeKnowledgeLlm:
    def __init__(self) -> None:
        self.embed_calls: list[list[str]] = []
        self.embed_vectors: list[list[float]] | None = None
        self.embed_error: Exception | None = None
        self.chat_calls: list[dict] = []

    async def embeddings(self, inputs: list[str]) -> list[list[float]]:
        if self.embed_error is not None:
            raise self.embed_error
        self.embed_calls.append(list(inputs))
        if self.embed_vectors is not None:
            return [list(vec) for vec in self.embed_vectors]
        return [_HIT_VECTOR for _ in inputs]

    async def chat_completions(
        self, messages: list[dict[str, str]], *, json_object: bool = False
    ) -> str:
        self.chat_calls.append({"json_object": json_object, "messages": messages})
        return json.dumps(
            {
                "order_no": None,
                "product_info": None,
                "amount": None,
                "intent_summary": "要求退货",
                "return_method": "return_only",
                "return_reason": None,
                "quantity": None,
            },
            ensure_ascii=False,
        )


def _assert_envelope(body: dict, *, success: bool) -> None:
    assert _ENVELOPE.issubset(body)
    assert body["success"] is success
    if success:
        assert body["error"] is None
        assert body["error_code"] is None
        assert body["message"] == "ok"
        assert body["data"] is not None
    else:
        assert body["data"] is None
        assert body["error_code"]
        assert body["error"]


def _assert_item_shape(item: dict) -> None:
    assert set(item) == _ITEM_KEYS
    assert item["main_answer"]
    assert item["summary"]
    assert item["source"]
    assert " / " in item["source"] or item["source"] == item["filename"]
    assert item["visibility"] in {"user_visible", "agent_only", "high_risk_human_only"}
    assert "embedding" not in item
    assert "content" not in item


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "test.db"


@pytest.fixture
def fake_llm() -> Generator[FakeKnowledgeLlm, None, None]:
    fake = FakeKnowledgeLlm()
    set_knowledge_llm_override(fake)
    set_extract_llm_override(fake)
    yield fake
    set_knowledge_llm_override(None)
    set_extract_llm_override(None)


@pytest.fixture
def client(db_path: Path, fake_llm: FakeKnowledgeLlm) -> Generator[TestClient, None, None]:
    ConfigManager.reset()
    reset_engine()
    set_knowledge_llm_override(fake_llm)
    set_extract_llm_override(fake_llm)
    ConfigManager().load_from_dict(AppSettings, _settings(str(db_path)))
    from src.main import app

    with TestClient(app) as test_client:
        yield test_client
    set_knowledge_llm_override(None)
    set_extract_llm_override(None)
    reset_engine()
    ConfigManager.reset()


@pytest.fixture
def client_no_key(db_path: Path) -> Generator[TestClient, None, None]:
    ConfigManager.reset()
    reset_engine()
    set_knowledge_llm_override(None)
    set_extract_llm_override(None)
    ConfigManager().load_from_dict(AppSettings, _settings(str(db_path), llm_api_key=""))
    from src.main import app

    with TestClient(app) as test_client:
        yield test_client
    set_knowledge_llm_override(None)
    set_extract_llm_override(None)
    reset_engine()
    ConfigManager.reset()


def _auth_header(client: TestClient) -> dict[str, str]:
    login = client.post(
        "/api/sessions",
        json={"username": "it-help", "password": _TEST_PASSWORD},
    )
    token = login.json()["data"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _open_handed_off(client: TestClient) -> tuple[dict[str, str], str]:
    headers = _auth_header(client)
    created = client.post("/api/conversations", headers=headers)
    conversation_id = created.json()["data"]["id"]
    transferred = client.post(f"/api/conversations/{conversation_id}/transfer", headers=headers)
    assert transferred.status_code == 200
    return headers, conversation_id


def _knowledge_url(conversation_id: str) -> str:
    return f"/api/conversations/{conversation_id}/knowledge-suggestions"


def _message_ids(client: TestClient, headers: dict[str, str], conversation_id: str) -> list[str]:
    detail = client.get(f"/api/conversations/{conversation_id}", headers=headers)
    assert detail.status_code == 200
    return [item["id"] for item in detail.json()["data"]["messages"]]


def _insert_ready_chunk(
    db_path: Path,
    *,
    doc_id: str,
    filename: str,
    chunk_id: str,
    heading_path: str,
    content: str,
    object_types: list[str],
    created_at: str,
    request_types: list[str] | None = None,
    visibility: str | None = "user_visible",
    effective_from: str | None = _EFFECTIVE_FROM,
    effective_to: str | None = _EFFECTIVE_TO,
    embedding: list[float] | None = None,
) -> None:
    types = request_types if request_types is not None else ["policy_process"]
    vector = embedding if embedding is not None else _HIT_VECTOR
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        INSERT INTO documents (
            id, filename, ingest_status, ingest_error,
            object_types_json, request_types_json, entities_json,
            visibility, effective_from, effective_to,
            created_at, updated_at
        ) VALUES (?, ?, 'ready', NULL, ?, ?, '[]', ?, ?, ?, ?, ?)
        """,
        (
            doc_id,
            filename,
            json.dumps(object_types),
            json.dumps(types),
            visibility,
            effective_from,
            effective_to,
            created_at,
            created_at,
        ),
    )
    conn.execute(
        """
        INSERT INTO chunks (
            id, document_id, position, heading_path, content,
            object_types_json, request_types_json, entities_json, embedding
        ) VALUES (?, ?, 1, ?, ?, ?, ?, '[]', ?)
        """,
        (
            chunk_id,
            doc_id,
            heading_path,
            content,
            json.dumps(object_types),
            json.dumps(types),
            json.dumps(vector),
        ),
    )
    conn.commit()
    conn.close()


def _seed_line_chunks(db_path: Path) -> None:
    _insert_ready_chunk(
        db_path,
        doc_id="doc-3c",
        filename="3c-warranty.md",
        chunk_id="chunk-3c",
        heading_path="3C 数码 / 质保年限",
        content="手机只换不修，质保年限内凭发票办理保修，不支持服饰七天口径。",
        object_types=["return_exchange", "product_3c"],
        created_at="2026-01-01T00:00:00+00:00",
    )
    _insert_ready_chunk(
        db_path,
        doc_id="doc-fashion",
        filename="apparel-return-policy.md",
        chunk_id="chunk-fashion",
        heading_path="服饰美妆 / 七天无理由退货",
        content="签收后七日内可无理由退货，吊牌完整即可。",
        object_types=["return_exchange", "product_fashion"],
        created_at="2026-01-02T00:00:00+00:00",
    )


def test_agent_knowledge_top_k_defaults_to_three() -> None:
    ConfigManager.reset()
    settings = AppSettings.model_validate(_settings("data/tmp-test.db"))
    assert settings.agent_knowledge_top_k == 3
    ConfigManager.reset()


def test_env_example_has_placeholder_top_k() -> None:
    text = Path("backend/.env.example").read_text(encoding="utf-8")
    assert "agent_knowledge_top_k=3" in text
    assert "llm_api_key=your-llm-api-key" in text
    assert "sk-" not in text


def test_knowledge_requires_bearer(client: TestClient) -> None:
    response = client.get(_knowledge_url(str(uuid4())))
    assert response.status_code == 401
    body = response.json()
    _assert_envelope(body, success=False)
    assert body["error_code"] == "UNAUTHORIZED"


def test_bot_session_knowledge_is_409(client: TestClient) -> None:
    headers = _auth_header(client)
    created = client.post("/api/conversations", headers=headers)
    conversation_id = created.json()["data"]["id"]
    response = client.get(_knowledge_url(conversation_id), headers=headers)
    assert response.status_code == 409
    body = response.json()
    _assert_envelope(body, success=False)
    assert body["error_code"] == "CONFLICT"
    still = client.get(f"/api/conversations/{conversation_id}", headers=headers)
    assert still.json()["data"]["status"] == "bot"
    assert still.json()["data"]["messages"] == []


def test_missing_conversation_knowledge_is_404(client: TestClient) -> None:
    headers = _auth_header(client)
    response = client.get(_knowledge_url(str(uuid4())), headers=headers)
    assert response.status_code == 404
    body = response.json()
    _assert_envelope(body, success=False)
    assert body["error_code"] == "NOT_FOUND"
    assert body["error"] == "会话不存在"


def test_handed_off_empty_library_does_not_write_messages(
    client: TestClient, fake_llm: FakeKnowledgeLlm
) -> None:
    headers, conversation_id = _open_handed_off(client)
    before = _message_ids(client, headers, conversation_id)
    embed_before = len(fake_llm.embed_calls)
    response = client.get(_knowledge_url(conversation_id), headers=headers)
    assert response.status_code == 200
    body = response.json()
    _assert_envelope(body, success=True)
    data = body["data"]
    assert set(data) == _SUGGESTION_KEYS
    assert data["conversation_id"] == conversation_id
    assert data["suggestions"] == []
    assert data["empty_message"] == _EMPTY_MESSAGE
    assert data["business_line_locked"] is False
    after = _message_ids(client, headers, conversation_id)
    assert after == before
    assert len(fake_llm.embed_calls) == embed_before


def test_business_line_switch_changes_knowledge_scope(
    client: TestClient, fake_llm: FakeKnowledgeLlm, db_path: Path
) -> None:
    headers, conversation_id = _open_handed_off(client)
    client.post(
        f"/api/conversations/{conversation_id}/messages",
        headers=headers,
        json={"content": "这件衣服能退吗"},
    )
    ticket_url = f"/api/conversations/{conversation_id}/ticket"
    patched = client.patch(
        ticket_url,
        headers=headers,
        json={"ticket_type": "return_exchange", "business_line": "digital_3c"},
    )
    assert patched.status_code == 200
    _seed_line_chunks(db_path)
    fake_llm.embed_vectors = [_HIT_VECTOR]

    first = client.get(_knowledge_url(conversation_id), headers=headers)
    assert first.status_code == 200
    data = first.json()["data"]
    assert set(data) == _SUGGESTION_KEYS
    assert data["empty_message"] is None
    assert data["business_line"] == "digital_3c"
    assert data["business_line_locked"] is True
    assert data["ticket_type"] == "return_exchange"
    answers = [item["main_answer"] for item in data["suggestions"]]
    headings = [item["heading_path"] for item in data["suggestions"]]
    ids = [item["document_id"] for item in data["suggestions"]]
    assert "doc-3c" in ids
    assert "doc-fashion" not in ids
    assert any("质保年限" in text or "只换不修" in text for text in answers + headings)
    for item in data["suggestions"]:
        _assert_item_shape(item)
        assert item["applicable_category"] == "3C数码"
        assert "七天无理由" not in item["heading_path"]

    switched = client.patch(
        ticket_url,
        headers=headers,
        json={"business_line": "apparel_beauty"},
    )
    assert switched.status_code == 200
    before_ids = _message_ids(client, headers, conversation_id)
    second = client.get(_knowledge_url(conversation_id), headers=headers)
    assert second.status_code == 200
    fashion = second.json()["data"]
    assert fashion["business_line"] == "apparel_beauty"
    assert fashion["empty_message"] is None
    fashion_ids = [item["document_id"] for item in fashion["suggestions"]]
    assert "doc-fashion" in fashion_ids
    assert "doc-3c" not in fashion_ids
    fashion_text = " ".join(
        item["heading_path"] + " " + item["main_answer"] for item in fashion["suggestions"]
    )
    assert "七天无理由" in fashion_text
    for item in fashion["suggestions"]:
        _assert_item_shape(item)
        assert item["applicable_category"] == "服饰美妆"
    assert _message_ids(client, headers, conversation_id) == before_ids


def test_expired_policy_is_not_current_basis(
    client: TestClient, fake_llm: FakeKnowledgeLlm, db_path: Path
) -> None:
    headers, conversation_id = _open_handed_off(client)
    client.post(
        f"/api/conversations/{conversation_id}/messages",
        headers=headers,
        json={"content": "衣服七天无理由还能退吗"},
    )
    client.patch(
        f"/api/conversations/{conversation_id}/ticket",
        headers=headers,
        json={"ticket_type": "return_exchange", "business_line": "apparel_beauty"},
    )
    now = datetime.now(UTC)
    _insert_ready_chunk(
        db_path,
        doc_id="doc-expired",
        filename="expired-return.md",
        chunk_id="chunk-expired",
        heading_path="服饰美妆 / 过期退货政策",
        content="旧版退货：签收后十五日内可退，已过期请勿引用。",
        object_types=["return_exchange", "product_fashion"],
        created_at="2025-01-01T00:00:00+00:00",
        effective_from=(now - timedelta(days=400)).isoformat(),
        effective_to=(now - timedelta(days=10)).isoformat(),
    )
    _insert_ready_chunk(
        db_path,
        doc_id="doc-current",
        filename="current-return.md",
        chunk_id="chunk-current",
        heading_path="服饰美妆 / 现行七天无理由",
        content="现行政策：签收后七日内可无理由退货。",
        object_types=["return_exchange", "product_fashion"],
        created_at="2026-01-02T00:00:00+00:00",
    )
    _insert_ready_chunk(
        db_path,
        doc_id="doc-undated",
        filename="undated-return.md",
        chunk_id="chunk-undated",
        heading_path="服饰美妆 / 未填生效时间",
        content="未填日期的退货政策不得作为当前依据。",
        object_types=["return_exchange", "product_fashion"],
        created_at="2026-01-03T00:00:00+00:00",
        effective_from=None,
        effective_to=None,
    )
    fake_llm.embed_vectors = [_HIT_VECTOR]
    response = client.get(_knowledge_url(conversation_id), headers=headers)
    assert response.status_code == 200
    data = response.json()["data"]
    ids = [item["document_id"] for item in data["suggestions"]]
    assert "doc-current" in ids
    assert "doc-expired" not in ids
    assert "doc-undated" not in ids
    for item in data["suggestions"]:
        _assert_item_shape(item)


def test_search_query_returns_same_provenance_fields(
    client: TestClient, fake_llm: FakeKnowledgeLlm, db_path: Path
) -> None:
    headers, conversation_id = _open_handed_off(client)
    client.patch(
        f"/api/conversations/{conversation_id}/ticket",
        headers=headers,
        json={"ticket_type": "return_exchange", "business_line": "apparel_beauty"},
    )
    _seed_line_chunks(db_path)
    _insert_ready_chunk(
        db_path,
        doc_id="doc-agent-only",
        filename="agent-return-steps.md",
        chunk_id="chunk-agent-only",
        heading_path="服饰美妆 / 仅坐席退货步骤",
        content="坐席内部：先核吊牌再登记退货流程。",
        object_types=["return_exchange", "product_fashion"],
        created_at="2026-01-04T00:00:00+00:00",
        visibility="agent_only",
        request_types=["after_sale_howto"],
    )
    fake_llm.embed_vectors = [_HIT_VECTOR]
    before = _message_ids(client, headers, conversation_id)
    response = client.get(
        _knowledge_url(conversation_id),
        headers=headers,
        params={"q": "退货流程"},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert set(data) == _SUGGESTION_KEYS
    assert data["empty_message"] is None
    assert fake_llm.embed_calls[-1] == ["退货流程"]
    ids = [item["document_id"] for item in data["suggestions"]]
    assert "doc-3c" not in ids
    assert "doc-fashion" in ids or "doc-agent-only" in ids
    visibilities = {item["visibility"] for item in data["suggestions"]}
    assert visibilities <= {"user_visible", "agent_only", "high_risk_human_only"}
    for item in data["suggestions"]:
        _assert_item_shape(item)
        assert item["applicable_category"] == "服饰美妆"
    assert _message_ids(client, headers, conversation_id) == before


def test_no_key_with_chunks_is_502_then_api012_still_sends(
    client_no_key: TestClient, db_path: Path
) -> None:
    headers, conversation_id = _open_handed_off(client_no_key)
    client_no_key.post(
        f"/api/conversations/{conversation_id}/messages",
        headers=headers,
        json={"content": "手机保修怎么办理"},
    )
    client_no_key.patch(
        f"/api/conversations/{conversation_id}/ticket",
        headers=headers,
        json={"ticket_type": "return_exchange", "business_line": "digital_3c"},
    )
    _seed_line_chunks(db_path)
    before = _message_ids(client_no_key, headers, conversation_id)
    response = client_no_key.get(_knowledge_url(conversation_id), headers=headers)
    assert response.status_code == 502
    body = response.json()
    _assert_envelope(body, success=False)
    assert body["error_code"] == "INTERNAL_ERROR"
    assert body["error"] == _UNAVAILABLE
    assert _message_ids(client_no_key, headers, conversation_id) == before

    original = "请把订单号发一下，我们按流程登记。"
    sent = client_no_key.post(
        f"/api/conversations/{conversation_id}/replies",
        headers=headers,
        json={"content": original},
    )
    assert sent.status_code == 200
    assert sent.json()["data"]["reply"]["content"] == original
    assert sent.json()["data"]["reply"]["role"] == "agent"


def test_embed_failure_is_502_not_fabricated_policy(
    client: TestClient, fake_llm: FakeKnowledgeLlm, db_path: Path
) -> None:
    headers, conversation_id = _open_handed_off(client)
    client.post(
        f"/api/conversations/{conversation_id}/messages",
        headers=headers,
        json={"content": "投诉怎么升级"},
    )
    client.patch(
        f"/api/conversations/{conversation_id}/ticket",
        headers=headers,
        json={"ticket_type": "complaint", "business_line": "digital_3c"},
    )
    _insert_ready_chunk(
        db_path,
        doc_id="doc-complaint",
        filename="complaint.md",
        chunk_id="chunk-complaint",
        heading_path="投诉维权 / 处理时限",
        content="投诉处理时限以书面政策为准。",
        object_types=["complaint", "product_3c"],
        created_at="2026-01-03T00:00:00+00:00",
    )
    fake_llm.embed_error = BailianError("调用超时")
    response = client.get(_knowledge_url(conversation_id), headers=headers)
    assert response.status_code == 502
    body = response.json()
    _assert_envelope(body, success=False)
    assert body["error"] == _UNAVAILABLE
    assert "时限" not in (body["error"] or "")


def _seed_high_risk_unrelated(db_path: Path) -> None:
    _seed_line_chunks(db_path)
    _insert_ready_chunk(
        db_path,
        doc_id="doc-high-risk",
        filename="t045-high-risk.md",
        chunk_id="chunk-high-risk",
        heading_path="3C 数码 / 屏幕进液高风险赔付",
        content=_HIGH_RISK_ANSWER,
        object_types=["return_exchange", "product_fashion"],
        created_at="2026-01-05T00:00:00+00:00",
        visibility="high_risk_human_only",
        embedding=_MISS_VECTOR,
    )


def test_auto_push_does_not_force_unrelated_high_risk(
    client: TestClient, fake_llm: FakeKnowledgeLlm, db_path: Path
) -> None:
    headers, conversation_id = _open_handed_off(client)
    client.post(
        f"/api/conversations/{conversation_id}/messages",
        headers=headers,
        json={"content": "这件衣服能退吗"},
    )
    client.patch(
        f"/api/conversations/{conversation_id}/ticket",
        headers=headers,
        json={"ticket_type": "return_exchange", "business_line": "apparel_beauty"},
    )
    _seed_high_risk_unrelated(db_path)
    fake_llm.embed_vectors = [_HIT_VECTOR]
    before = _message_ids(client, headers, conversation_id)
    response = client.get(_knowledge_url(conversation_id), headers=headers)
    assert response.status_code == 200
    data = response.json()["data"]
    ids = [item["document_id"] for item in data["suggestions"]]
    answers = " ".join(item["main_answer"] for item in data["suggestions"])
    assert "doc-fashion" in ids
    assert "doc-high-risk" not in ids
    assert _HIGH_RISK_ANSWER not in answers
    assert _message_ids(client, headers, conversation_id) == before


def test_filename_and_body_search_open_high_risk_full_text(
    client: TestClient, fake_llm: FakeKnowledgeLlm, db_path: Path
) -> None:
    headers, conversation_id = _open_handed_off(client)
    client.post(
        f"/api/conversations/{conversation_id}/messages",
        headers=headers,
        json={"content": "这件衣服能退吗"},
    )
    client.patch(
        f"/api/conversations/{conversation_id}/ticket",
        headers=headers,
        json={"ticket_type": "return_exchange", "business_line": "apparel_beauty"},
    )
    _seed_high_risk_unrelated(db_path)
    fake_llm.embed_vectors = [_HIT_VECTOR]
    before = _message_ids(client, headers, conversation_id)

    by_name = client.get(
        _knowledge_url(conversation_id),
        headers=headers,
        params={"q": "t045-high-risk.md"},
    )
    assert by_name.status_code == 200
    name_data = by_name.json()["data"]
    assert name_data["empty_message"] is None
    name_item = next(
        item for item in name_data["suggestions"] if item["document_id"] == "doc-high-risk"
    )
    _assert_item_shape(name_item)
    assert name_item["visibility"] == "high_risk_human_only"
    assert name_item["filename"] == "t045-high-risk.md"
    assert _HIGH_RISK_ANSWER in name_item["main_answer"]
    assert fake_llm.embed_calls[-1] == ["t045-high-risk.md"]

    by_body = client.get(
        _knowledge_url(conversation_id),
        headers=headers,
        params={"q": "屏幕进液高风险赔付"},
    )
    assert by_body.status_code == 200
    body_data = by_body.json()["data"]
    body_item = next(
        item for item in body_data["suggestions"] if item["document_id"] == "doc-high-risk"
    )
    _assert_item_shape(body_item)
    assert body_item["visibility"] == "high_risk_human_only"
    assert _HIGH_RISK_ANSWER in body_item["main_answer"]
    assert _message_ids(client, headers, conversation_id) == before
