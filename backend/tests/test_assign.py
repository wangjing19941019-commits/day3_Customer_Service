from __future__ import annotations

import json
import sqlite3
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pycore.core.config import ConfigManager
from src.db.session import AppSettings, reset_engine
from src.integrations.adapters.member import MockMemberAdapter, set_member_adapter_override

_TEST_SECRET = "test-secret-placeholder"
_TEST_PASSWORD = "it-help123"
_SEED_PASSWORD = "seed-password-placeholder"
_RETURN_FIELDS = {
    "order_no": "JD20260922001",
    "product_info": "连衣裙 M 码",
    "amount": "80",
    "intent_summary": "质量问题要求退货",
    "return_method": "return_only",
    "return_reason": "质量问题",
    "quantity": "1",
}


def _settings(database_path: str) -> dict:
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
        "seed_password": _SEED_PASSWORD,
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
        "poll_interval_ms": 3000,
        "ingest_stale_seconds": 300,
        "fallback_reply": (
            "抱歉，这个问题我暂时无法根据现有知识准确回答。你可以换个说法再问，或点击转人工。"
        ),
        "clarification_max_rounds": 5,
        "on_duty_seconds": 300,
        "member_base_url": "",
        "sla_rules": {},
    }


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "test.db"


@pytest.fixture
def fake_member() -> Generator[MockMemberAdapter, None, None]:
    fake = MockMemberAdapter()
    set_member_adapter_override(fake)
    yield fake
    set_member_adapter_override(None)


@pytest.fixture
def client(db_path: Path, fake_member: MockMemberAdapter) -> Generator[TestClient, None, None]:
    ConfigManager.reset()
    reset_engine()
    set_member_adapter_override(fake_member)
    ConfigManager().load_from_dict(AppSettings, _settings(str(db_path)))
    from src.main import app

    with TestClient(app) as test_client:
        yield test_client
    set_member_adapter_override(None)
    reset_engine()
    ConfigManager.reset()


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _login(client: TestClient, username: str) -> str:
    response = client.post(
        "/api/sessions",
        json={"username": username, "password": _SEED_PASSWORD},
    )
    assert response.status_code == 200
    return response.json()["data"]["access_token"]


def _on_duty(client: TestClient, username: str) -> str:
    token = _login(client, username)
    current = client.get("/api/sessions/current", headers=_auth(token))
    assert current.status_code == 200
    return token


def _open(client: TestClient, username: str = "agent") -> tuple[dict[str, str], str]:
    token = _login(client, username)
    headers = _auth(token)
    created = client.post("/api/conversations", headers=headers)
    conversation_id = created.json()["data"]["id"]
    transferred = client.post(f"/api/conversations/{conversation_id}/transfer", headers=headers)
    assert transferred.status_code == 200
    return headers, conversation_id


def _confirm_return(client: TestClient, headers: dict[str, str], conversation_id: str) -> dict:
    patched = client.patch(
        f"/api/conversations/{conversation_id}/ticket",
        headers=headers,
        json={
            "ticket_type": "return_exchange",
            "business_line": "apparel_beauty",
            "fields": _RETURN_FIELDS,
        },
    )
    assert patched.status_code == 200
    confirmed = client.post(
        f"/api/conversations/{conversation_id}/ticket/confirm",
        headers=headers,
    )
    assert confirmed.status_code == 200, confirmed.text
    return confirmed.json()["data"]


def _user_id(db_path: Path, username: str) -> int:
    row = sqlite3.connect(db_path).execute(
        "SELECT id FROM users WHERE username = ?", (username,)
    ).fetchone()
    assert row is not None
    return int(row[0])


def test_empty_member_base_url_uses_mock_and_does_not_mark_vip(
    client: TestClient, fake_member: MockMemberAdapter
) -> None:
    _on_duty(client, "specialist")
    headers, conversation_id = _open(client)
    data = _confirm_return(client, headers, conversation_id)
    assert fake_member.calls
    assert data["urgency"] == "normal"
    assert data["queue"] == "normal"
    assert data["ticket_no"]


