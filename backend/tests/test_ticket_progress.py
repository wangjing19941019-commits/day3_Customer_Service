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
_NO_PROGRESS = "目前没有可查询的工单进度。"
_ASK = "我的退款到哪了"
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
    assert patched.status_code == 200, patched.text
    confirmed = client.post(
        f"/api/conversations/{conversation_id}/ticket/confirm",
        headers=headers,
    )
    assert confirmed.status_code == 200, confirmed.text
    return confirmed.json()["data"]


def _progress_messages(db_path: Path, conversation_id: str) -> list[tuple[str, str]]:
    rows = sqlite3.connect(db_path).execute(
        "SELECT kind, content FROM messages WHERE conversation_id = ? ORDER BY created_at",
        (conversation_id,),
    ).fetchall()
    return [(str(kind), str(content)) for kind, content in rows]


def test_confirm_writes_ticket_progress_to_original_session(
    client: TestClient, db_path: Path
) -> None:
    _on_duty(client, "specialist")
    headers, conversation_id = _open(client)
    data = _confirm_return(client, headers, conversation_id)
    details = [
        item.get("detail")
        for item in data.get("progress") or []
        if isinstance(item, dict)
    ]
    assert "已发起退货" in details
    dumped = json.dumps(data, ensure_ascii=False)
    assert _FORBIDDEN_RETURN not in dumped
    assert _FORBIDDEN_INVOICE not in dumped
    kinds = [kind for kind, _content in _progress_messages(db_path, conversation_id)]
    assert "ticket_progress" in kinds
    contents = [
        content
        for kind, content in _progress_messages(db_path, conversation_id)
        if kind == "ticket_progress"
    ]
    assert "已发起退货" in contents
    for content in contents:
        assert _FORBIDDEN_RETURN not in content
        assert _FORBIDDEN_INVOICE not in content
    loaded = client.get(f"/api/conversations/{conversation_id}", headers=headers)
    assert loaded.status_code == 200, loaded.text
    messages = loaded.json()["data"]["messages"]
    progress = [item for item in messages if item.get("kind") == "ticket_progress"]
    assert progress
    assert progress[-1]["content"] == "已发起退货"


def test_ask_refund_progress_returns_same_statement(client: TestClient) -> None:
    _on_duty(client, "specialist")
    headers, conversation_id = _open(client)
    data = _confirm_return(client, headers, conversation_id)
    latest = None
    for item in data.get("progress") or []:
        if isinstance(item, dict) and isinstance(item.get("detail"), str):
            latest = item["detail"]
    assert latest == "已发起退货"
    asked = client.post(
        f"/api/conversations/{conversation_id}/messages",
        headers=headers,
        json={"content": _ASK},
    )
    assert asked.status_code == 200, asked.text
    body = asked.json()["data"]
    reply = body["reply"]
    assert reply["kind"] == "ticket_progress"
    assert reply["content"] == latest
    assert reply["content"] != "已转交客服，请等待回复。"
    assert "到账" not in reply["content"]
    assert _FORBIDDEN_RETURN not in reply["content"]


def test_no_ticket_does_not_invent_arrival(client: TestClient) -> None:
    headers, conversation_id = _open(client)
    asked = client.post(
        f"/api/conversations/{conversation_id}/messages",
        headers=headers,
        json={"content": _ASK},
    )
    assert asked.status_code == 200, asked.text
    reply = asked.json()["data"]["reply"]
    assert reply["kind"] == "ticket_progress"
    assert reply["content"] == _NO_PROGRESS
    assert "到账" not in reply["content"]
    assert _FORBIDDEN_RETURN not in reply["content"]
    assert _FORBIDDEN_INVOICE not in reply["content"]
