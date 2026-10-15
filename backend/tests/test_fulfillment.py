from __future__ import annotations

import json
import sqlite3
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pycore.core.config import ConfigManager
from src.db.session import AppSettings, reset_engine
from src.integrations.adapters.finance import MockFinanceAdapter, set_finance_adapter_override
from src.integrations.adapters.member import MockMemberAdapter, set_member_adapter_override
from src.integrations.adapters.warehouse import MockWarehouseAdapter, set_warehouse_adapter_override

_TEST_SECRET = "test-secret-placeholder"
_TEST_PASSWORD = "it-help123"
_SEED_PASSWORD = "seed-password-placeholder"
_FORBIDDEN_RETURN = "已生成退货单"
_FORBIDDEN_INVOICE = "已开票"
_RETURN_FIELDS = {
    "order_no": "JD20260922001",
    "product_info": "连衣裙 M 码",
    "amount": "80",
    "intent_summary": "质量问题要求退货",
    "return_method": "return_only",
    "return_reason": "质量问题",
    "quantity": "1",
}
_INVOICE_FIELDS = {
    "order_no": "JD20260922001",
    "product_info": "连衣裙 M 码",
    "amount": "80",
    "intent_summary": "需要开普通发票",
    "invoice_kind": "plain",
    "invoice_title": "个人",
    "invoice_contact": "13800138000",
}
_ADDRESS_FIELDS = {
    "order_no": "JD20260922001",
    "product_info": "连衣裙 M 码",
    "amount": "80",
    "intent_summary": "改到新地址",
    "new_address": "上海市浦东新区示例路1号",
    "recipient_name": "张三",
    "phone": "13800138000",
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
        "warehouse_base_url": "",
        "finance_base_url": "",
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
def fake_warehouse() -> Generator[MockWarehouseAdapter, None, None]:
    fake = MockWarehouseAdapter()
    set_warehouse_adapter_override(fake)
    yield fake
    set_warehouse_adapter_override(None)


@pytest.fixture
def fake_finance() -> Generator[MockFinanceAdapter, None, None]:
    fake = MockFinanceAdapter()
    set_finance_adapter_override(fake)
    yield fake
    set_finance_adapter_override(None)


@pytest.fixture
def client(
    db_path: Path,
    fake_member: MockMemberAdapter,
    fake_warehouse: MockWarehouseAdapter,
    fake_finance: MockFinanceAdapter,
) -> Generator[TestClient, None, None]:
    ConfigManager.reset()
    reset_engine()
    set_member_adapter_override(fake_member)
    set_warehouse_adapter_override(fake_warehouse)
    set_finance_adapter_override(fake_finance)
    ConfigManager().load_from_dict(AppSettings, _settings(str(db_path)))
    from src.main import app

    with TestClient(app) as test_client:
        yield test_client
    set_warehouse_adapter_override(None)
    set_finance_adapter_override(None)
    set_member_adapter_override(None)
    reset_engine()
    ConfigManager.reset()


@pytest.fixture
def client_default_mock(
    db_path: Path, fake_member: MockMemberAdapter
) -> Generator[TestClient, None, None]:
    ConfigManager.reset()
    reset_engine()
    set_member_adapter_override(fake_member)
    set_warehouse_adapter_override(None)
    set_finance_adapter_override(None)
    ConfigManager().load_from_dict(AppSettings, _settings(str(db_path)))
    from src.main import app

    with TestClient(app) as test_client:
        yield test_client
    set_warehouse_adapter_override(None)
    set_finance_adapter_override(None)
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


def _confirm(
    client: TestClient,
    headers: dict[str, str],
    conversation_id: str,
    ticket_type: str,
    fields: dict[str, str],
) -> dict:
    patched = client.patch(
        f"/api/conversations/{conversation_id}/ticket",
        headers=headers,
        json={
            "ticket_type": ticket_type,
            "business_line": "apparel_beauty",
            "fields": fields,
        },
    )
    assert patched.status_code == 200, patched.text
    confirmed = client.post(
        f"/api/conversations/{conversation_id}/ticket/confirm",
        headers=headers,
    )
    assert confirmed.status_code == 200, confirmed.text
    return confirmed.json()["data"]


def _progress_dump(data: dict) -> str:
    return json.dumps(data.get("progress") or [], ensure_ascii=False)


def _progress_details(data: dict) -> list[str]:
    details: list[str] = []
    for item in data.get("progress") or []:
        if isinstance(item, dict) and isinstance(item.get("detail"), str):
            details.append(item["detail"])
    return details


def test_return_accepted_writes_initiated_progress(
    client: TestClient, fake_warehouse: MockWarehouseAdapter
) -> None:
    _on_duty(client, "specialist")
    headers, conversation_id = _open(client)
    data = _confirm(client, headers, conversation_id, "return_exchange", _RETURN_FIELDS)
    assert fake_warehouse.calls
    details = _progress_details(data)
    assert "已发起退货" in details
    dumped = _progress_dump(data)
    assert _FORBIDDEN_RETURN not in dumped
    assert _FORBIDDEN_INVOICE not in dumped


def test_return_rejected_shows_failure_without_return_slip(
    client: TestClient, fake_warehouse: MockWarehouseAdapter
) -> None:
    fake_warehouse.accepted = False
    fake_warehouse.error = "仓储接口拒绝了退货申请"
    _on_duty(client, "specialist")
    headers, conversation_id = _open(client)
    data = _confirm(client, headers, conversation_id, "return_exchange", _RETURN_FIELDS)
    details = _progress_details(data)
    assert details
    assert "已发起退货" not in details
    dumped = json.dumps(data, ensure_ascii=False)
    assert "仓储接口拒绝了退货申请" in dumped
    assert _FORBIDDEN_RETURN not in dumped
    assert _FORBIDDEN_INVOICE not in dumped


def test_invoice_accepted_writes_initiated_progress(
    client: TestClient, fake_finance: MockFinanceAdapter
) -> None:
    _on_duty(client, "specialist")
    headers, conversation_id = _open(client)
    data = _confirm(client, headers, conversation_id, "invoice", _INVOICE_FIELDS)
    assert fake_finance.calls
    details = _progress_details(data)
    assert "已发起开票" in details
    dumped = _progress_dump(data)
    assert _FORBIDDEN_INVOICE not in dumped
    assert _FORBIDDEN_RETURN not in dumped


def test_invoice_rejected_shows_failure_without_invoiced(
    client: TestClient, fake_finance: MockFinanceAdapter
) -> None:
    fake_finance.accepted = False
    fake_finance.error = "财务接口拒绝了开票申请"
    _on_duty(client, "specialist")
    headers, conversation_id = _open(client)
    data = _confirm(client, headers, conversation_id, "invoice", _INVOICE_FIELDS)
    details = _progress_details(data)
    assert details
    assert "已发起开票" not in details
    dumped = json.dumps(data, ensure_ascii=False)
    assert "财务接口拒绝了开票申请" in dumped
    assert _FORBIDDEN_INVOICE not in dumped
    assert _FORBIDDEN_RETURN not in dumped


def test_empty_warehouse_url_uses_process_mock(client_default_mock: TestClient) -> None:
    _on_duty(client_default_mock, "specialist")
    headers, conversation_id = _open(client_default_mock)
    data = _confirm(
        client_default_mock, headers, conversation_id, "return_exchange", _RETURN_FIELDS
    )
    details = _progress_details(data)
    assert "已发起退货" in details
    dumped = json.dumps(data, ensure_ascii=False)
    assert _FORBIDDEN_RETURN not in dumped
    assert "sk-" not in dumped
    assert "Bearer " not in dumped


def test_address_change_does_not_call_warehouse_or_finance(
    client: TestClient,
    fake_warehouse: MockWarehouseAdapter,
    fake_finance: MockFinanceAdapter,
) -> None:
    _on_duty(client, "specialist")
    headers, conversation_id = _open(client)
    _confirm(client, headers, conversation_id, "address_change", _ADDRESS_FIELDS)
    assert fake_warehouse.calls == []
    assert fake_finance.calls == []


def test_duplicate_confirm_does_not_create_second_intent(
    client: TestClient, fake_warehouse: MockWarehouseAdapter, db_path: Path
) -> None:
    _on_duty(client, "specialist")
    headers, conversation_id = _open(client)
    first = _confirm(client, headers, conversation_id, "return_exchange", _RETURN_FIELDS)
    again = client.post(
        f"/api/conversations/{conversation_id}/ticket/confirm",
        headers=headers,
    )
    assert again.status_code == 200
    second = again.json()["data"]
    assert len(fake_warehouse.calls) == 1
    assert fake_warehouse.calls[0]["ticket_id"] == first["id"]
    assert len(_progress_details(second)) == len(_progress_details(first))
    rows = sqlite3.connect(db_path).execute(
        "SELECT COUNT(*) FROM messages WHERE conversation_id = ? AND kind = ?",
        (conversation_id, "ticket_progress"),
    ).fetchone()
    assert rows is not None
    assert int(rows[0]) == 1
