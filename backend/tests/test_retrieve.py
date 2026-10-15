import asyncio
import json
import sqlite3
from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pycore.core.config import ConfigManager
from src.db.models import Chunk, Document
from src.db.session import AppSettings, get_session_maker, reset_engine
from src.services.qa import ClassifiedIssue
from src.services.retrieve import (
    AUDIENCE_AGENT,
    AUDIENCE_USER,
    allowed_for_audience,
    filter_chunks_for_issue,
    fusion_score,
    is_current_basis,
    keyword_overlap_rate,
    load_ready_chunks,
    rank_retrieved_chunks,
)

_TEST_SECRET = "test-secret-placeholder"
_TEST_PASSWORD = "it-help123"


def _settings(database_path: str, upload_dir: str) -> dict:
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
        "upload_dir": upload_dir,
        "shared_username": "it-help",
        "shared_password": _TEST_PASSWORD,
        "jwt_expire_minutes": 720,
        "llm_api_key": "",
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
        "retrieve_cosine_weight": 0.7,
        "retrieve_keyword_weight": 0.3,
        "poll_interval_ms": 3000,
        "ingest_stale_seconds": 300,
        "fallback_reply": (
            "抱歉，这个问题我暂时无法根据现有知识准确回答。你可以换个说法再问，或点击转人工。"
        ),
        "clarification_max_rounds": 5,
        "agent_knowledge_top_k": 3,
    }


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "test.db"


@pytest.fixture
def upload_dir(tmp_path: Path) -> Path:
    path = tmp_path / "uploads"
    path.mkdir()
    return path


@pytest.fixture
def client_no_key(db_path: Path, upload_dir: Path) -> Generator[TestClient, None, None]:
    ConfigManager.reset()
    reset_engine()
    ConfigManager().load_from_dict(AppSettings, _settings(str(db_path), str(upload_dir)))
    from src.main import app

    with TestClient(app) as test_client:
        yield test_client
    reset_engine()
    ConfigManager.reset()


def _now() -> datetime:
    return datetime(2026, 6, 15, 12, 0, tzinfo=UTC)


def _doc(
    doc_id: str,
    *,
    visibility: str | None,
    request_types: list[str],
    effective_from: datetime | None = None,
    effective_to: datetime | None = None,
    ingest_status: str = "ready",
) -> Document:
    stamp = _now()
    return Document(
        id=doc_id,
        filename=f"{doc_id}.md",
        ingest_status=ingest_status,
        ingest_error=None,
        object_types_json=["product_3c"],
        request_types_json=request_types,
        entities_json=[],
        visibility=visibility,
        effective_from=effective_from,
        effective_to=effective_to,
        created_at=stamp,
        updated_at=stamp,
    )


def test_user_audience_excludes_agent_only_and_high_risk() -> None:
    now = _now()
    agent_only = _doc(
        "agent",
        visibility="agent_only",
        request_types=["usage_guidance"],
    )
    high_risk = _doc(
        "risk",
        visibility="high_risk_human_only",
        request_types=["usage_guidance"],
    )
    user_visible = _doc(
        "user",
        visibility="user_visible",
        request_types=["usage_guidance"],
    )
    assert allowed_for_audience(agent_only, AUDIENCE_USER, now) is False
    assert allowed_for_audience(high_risk, AUDIENCE_USER, now) is False
    assert allowed_for_audience(user_visible, AUDIENCE_USER, now) is True
    assert allowed_for_audience(agent_only, AUDIENCE_AGENT, now) is True
    assert allowed_for_audience(high_risk, AUDIENCE_AGENT, now) is True


def test_ready_document_without_visibility_defaults_user_visible() -> None:
    now = _now()
    old = _doc("old", visibility=None, request_types=["usage_guidance"])
    assert allowed_for_audience(old, AUDIENCE_USER, now) is True
    ingesting = _doc(
        "ing",
        visibility=None,
        request_types=["usage_guidance"],
        ingest_status="ingesting",
    )
    assert allowed_for_audience(ingesting, AUDIENCE_USER, now) is False


def test_policy_missing_or_expired_dates_not_current_basis() -> None:
    now = _now()
    missing = _doc(
        "missing",
        visibility="user_visible",
        request_types=["policy_process"],
    )
    howto_missing = _doc(
        "howto",
        visibility="user_visible",
        request_types=["after_sale_howto"],
        effective_from=now - timedelta(days=1),
        effective_to=None,
    )
    expired = _doc(
        "expired",
        visibility="user_visible",
        request_types=["policy_process"],
        effective_from=now - timedelta(days=30),
        effective_to=now - timedelta(days=1),
    )
    current = _doc(
        "current",
        visibility="user_visible",
        request_types=["policy_process"],
        effective_from=now - timedelta(days=1),
        effective_to=now + timedelta(days=1),
    )
    usage = _doc(
        "usage",
        visibility="user_visible",
        request_types=["usage_guidance"],
    )
    assert is_current_basis(missing, now) is False
    assert is_current_basis(howto_missing, now) is False
    assert is_current_basis(expired, now) is False
    assert is_current_basis(current, now) is True
    assert is_current_basis(usage, now) is True
    assert allowed_for_audience(missing, AUDIENCE_USER, now) is False
    assert allowed_for_audience(current, AUDIENCE_USER, now) is True
    assert allowed_for_audience(usage, AUDIENCE_USER, now) is True


