from __future__ import annotations

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
        "/api/sessions", json={"username": username, "password": _SEED_PASSWORD}
    )
    assert response.status_code == 200
    return response.json()["data"]["access_token"]


def _on_duty(client: TestClient, username: str) -> str:
    token = _login(client, username)
    assert client.get("/api/sessions/current", headers=_auth(token)).status_code == 200
    return token


def _open(client: TestClient, username: str = "agent") -> tuple[dict[str, str], str]:
    token = _login(client, username)
    headers = _auth(token)
    created = client.post("/api/conversations", headers=headers)
    conversation_id = created.json()["data"]["id"]
    assert client.post(
        f"/api/conversations/{conversation_id}/transfer", headers=headers
    ).status_code == 200
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
        f"/api/conversations/{conversation_id}/ticket/confirm", headers=headers
    )
    assert confirmed.status_code == 200, confirmed.text
    return confirmed.json()["data"]


def test_employee_list_is_forbidden(client: TestClient) -> None:
    token = _login(client, "employee")
    response = client.get("/api/tickets", headers=_auth(token))
    assert response.status_code == 403
    assert response.json()["error_code"] == "FORBIDDEN"


def test_list_excludes_draft_and_filters(client: TestClient) -> None:
    _on_duty(client, "specialist")
    headers, conversation_id = _open(client)
    client.patch(
        f"/api/conversations/{conversation_id}/ticket",
        headers=headers,
        json={"ticket_type": "return_exchange", "business_line": "apparel_beauty"},
    )
    listed_empty = client.get("/api/tickets", headers=_auth(_login(client, "specialist")))
    assert listed_empty.status_code == 200
    assert listed_empty.json()["data"] == []
    data = _confirm_return(client, headers, conversation_id)
    listed = client.get("/api/tickets", headers=_auth(_login(client, "specialist")))
    assert listed.status_code == 200
    body = listed.json()
    assert body["success"] is True
    assert len(body["data"]) == 1
    item = body["data"][0]
    assert set(item) >= {
        "id",
        "ticket_no",
        "ticket_type",
        "status",
        "urgency",
        "queue",
        "order_no",
        "assigned_display",
        "upgrade_undelivered",
        "confirmed_at",
        "sla_due_at",
        "updated_at",
    }
    assert item["id"] == data["id"]
    assert item["ticket_no"] == data["ticket_no"]
    assert item["order_no"] == "JD20260922001"
    filtered = client.get(
        "/api/tickets",
        headers=_auth(_login(client, "specialist")),
        params={"ticket_type": "invoice"},
    )
    assert filtered.json()["data"] == []
    by_no = client.get(
        "/api/tickets",
        headers=_auth(_login(client, "specialist")),
        params={"ticket_no": data["ticket_no"]},
    )
    assert len(by_no.json()["data"]) == 1


def test_specialist_can_claim_pending_not_high_risk(client: TestClient) -> None:
    headers, conversation_id = _open(client)
    data = _confirm_return(client, headers, conversation_id)
    assert data["status"] == "pending"
    specialist = _on_duty(client, "specialist")
    claimed = client.post(f"/api/tickets/{data['id']}/claim", headers=_auth(specialist))
    assert claimed.status_code == 200, claimed.text
    body = claimed.json()["data"]
    assert body["status"] == "in_progress"
    assert body["assigned_role"] == "after_sales_specialist"
    again = client.post(f"/api/tickets/{data['id']}/claim", headers=_auth(specialist))
    assert again.status_code == 409


def test_raise_to_high_risk_reassigns_senior(client: TestClient) -> None:
    _on_duty(client, "specialist")
    _on_duty(client, "senior")
    headers, conversation_id = _open(client)
    data = _confirm_return(client, headers, conversation_id)
    raised = client.patch(
        f"/api/tickets/{data['id']}",
        headers=headers,
        json={"urgency": "high_risk"},
    )
    assert raised.status_code == 200, raised.text
    body = raised.json()["data"]
    assert body["urgency"] == "high_risk"
    assert body["queue"] == "high_risk"
    assert body["assigned_role"] == "senior_after_sales"


