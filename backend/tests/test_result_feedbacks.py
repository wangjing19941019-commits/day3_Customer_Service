from __future__ import annotations

import sqlite3
from collections.abc import Generator
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pycore.core.config import ConfigManager
from src.db.session import AppSettings, reset_engine
from src.integrations.adapters.logistics import (
    MockLogisticsAdapter,
    set_logistics_adapter_override,
)
from src.integrations.adapters.order import MockOrderAdapter, set_order_adapter_override
from src.services.ticket import set_extract_llm_override

_TEST_SECRET = "test-secret-placeholder"
_TEST_PASSWORD = "it-help123"
_SEED_PASSWORD = "seed-password-placeholder"
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
_FEEDBACK_KEYS = {
    "id",
    "conversation_id",
    "template_id",
    "template_version",
    "rating",
    "comment",
    "created_at",
}


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
        "seed_password": _SEED_PASSWORD,
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


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "test.db"


@pytest.fixture
def client(db_path: Path, tmp_path: Path) -> Generator[TestClient, None, None]:
    ConfigManager.reset()
    reset_engine()
    set_extract_llm_override(None)
    set_order_adapter_override(MockOrderAdapter())
    set_logistics_adapter_override(MockLogisticsAdapter())
    ConfigManager().load_from_dict(
        AppSettings, _settings(str(db_path), str(tmp_path / "uploads"))
    )
    from src.main import app

    with TestClient(app) as test_client:
        yield test_client
    set_extract_llm_override(None)
    set_order_adapter_override(None)
    set_logistics_adapter_override(None)
    reset_engine()
    ConfigManager.reset()


def _assert_envelope(body: dict, *, success: bool) -> None:
    assert set(body) >= _ENVELOPE
    assert body["success"] is success
    if success:
        assert body["error"] is None
        assert body["error_code"] is None
    else:
        assert body["data"] is None
        assert body["error"]
        assert body["error_code"]


def _login(client: TestClient, username: str, password: str) -> dict[str, str]:
    login = client.post("/api/sessions", json={"username": username, "password": password})
    token = login.json()["data"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _agent(client: TestClient) -> dict[str, str]:
    return _login(client, "agent", _SEED_PASSWORD)


def _employee(client: TestClient) -> dict[str, str]:
    return _login(client, "it-help", _TEST_PASSWORD)


def _admin(client: TestClient) -> dict[str, str]:
    return _login(client, "admin", _SEED_PASSWORD)


def _open_handed_off(client: TestClient, headers: dict[str, str]) -> str:
    created = client.post("/api/conversations", headers=headers)
    conversation_id = created.json()["data"]["id"]
    transferred = client.post(f"/api/conversations/{conversation_id}/transfer", headers=headers)
    assert transferred.status_code == 200
    return conversation_id


def _feedback_url(conversation_id: str) -> str:
    return f"/api/conversations/{conversation_id}/result-feedbacks"


def test_agent_feedback_is_200_and_does_not_change_template_body(
    client: TestClient, db_path: Path
) -> None:
    agent = _agent(client)
    conversation_id = _open_handed_off(client, agent)
    listed = client.get("/api/prompt-templates", headers=_admin(client))
    assert listed.status_code == 200
    templates = listed.json()["data"]
    assert templates
    bodies_before: dict[str, str] = {}
    for item in templates:
        detail = client.get(f"/api/prompt-templates/{item['id']}", headers=_admin(client))
        assert detail.status_code == 200
        bodies_before[item["id"]] = detail.json()["data"]["body"]
    posted = client.post(
        _feedback_url(conversation_id),
        headers=agent,
        json={"rating": "useless", "comment": "无用", "target": "polish"},
    )
    assert posted.status_code == 200
    body = posted.json()
    _assert_envelope(body, success=True)
    data = body["data"]
    assert set(data) == _FEEDBACK_KEYS
    assert data["conversation_id"] == conversation_id
    assert data["rating"] == "useless"
    assert data["comment"] == "无用"
    assert data["template_id"]
    assert data["template_version"] == 1
    for item in templates:
        detail = client.get(f"/api/prompt-templates/{item['id']}", headers=_admin(client))
        assert detail.json()["data"]["body"] == bodies_before[item["id"]]
    rows = sqlite3.connect(db_path).execute(
        "SELECT body FROM prompt_template_versions WHERE template_id = ? AND version = ?",
        (data["template_id"], data["template_version"]),
    ).fetchall()
    assert rows
    assert rows[0][0] == bodies_before[data["template_id"]]
    stored = sqlite3.connect(db_path).execute(
        "SELECT rating, comment FROM result_feedbacks WHERE id = ?",
        (data["id"],),
    ).fetchone()
    assert stored == ("useless", "无用")


def test_feedback_shows_in_admin_metrics_of_its_template(client: TestClient) -> None:
    agent = _agent(client)
    conversation_id = _open_handed_off(client, agent)
    admin = _admin(client)
    posted = client.post(
        _feedback_url(conversation_id),
        headers=agent,
        json={"rating": "useless", "comment": "语气太轻快", "target": "polish"},
    ).json()["data"]
    metrics = client.get(
        f"/api/prompt-templates/{posted['template_id']}/metrics", headers=admin
    )
    assert metrics.status_code == 200
    summary = metrics.json()["data"]["feedback_summary"]
    assert "坐席反馈 1 条" in summary
    assert "无用 1 条" in summary
    assert "润色无用「语气太轻快」" in summary
    others = [
        item["id"]
        for item in client.get("/api/prompt-templates", headers=admin).json()["data"]
        if item["id"] != posted["template_id"]
    ]
    if others:
        other = client.get(f"/api/prompt-templates/{others[0]}/metrics", headers=admin)
        assert other.json()["data"]["feedback_summary"] == "暂无回流问题"


def test_employee_feedback_is_403(client: TestClient) -> None:
    headers = _employee(client)
    conversation_id = _open_handed_off(client, headers)
    response = client.post(
        _feedback_url(conversation_id),
        headers=headers,
        json={"rating": "useful", "target": "extract"},
    )
    assert response.status_code == 403
    body = response.json()
    _assert_envelope(body, success=False)
    assert body["error_code"] == "FORBIDDEN"
    assert body["error"] == "没有权限"


def test_feedback_missing_conversation_is_404(client: TestClient) -> None:
    response = client.post(
        _feedback_url(str(uuid4())),
        headers=_agent(client),
        json={"rating": "useful", "target": "knowledge"},
    )
    assert response.status_code == 404
    body = response.json()
    _assert_envelope(body, success=False)
    assert body["error_code"] == "NOT_FOUND"
