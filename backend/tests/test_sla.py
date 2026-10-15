from __future__ import annotations

import json
import sqlite3
from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pycore.core.config import ConfigManager
from src.db.session import AppSettings, reset_engine
from src.integrations.adapters.member import MockMemberAdapter, set_member_adapter_override
from src.services.sla import SLA_RULES, compute_sla_fields, effective_sla_rules

_TEST_SECRET = "test-secret-placeholder"
_TEST_PASSWORD = "it-help123"
_SEED_PASSWORD = "seed-password-placeholder"
_ADDRESS_FIELDS = {
    "order_no": "JD20260922002",
    "product_info": "手机",
    "amount": "100",
    "intent_summary": "修改收货地址",
    "new_address": "上海市浦东新区",
    "recipient_name": "张三",
    "phone": "13800000000",
}
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
        "poll_interval_ms": 30000,
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


def _confirm(
    client: TestClient,
    headers: dict[str, str],
    conversation_id: str,
    ticket_type: str,
    fields: dict,
) -> dict:
    patched = client.patch(
        f"/api/conversations/{conversation_id}/ticket",
        headers=headers,
        json={
            "ticket_type": ticket_type,
            "business_line": "digital_3c",
            "fields": fields,
        },
    )
    assert patched.status_code == 200, patched.text
    confirmed = client.post(
        f"/api/conversations/{conversation_id}/ticket/confirm", headers=headers
    )
    assert confirmed.status_code == 200, confirmed.text
    return confirmed.json()["data"]