def test_down_high_risk_without_approval_stays_high_risk(client: TestClient) -> None:
    _on_duty(client, "senior")
    headers, conversation_id = _open(client)
    client.post(
        f"/api/conversations/{conversation_id}/messages",
        headers=headers,
        json={"content": "我要去消协"},
    )
    data = _confirm_return(client, headers, conversation_id)
    assert data["urgency"] == "high_risk"
    down = client.patch(
        f"/api/tickets/{data['id']}",
        headers=headers,
        json={"urgency": "normal"},
    )
    assert down.status_code == 409
    assert down.json()["error_code"] == "CONFLICT"
    still = client.get(
        f"/api/conversations/{conversation_id}/ticket", headers=headers
    ).json()["data"]
    assert still["urgency"] == "high_risk"
    supervisor = _login(client, "supervisor")
    denied = client.post(
        f"/api/tickets/{data['id']}/urgency-approvals",
        headers=_auth(supervisor),
        json={"approved": False, "target_urgency": "normal"},
    )
    assert denied.status_code == 200
    assert denied.json()["data"]["urgency"] == "high_risk"
    _on_duty(client, "specialist")
    approved = client.post(
        f"/api/tickets/{data['id']}/urgency-approvals",
        headers=_auth(supervisor),
        json={"approved": True, "target_urgency": "normal"},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["data"]["urgency"] == "normal"
    assert approved.json()["data"]["queue"] == "normal"


def test_specialist_cannot_claim_high_risk(client: TestClient) -> None:
    headers, conversation_id = _open(client)
    client.post(
        f"/api/conversations/{conversation_id}/messages",
        headers=headers,
        json={"content": "我要去消协"},
    )
    data = _confirm_return(client, headers, conversation_id)
    specialist = _on_duty(client, "specialist")
    claimed = client.post(f"/api/tickets/{data['id']}/claim", headers=_auth(specialist))
    assert claimed.status_code == 409


def test_status_hold_complete_close(client: TestClient) -> None:
    _on_duty(client, "specialist")
    headers, conversation_id = _open(client)
    data = _confirm_return(client, headers, conversation_id)
    specialist = _auth(_login(client, "specialist"))
    held = client.patch(
        f"/api/tickets/{data['id']}",
        headers=specialist,
        json={"status": "on_hold", "hold_reason": "wait_user"},
    )
    assert held.status_code == 200
    assert held.json()["data"]["status"] == "on_hold"
    done = client.patch(
        f"/api/tickets/{data['id']}",
        headers=specialist,
        json={"status": "completed"},
    )
    assert done.status_code == 200
    assert done.json()["data"]["status"] == "completed"
    closed = client.patch(
        f"/api/tickets/{data['id']}",
        headers=specialist,
        json={"status": "closed"},
    )
    assert closed.status_code == 200
    assert closed.json()["data"]["status"] == "closed"
    back = client.patch(
        f"/api/tickets/{data['id']}",
        headers=specialist,
        json={"status": "on_hold", "hold_reason": "wait_user"},
    )
    assert back.status_code == 409


def test_frontline_list_own_confirmed_ticket(client: TestClient) -> None:
    _on_duty(client, "specialist")
    headers, conversation_id = _open(client)
    data = _confirm_return(client, headers, conversation_id)
    listed = client.get("/api/tickets", headers=headers)
    assert listed.status_code == 200
    assert listed.json()["data"][0]["ticket_no"] == data["ticket_no"]


def test_supervisor_approval_not_high_risk_is_409(client: TestClient) -> None:
    _on_duty(client, "specialist")
    headers, conversation_id = _open(client)
    data = _confirm_return(client, headers, conversation_id)
    supervisor = _login(client, "supervisor")
    response = client.post(
        f"/api/tickets/{data['id']}/urgency-approvals",
        headers=_auth(supervisor),
        json={"approved": True, "target_urgency": "normal"},
    )
    assert response.status_code == 409


def test_get_ticket_returns_progress_visible(client: TestClient) -> None:
    _on_duty(client, "specialist")
    headers, conversation_id = _open(client)
    data = _confirm_return(client, headers, conversation_id)
    specialist = _login(client, "specialist")
    got = client.get(f"/api/tickets/{data['id']}", headers=_auth(specialist))
    assert got.status_code == 200, got.text
    body = got.json()["data"]
    assert body["id"] == data["id"]
    details = [
        str(item.get("detail") or "")
        for item in (body.get("progress") or [])
        if isinstance(item, dict)
    ]
    assert "已发起退货" in details
    assert all("已生成退货单" not in text for text in details)
    admin = _login(client, "admin")
    admin_got = client.get(f"/api/tickets/{data['id']}", headers=_auth(admin))
    assert admin_got.status_code == 200
    employee = _login(client, "employee")
    forbidden = client.get(f"/api/tickets/{data['id']}", headers=_auth(employee))
    assert forbidden.status_code == 403
    missing = client.get("/api/tickets/missing-ticket-id", headers=_auth(specialist))
    assert missing.status_code == 404