def test_normal_return_exchange_assigns_specialist_in_progress(client: TestClient) -> None:
    _on_duty(client, "specialist")
    headers, conversation_id = _open(client)
    data = _confirm_return(client, headers, conversation_id)
    assert data["status"] == "in_progress"
    assert data["assigned_role"] == "after_sales_specialist"
    assert data["assigned_display"] == "售后专员"
    assert data["assigned_user_id"] is not None
    assert data["urgency"] == "normal"
    assert data["queue"] == "normal"
    assert data["ticket_no"].startswith("TKT-")
    assert data["sla"]["due_at"]
    assert data["sla"]["close_after"]


def test_xiehui_marks_high_risk_for_senior(client: TestClient) -> None:
    _on_duty(client, "senior")
    headers, conversation_id = _open(client)
    posted = client.post(
        f"/api/conversations/{conversation_id}/messages",
        headers=headers,
        json={"content": "我要去消协"},
    )
    assert posted.status_code == 200
    data = _confirm_return(client, headers, conversation_id)
    assert data["urgency"] == "high_risk"
    assert data["queue"] == "high_risk"
    assert data["assigned_role"] == "senior_after_sales"
    assert data["assigned_display"] == "高级售后专员"
    assert data["status"] == "in_progress"


def test_three_complaints_marks_high_risk(
    client: TestClient, fake_member: MockMemberAdapter, db_path: Path
) -> None:
    _on_duty(client, "senior")
    agent_id = _user_id(db_path, "agent")
    fake_member.by_key[str(agent_id)] = {"complaint_count": 3}
    headers, conversation_id = _open(client)
    data = _confirm_return(client, headers, conversation_id)
    assert data["urgency"] == "high_risk"
    assert data["assigned_role"] == "senior_after_sales"
    assert data["queue"] == "high_risk"


def test_vip_and_normal_use_different_queues(
    client: TestClient, fake_member: MockMemberAdapter, db_path: Path
) -> None:
    _on_duty(client, "specialist")
    agent_id = _user_id(db_path, "agent")
    fake_member.by_key[str(agent_id)] = {"level": "VIP"}
    vip_headers, vip_cid = _open(client, "agent")
    vip = _confirm_return(client, vip_headers, vip_cid)
    employee_headers, normal_cid = _open(client, "employee")
    normal = _confirm_return(client, employee_headers, normal_cid)
    assert vip["urgency"] == "vip"
    assert vip["queue"] == "vip_priority"
    assert normal["urgency"] == "normal"
    assert normal["queue"] == "normal"
    assert vip["queue"] != normal["queue"]
    listed = client.get("/api/tickets", headers=_auth(_login(client, "specialist")))
    assert listed.status_code == 200
    queues = {item["queue"] for item in listed.json()["data"]}
    assert "vip_priority" in queues
    assert "normal" in queues


def test_frontline_agent_claim_is_forbidden(client: TestClient) -> None:
    headers, conversation_id = _open(client)
    data = _confirm_return(client, headers, conversation_id)
    assert data["status"] == "pending"
    claimed = client.post(f"/api/tickets/{data['id']}/claim", headers=headers)
    assert claimed.status_code == 403
    body = claimed.json()
    assert body["success"] is False
    assert body["data"] is None
    assert body["error_code"] == "FORBIDDEN"


def test_unconfigured_amount_line_does_not_raise_risk(client: TestClient) -> None:
    _on_duty(client, "specialist")
    headers, conversation_id = _open(client)
    fields = dict(_RETURN_FIELDS)
    fields["amount"] = "999999"
    patched = client.patch(
        f"/api/conversations/{conversation_id}/ticket",
        headers=headers,
        json={
            "ticket_type": "return_exchange",
            "business_line": "apparel_beauty",
            "fields": fields,
        },
    )
    assert patched.status_code == 200
    confirmed = client.post(
        f"/api/conversations/{conversation_id}/ticket/confirm",
        headers=headers,
    )
    data = confirmed.json()["data"]
    assert data["urgency"] == "normal"
    assert data["urgency"] != "high_risk"
    assert data["urgency"] != "vip"


def test_member_lookup_payload_is_not_serialized_as_secret(client: TestClient) -> None:
    headers, conversation_id = _open(client)
    data = _confirm_return(client, headers, conversation_id)
    dumped = json.dumps(data, ensure_ascii=False)
    assert "sk-" not in dumped
    assert "Bearer " not in dumped