def test_filter_chunks_still_blocks_cross_category() -> None:
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


def test_fusion_score_uses_config_weights_not_a_live_client() -> None:
    settings = AppSettings.model_validate(_settings("unused.db", "unused"))
    assert settings.retrieve_cosine_weight == 0.7
    assert settings.retrieve_keyword_weight == 0.3
    assert fusion_score(1.0, 0.0, settings) == pytest.approx(0.7)
    assert fusion_score(0.0, 1.0, settings) == pytest.approx(0.3)
    query = "耳机保修"
    overlap = keyword_overlap_rate(query, "售后", "耳机保修一年")
    assert overlap == 1.0
    ranked = rank_retrieved_chunks(
        [1.0, 0.0],
        query,
        [
            Chunk(
                id="hit",
                document_id="d1",
                position=1,
                heading_path="售后",
                content="耳机保修一年",
                object_types_json=["product_3c"],
                request_types_json=["policy_process"],
                entities_json=[],
                embedding=[1.0, 0.0],
            ),
            Chunk(
                id="miss",
                document_id="d2",
                position=1,
                heading_path="",
                content="无关物流",
                object_types_json=["product_3c"],
                request_types_json=["policy_process"],
                entities_json=[],
                embedding=[0.0, 1.0],
            ),
        ],
        top_k=5,
        min_score=0.55,
        settings=settings,
    )
    assert [item.id for item in ranked] == ["hit"]


def _insert_chunk_doc(
    db_path: Path,
    *,
    doc_id: str,
    visibility: str | None,
    request_types: list[str],
    effective_from: str | None,
    effective_to: str | None,
    content: str,
) -> None:
    conn = sqlite3.connect(db_path)
    stamp = datetime.now(UTC).replace(microsecond=0, tzinfo=None).isoformat(sep=" ")
    conn.execute(
        """
        INSERT INTO documents (
            id, filename, ingest_status, ingest_error,
            object_types_json, request_types_json, entities_json,
            visibility, effective_from, effective_to, created_at, updated_at
        ) VALUES (?, ?, 'ready', NULL, ?, ?, '[]', ?, ?, ?, ?, ?)
        """,
        (
            doc_id,
            f"{doc_id}.md",
            json.dumps(["product_3c"]),
            json.dumps(request_types),
            visibility,
            effective_from,
            effective_to,
            stamp,
            stamp,
        ),
    )
    conn.execute(
        """
        INSERT INTO chunks (
            id, document_id, position, heading_path, content,
            object_types_json, request_types_json, entities_json, embedding
        ) VALUES (?, ?, 1, '政策', ?, ?, ?, '[]', ?)
        """,
        (
            f"chunk-{doc_id}",
            doc_id,
            content,
            json.dumps(["product_3c"]),
            json.dumps(request_types),
            json.dumps([1.0, 0.0]),
        ),
    )
    conn.commit()
    conn.close()


def test_load_ready_chunks_filters_visibility_and_policy_dates(
    client_no_key: TestClient, db_path: Path
) -> None:
    now = datetime.now(UTC)
    _insert_chunk_doc(
        db_path,
        doc_id="user-ok",
        visibility="user_visible",
        request_types=["usage_guidance"],
        effective_from=None,
        effective_to=None,
        content="用户可见使用说明",
    )
    _insert_chunk_doc(
        db_path,
        doc_id="agent-only",
        visibility="agent_only",
        request_types=["usage_guidance"],
        effective_from=None,
        effective_to=None,
        content="仅坐席内部步骤",
    )
    _insert_chunk_doc(
        db_path,
        doc_id="policy-missing",
        visibility="user_visible",
        request_types=["policy_process"],
        effective_from=None,
        effective_to=None,
        content="缺日期的政策",
    )
    _insert_chunk_doc(
        db_path,
        doc_id="policy-ok",
        visibility="user_visible",
        request_types=["policy_process"],
        effective_from=(now - timedelta(days=1)).isoformat(),
        effective_to=(now + timedelta(days=1)).isoformat(),
        content="生效中的政策",
    )

    async def _load() -> tuple[list[str], list[str]]:
        async with get_session_maker()() as session:
            user_chunks = await load_ready_chunks(session, AUDIENCE_USER, now)
            agent_chunks = await load_ready_chunks(session, AUDIENCE_AGENT, now)
        return (
            [item.document_id for item in user_chunks],
            [item.document_id for item in agent_chunks],
        )

    user_ids, agent_ids = asyncio.run(_load())
    assert "user-ok" in user_ids
    assert "policy-ok" in user_ids
    assert "agent-only" not in user_ids
    assert "policy-missing" not in user_ids
    assert "agent-only" in agent_ids
    assert "policy-missing" not in agent_ids