def _parse(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _set_sla(db_path: Path, ticket_id: str, **times: str | bool | int | None) -> None:
    conn = sqlite3.connect(db_path)
    raw = conn.execute(
        "SELECT fields_json FROM tickets WHERE id = ?", (ticket_id,)
    ).fetchone()[0]
    fields = json.loads(raw)
    sla = fields["_meta"].setdefault("sla", {})
    sla.update(times)
    conn.execute(
        "UPDATE tickets SET fields_json = ? WHERE id = ?",
        (json.dumps(fields, ensure_ascii=False), ticket_id),
    )
    conn.commit()
    conn.close()


def _reload(client: TestClient, headers: dict[str, str], conversation_id: str) -> dict:
    listed = client.get("/api/tickets", headers=_auth(_login(client, "specialist")))
    assert listed.status_code == 200
    got = client.get(f"/api/conversations/{conversation_id}/ticket", headers=headers)
    assert got.status_code == 200
    return got.json()["data"]


def test_sla_rules_match_prd_numbers() -> None:
    rules = effective_sla_rules()
    assert rules["normal"]["address_change"]["due_hours"] == 2
    assert rules["normal"]["address_change"]["warn_before_hours"] == 0.5
    assert rules["normal"]["address_change"]["escalate_role"] == "supervisor"
    assert rules["normal"]["address_change"]["close_after_warn_hours"] == 24
    assert rules["normal"]["invoice"]["due_hours"] == 2
    assert rules["normal"]["return_exchange"]["due_hours"] == 24
    assert rules["normal"]["return_exchange"]["warn_before_hours"] == 4
    assert rules["normal"]["return_exchange"]["escalate_role"] == "after_sales_supervisor"
    assert rules["normal"]["return_exchange"]["close_after_warn_hours"] == 48
    assert rules["normal"]["fee_dispute"]["due_hours"] == 24
    assert rules["normal"]["fee_dispute"]["escalate_role"] == "senior_after_sales"
    assert rules["normal"]["complaint"]["due_hours"] == 48
    assert rules["normal"]["complaint"]["warn_before_hours"] == 8
    assert rules["normal"]["complaint"]["escalate_role"] == "cs_lead"
    assert rules["normal"]["complaint"]["close_after_warn_hours"] == 72
    logistics = rules["normal"]["logistics_exception"]
    assert logistics["delay"]["due_hours"] == 24
    assert logistics["delay"]["warn_before_hours"] == 4
    assert logistics["delay"]["close_after_warn_hours"] == 24
    assert logistics["lost"]["due_hours"] == 48
    assert logistics["lost"]["warn_before_hours"] == 12
    assert logistics["address_exception"]["due_hours"] == 12
    assert logistics["address_exception"]["due_hours"] != 2
    vip = rules["vip"]
    assert vip["address_change"]["due_hours"] == 0.5
    assert vip["address_change"]["warn_before_hours"] == 10 / 60
    assert vip["address_change"]["escalate_role"] == "supervisor"
    assert vip["address_change"]["close_after_warn_hours"] is None
    assert vip["return_exchange"]["due_hours"] == 4
    assert vip["return_exchange"]["warn_before_hours"] == 1
    assert vip["return_exchange"]["escalate_role"] == "after_sales_supervisor"
    assert vip["fee_dispute"]["due_hours"] == 2
    assert vip["fee_dispute"]["warn_before_hours"] == 0.5
    assert vip["fee_dispute"]["escalate_role"] == "senior_after_sales"
    assert vip["complaint"]["due_hours"] == 4
    assert vip["complaint"]["escalate_role"] == "cs_lead"
    assert vip["logistics_exception"]["delay"]["due_hours"] == 12
    assert vip["logistics_exception"]["delay"]["warn_before_hours"] == 3
    assert vip["logistics_exception"]["lost"]["due_hours"] == 24
    assert vip["logistics_exception"]["lost"]["warn_before_hours"] == 8
    assert vip["logistics_exception"]["address_exception"]["due_hours"] == 6
    assert vip["logistics_exception"]["address_exception"]["warn_before_hours"] == 1.5
    assert vip["logistics_exception"]["delay"]["l2_wait_hours"] == 2
    assert SLA_RULES["vip"]["return_exchange"]["close_after_warn_hours"] is None


def test_compute_windows_use_prd_offsets() -> None:
    confirmed = datetime(2026, 9, 23, 8, 0, tzinfo=UTC)
    address = compute_sla_fields(
        ticket_type="address_change",
        urgency="normal",
        exception_type=None,
        confirmed_at=confirmed,
    )
    assert _parse(address["warn_at"]) == confirmed + timedelta(hours=1, minutes=30)
    assert _parse(address["due_at"]) == confirmed + timedelta(hours=2)
    assert _parse(address["close_after"]) == confirmed + timedelta(hours=25, minutes=30)
    vip_return = compute_sla_fields(
        ticket_type="return_exchange",
        urgency="vip",
        exception_type=None,
        confirmed_at=confirmed,
        customer_vip=True,
    )
    assert vip_return["close_after"] is None
    assert _parse(vip_return["warn_at"]) == confirmed + timedelta(hours=3)
    assert _parse(vip_return["due_at"]) == confirmed + timedelta(hours=4)
    delay = compute_sla_fields(
        ticket_type="logistics_exception",
        urgency="normal",
        exception_type="delay",
        confirmed_at=confirmed,
    )
    assert _parse(delay["warn_at"]) == confirmed + timedelta(hours=20)
    assert _parse(delay["due_at"]) == confirmed + timedelta(hours=24)
    lost = compute_sla_fields(
        ticket_type="logistics_exception",
        urgency="normal",
        exception_type="lost",
        confirmed_at=confirmed,
    )
    assert _parse(lost["warn_at"]) == confirmed + timedelta(hours=36)
    assert _parse(lost["due_at"]) == confirmed + timedelta(hours=48)
    address_ex = compute_sla_fields(
        ticket_type="logistics_exception",
        urgency="normal",
        exception_type="address_exception",
        confirmed_at=confirmed,
    )
    assert _parse(address_ex["due_at"]) == confirmed + timedelta(hours=12)
    vip_delay = compute_sla_fields(
        ticket_type="logistics_exception",
        urgency="vip",
        exception_type="delay",
        confirmed_at=confirmed,
        customer_vip=True,
    )
    assert vip_delay["close_after"] is None
    assert _parse(vip_delay["warn_at"]) == confirmed + timedelta(hours=9)
    assert _parse(vip_delay["due_at"]) == confirmed + timedelta(hours=12)


def test_address_change_warn_escalate_and_not_close_before_window(
    client: TestClient, db_path: Path
) -> None:
    _on_duty(client, "specialist")
    headers, conversation_id = _open(client)
    data = _confirm(client, headers, conversation_id, "address_change", _ADDRESS_FIELDS)
    confirmed_at = _parse(data["confirmed_at"])
    assert _parse(data["sla"]["warn_at"]) - confirmed_at == timedelta(hours=1, minutes=30)
    assert _parse(data["sla"]["due_at"]) - confirmed_at == timedelta(hours=2)
    assert _parse(data["sla"]["close_after"]) - _parse(data["sla"]["warn_at"]) == timedelta(
        hours=24
    )
    now = datetime.now(UTC)
    _set_sla(
        db_path,
        data["id"],
        warn_at=(now - timedelta(minutes=1)).isoformat(),
        due_at=(now + timedelta(hours=1)).isoformat(),
        close_after=(now + timedelta(hours=24)).isoformat(),
        warned=False,
        escalated=False,
    )
    warned = _reload(client, headers, conversation_id)
    assert any(item.get("event") == "warned" for item in warned["progress"])
    assert warned["status"] != "closed"
    _set_sla(
        db_path,
        data["id"],
        warn_at=(now - timedelta(hours=1)).isoformat(),
        due_at=(now - timedelta(minutes=1)).isoformat(),
        close_after=(now + timedelta(hours=23)).isoformat(),
        warned=True,
        escalated=False,
    )
    escalated = _reload(client, headers, conversation_id)
    assert escalated["assigned_role"] == "supervisor"
    assert escalated["assigned_display"] == "主管"
    assert escalated["assigned_display"]
    assert escalated["status"] != "closed"
    assert any(
        item.get("event") == "close_notice"
        or "关闭预告" in (item.get("detail") or "")
        for item in escalated["progress"]
    )
    # 预警后未满 24 小时（close_after 仍在未来）不能自动关闭
    _set_sla(
        db_path,
        data["id"],
        close_after=(now + timedelta(hours=20)).isoformat(),
        warned=True,
        escalated=True,
        close_notice_sent=True,
    )
    too_soon = _reload(client, headers, conversation_id)
    assert too_soon["status"] != "closed"


def test_vip_due_only_escalates_never_closes(
    client: TestClient, fake_member: MockMemberAdapter, db_path: Path
) -> None:
    _on_duty(client, "specialist")
    agent_id = sqlite3.connect(db_path).execute(
        "SELECT id FROM users WHERE username = ?", ("agent",)
    ).fetchone()[0]
    fake_member.by_key[str(agent_id)] = {"level": "VIP"}
    headers, conversation_id = _open(client)
    data = _confirm(client, headers, conversation_id, "return_exchange", _RETURN_FIELDS)
    assert data["urgency"] == "vip"
    assert data["sla"]["close_after"] is None
    now = datetime.now(UTC)
    _set_sla(
        db_path,
        data["id"],
        warn_at=(now - timedelta(hours=1)).isoformat(),
        due_at=(now - timedelta(minutes=1)).isoformat(),
        close_after=None,
        warned=True,
        escalated=False,
        escalate_role="after_sales_supervisor",
    )
    got = _reload(client, headers, conversation_id)
    assert got["status"] != "closed"
    assert got["assigned_role"] == "after_sales_supervisor"
    assert got["assigned_display"] == "售后主管"


def test_upgrade_without_on_duty_keeps_display(
    client: TestClient, db_path: Path
) -> None:
    _on_duty(client, "specialist")
    headers, conversation_id = _open(client)
    data = _confirm(client, headers, conversation_id, "address_change", _ADDRESS_FIELDS)
    now = datetime.now(UTC)
    _set_sla(
        db_path,
        data["id"],
        warn_at=(now - timedelta(hours=1)).isoformat(),
        due_at=(now - timedelta(minutes=1)).isoformat(),
        close_after=(now + timedelta(hours=20)).isoformat(),
        warned=True,
        escalated=False,
        escalate_role="supervisor",
    )
    got = _reload(client, headers, conversation_id)
    assert got["assigned_display"] == "主管"
    assert got["assigned_display"] not in {None, "", "无人认领"}
    assert got["upgrade_undelivered"] is True
    assert got["assigned_user_id"] is None
    assert got["status"] != "closed"


_COMPLAINT_FIELDS = {
    "order_no": "JD20260922003",
    "product_info": "耳机",
    "amount": "199",
    "intent_summary": "投诉服务态度",
    "complaint_category": "服务态度",
    "incident_summary": "多次推诿",
    "user_expectation": "道歉并跟进",
    "need_escalate": "false",
}


def test_complaint_close_notice_then_user_speech_blocks_auto_close(
    client: TestClient, db_path: Path
) -> None:
    _on_duty(client, "specialist")
    _on_duty(client, "cs_lead")
    employee = _login(client, "employee")
    created = client.post("/api/conversations", headers=_auth(employee))
    conversation_id = created.json()["data"]["id"]
    assert client.post(
        f"/api/conversations/{conversation_id}/transfer", headers=_auth(employee)
    ).status_code == 200
    agent = _auth(_login(client, "agent"))
    data = _confirm(client, agent, conversation_id, "complaint", _COMPLAINT_FIELDS)
    assert data["sla"]["close_after"]
    now = datetime.now(UTC)
    _set_sla(
        db_path,
        data["id"],
        warn_at=(now - timedelta(hours=10)).isoformat(),
        due_at=(now - timedelta(minutes=2)).isoformat(),
        close_after=(now + timedelta(hours=70)).isoformat(),
        warned=True,
        escalated=False,
        escalate_role="cs_lead",
        close_notice_sent=False,
    )
    noticed = _reload(client, agent, conversation_id)
    assert noticed["status"] != "closed"
    assert any(
        "关闭预告" in (item.get("detail") or "")
        or item.get("event") == "close_notice"
        for item in noticed["progress"]
    )
    spoke = client.post(
        f"/api/conversations/{conversation_id}/messages",
        headers=_auth(employee),
        json={"content": "我还在等处理"},
    )
    assert spoke.status_code == 200
    _set_sla(
        db_path,
        data["id"],
        close_after=(now - timedelta(minutes=1)).isoformat(),
        warned=True,
        escalated=True,
        close_notice_sent=True,
    )
    blocked = _reload(client, agent, conversation_id)
    assert blocked["status"] != "closed"
    assert any(item.get("event") == "close_skipped" for item in blocked["progress"])


def test_complaint_auto_closes_72h_after_warn_when_user_silent(
    client: TestClient, db_path: Path
) -> None:
    _on_duty(client, "specialist")
    _on_duty(client, "cs_lead")
    headers, conversation_id = _open(client)
    data = _confirm(client, headers, conversation_id, "complaint", _COMPLAINT_FIELDS)
    now = datetime.now(UTC)
    _set_sla(
        db_path,
        data["id"],
        warn_at=(now - timedelta(hours=72)).isoformat(),
        due_at=(now - timedelta(hours=64)).isoformat(),
        close_after=(now - timedelta(minutes=1)).isoformat(),
        warned=True,
        escalated=False,
        escalate_role="cs_lead",
        close_notice_sent=False,
    )
    closed = _reload(client, headers, conversation_id)
    assert closed["status"] == "closed"
    assert any(item.get("event") == "closed" for item in closed["progress"])
