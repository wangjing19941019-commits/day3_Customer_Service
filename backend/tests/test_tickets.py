from __future__ import annotations

import json
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
_PUBLIC_KEYS = {
    "id",
    "ticket_no",
    "conversation_id",
    "status",
    "ticket_type",
    "business_line",
    "urgency",
    "queue",
    "assigned_role",
    "assigned_user_id",
    "assigned_display",
    "upgrade_undelivered",
    "extract_status",
    "extract_error",
    "can_confirm",
    "confirm_blockers",
    "fields",
    "order_match",
    "logistics_snapshot",
    "attachments",
    "progress",
    "sla",
    "confirmed_at",
    "created_at",
    "updated_at",
}
_COMMON_KEYS = {"order_no", "product_info", "amount", "intent_summary"}
_RETURN_KEYS = _COMMON_KEYS | {"return_method", "return_reason", "quantity"}
_INVOICE_KEYS = _COMMON_KEYS | {"invoice_kind", "invoice_title", "tax_id", "invoice_contact"}
_FEE_KEYS = _COMMON_KEYS | {"dispute_type", "claimed_amount", "platform_amount", "diff_reason"}
_LOGISTICS_KEYS = _COMMON_KEYS | {
    "tracking_no",
    "exception_type",
    "responsible_party",
    "user_request",
    "compensation_plan",
}
_PROMPT_DIR = Path("backend/src/prompts/ticket")
_RETURN_FIELDS = {
    "order_no": "JD20260922001",
    "product_info": "连衣裙 M 码",
    "amount": "80",
    "intent_summary": "质量问题要求退货",
    "return_method": "return_only",
    "return_reason": "质量问题",
    "quantity": "1",
}


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


class FakeExtractLlm:
    def __init__(self) -> None:
        self.chat_calls: list[dict] = []
        self.payload: dict = {
            "order_no": "JD20260922001",
            "product_info": "连衣裙 M 码",
            "amount": "99",
            "intent_summary": "质量问题要求退货",
            "return_method": "return_only",
            "return_reason": "质量问题",
            "quantity": "1",
            "time_range_text": None,
            "keywords": [],
        }
        self.low_keys: set[str] = set()
        self.chat_error: Exception | None = None

    async def chat_completions(
        self, messages: list[dict[str, str]], *, json_object: bool = False
    ) -> str:
        if self.chat_error is not None:
            raise self.chat_error
        self.chat_calls.append({"json_object": json_object, "messages": messages})
        user = messages[-1]["content"] if messages else ""
        payload = dict(self.payload)
        if "88" in user:
            payload["amount"] = "88"
        wrapped: dict = {}
        for key, value in payload.items():
            if key in {"time_range_text", "keywords"}:
                wrapped[key] = value
                continue
            confidence = "low" if key in self.low_keys else "high"
            wrapped[key] = {"value": value, "confidence": confidence}
        return json.dumps(wrapped, ensure_ascii=False)


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


def _assert_public(data: dict) -> None:
    assert set(data) == _PUBLIC_KEYS


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "test.db"


@pytest.fixture
def fake_llm() -> Generator[FakeExtractLlm, None, None]:
    fake = FakeExtractLlm()
    set_extract_llm_override(fake)
    yield fake
    set_extract_llm_override(None)


@pytest.fixture
def fake_order() -> Generator[MockOrderAdapter, None, None]:
    fake = MockOrderAdapter()
    set_order_adapter_override(fake)
    yield fake
    set_order_adapter_override(None)


@pytest.fixture
def fake_logistics() -> Generator[MockLogisticsAdapter, None, None]:
    fake = MockLogisticsAdapter()
    set_logistics_adapter_override(fake)
    yield fake
    set_logistics_adapter_override(None)


@pytest.fixture
def client(
    db_path: Path,
    fake_llm: FakeExtractLlm,
    fake_order: MockOrderAdapter,
    fake_logistics: MockLogisticsAdapter,
) -> Generator[TestClient, None, None]:
    ConfigManager.reset()
    reset_engine()
    set_extract_llm_override(fake_llm)
    set_order_adapter_override(fake_order)
    set_logistics_adapter_override(fake_logistics)
    ConfigManager().load_from_dict(AppSettings, _settings(str(db_path)))
    from src.main import app

    with TestClient(app) as test_client:
        yield test_client
    set_extract_llm_override(None)
    set_order_adapter_override(None)
    set_logistics_adapter_override(None)
    reset_engine()
    ConfigManager.reset()


@pytest.fixture
def client_no_key(
    db_path: Path, fake_order: MockOrderAdapter, fake_logistics: MockLogisticsAdapter
) -> Generator[TestClient, None, None]:
    ConfigManager.reset()
    reset_engine()
    set_extract_llm_override(None)
    set_order_adapter_override(fake_order)
    set_logistics_adapter_override(fake_logistics)
    ConfigManager().load_from_dict(AppSettings, _settings(str(db_path), llm_api_key=""))
    from src.main import app

    with TestClient(app) as test_client:
        yield test_client
    set_extract_llm_override(None)
    set_order_adapter_override(None)
    set_logistics_adapter_override(None)
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


def _ticket_url(conversation_id: str) -> str:
    return f"/api/conversations/{conversation_id}/ticket"


def test_get_ticket_requires_bearer(client: TestClient) -> None:
    response = client.get(_ticket_url(str(uuid4())))
    assert response.status_code == 401
    body = response.json()
    _assert_envelope(body, success=False)
    assert body["error_code"] == "UNAUTHORIZED"


def test_bot_session_ticket_is_409(client: TestClient) -> None:
    headers = _auth_header(client)
    created = client.post("/api/conversations", headers=headers)
    conversation_id = created.json()["data"]["id"]
    response = client.get(_ticket_url(conversation_id), headers=headers)
    assert response.status_code == 409
    body = response.json()
    _assert_envelope(body, success=False)
    assert body["error_code"] == "CONFLICT"
    assert body["error"] == "会话尚未转人工，不能填单"


def test_missing_conversation_is_404(client: TestClient) -> None:
    headers = _auth_header(client)
    response = client.get(_ticket_url(str(uuid4())), headers=headers)
    assert response.status_code == 404
    body = response.json()
    _assert_envelope(body, success=False)
    assert body["error_code"] == "NOT_FOUND"
    assert body["error"] == "会话不存在"


def test_handed_off_get_creates_draft_without_llm_or_adapters(
    client: TestClient,
    fake_llm: FakeExtractLlm,
    fake_order: MockOrderAdapter,
    fake_logistics: MockLogisticsAdapter,
) -> None:
    headers, conversation_id = _open_handed_off(client)
    calls_before = len(fake_llm.chat_calls)
    order_before = len(fake_order.calls)
    logistics_before = len(fake_logistics.calls)
    response = client.get(_ticket_url(conversation_id), headers=headers)
    assert response.status_code == 200
    body = response.json()
    _assert_envelope(body, success=True)
    data = body["data"]
    _assert_public(data)
    assert data["conversation_id"] == conversation_id
    assert data["status"] == "draft"
    assert data["ticket_no"] is None
    assert data["ticket_type"] is None
    assert data["business_line"] is None
    assert data["extract_status"] == "idle"
    assert data["can_confirm"] is False
    assert "ticket_type" in data["confirm_blockers"]
    assert "business_line" in data["confirm_blockers"]
    assert data["confirmed_at"] is None
    assert data["order_match"] is None
    assert data["logistics_snapshot"] is None
    assert data["attachments"] == []
    assert data["sla"] is None
    assert set(data["fields"]) == _COMMON_KEYS
    assert data["fields"]["order_no"]["status"] == "missing"
    assert len(fake_llm.chat_calls) == calls_before
    assert len(fake_order.calls) == order_before
    assert len(fake_logistics.calls) == logistics_before
    again = client.get(_ticket_url(conversation_id), headers=headers)
    assert again.json()["data"]["id"] == data["id"]
    assert again.json()["data"]["status"] == "draft"


def test_confirm_without_type_or_line_is_409(client: TestClient) -> None:
    headers, conversation_id = _open_handed_off(client)
    confirm = client.post(f"{_ticket_url(conversation_id)}/confirm", headers=headers)
    assert confirm.status_code == 409
    body = confirm.json()
    _assert_envelope(body, success=False)
    assert body["error"] == "请先选择售后工单类型"

    patched = client.patch(
        _ticket_url(conversation_id),
        headers=headers,
        json={"ticket_type": "return_exchange"},
    )
    assert patched.status_code == 200
    assert patched.json()["data"]["extract_status"] == "extracting"
    confirm_line = client.post(f"{_ticket_url(conversation_id)}/confirm", headers=headers)
    assert confirm_line.status_code == 409
    assert confirm_line.json()["error"] == "请先选择业务线"
    assert client.get(_ticket_url(conversation_id), headers=headers).json()["data"]["status"] == (
        "draft"
    )


def test_missing_required_fields_block_confirm(client: TestClient) -> None:
    headers, conversation_id = _open_handed_off(client)
    client.patch(
        _ticket_url(conversation_id),
        headers=headers,
        json={"ticket_type": "return_exchange", "business_line": "apparel_beauty"},
    )
    confirm = client.post(f"{_ticket_url(conversation_id)}/confirm", headers=headers)
    assert confirm.status_code == 409
    body = confirm.json()
    _assert_envelope(body, success=False)
    assert body["error_code"] == "CONFLICT"
    blockers = body["metadata"]["confirm_blockers"]
    assert blockers
    assert any(key in body["error"] for key in blockers)
    assert client.get(_ticket_url(conversation_id), headers=headers).json()["data"]["status"] == (
        "draft"
    )


def test_patch_type_extracts_in_background_and_get_skips_model(
    client: TestClient, fake_llm: FakeExtractLlm, fake_order: MockOrderAdapter
) -> None:
    headers, conversation_id = _open_handed_off(client)
    client.post(
        f"/api/conversations/{conversation_id}/messages",
        headers=headers,
        json={"content": "订单 JD20260922001，连衣裙 M 码质量问题要退货，金额 99"},
    )
    patched = client.patch(
        _ticket_url(conversation_id),
        headers=headers,
        json={"ticket_type": "return_exchange", "business_line": "apparel_beauty"},
    )
    assert patched.status_code == 200
    patch_data = patched.json()["data"]
    _assert_public(patch_data)
    assert patch_data["extract_status"] == "extracting"
    assert patch_data["can_confirm"] is False
    assert set(patch_data["fields"]) == _RETURN_KEYS
    calls_after_patch = len(fake_llm.chat_calls)
    order_after_patch = len(fake_order.calls)
    got = client.get(_ticket_url(conversation_id), headers=headers)
    data = got.json()["data"]
    assert data["extract_status"] == "ready"
    assert data["fields"]["amount"]["value"] == "99"
    assert data["fields"]["amount"]["status"] == "filled"
    assert data["fields"]["return_method"]["value"] == "return_only"
    assert len(fake_llm.chat_calls) == calls_after_patch
    assert len(fake_order.calls) == order_after_patch
    assert fake_llm.chat_calls
    assert fake_llm.chat_calls[0]["json_object"] is True
    system = fake_llm.chat_calls[0]["messages"][0]["content"]
    assert "服饰美妆" in system
    assert "Plugin" not in system
    assert "OMS" not in system


def test_confirm_then_patch_type_409_fields_and_line_ok(client: TestClient) -> None:
    headers, conversation_id = _open_handed_off(client)
    client.patch(
        _ticket_url(conversation_id),
        headers=headers,
        json={
            "ticket_type": "return_exchange",
            "business_line": "apparel_beauty",
            "fields": _RETURN_FIELDS,
        },
    )
    confirmed = client.post(f"{_ticket_url(conversation_id)}/confirm", headers=headers)
    assert confirmed.status_code == 200
    data = confirmed.json()["data"]
    _assert_public(data)
    assert data["status"] == "pending"
    assert data["ticket_no"]
    assert data["ticket_no"].startswith("TKT-")
    assert data["can_confirm"] is False
    assert data["confirmed_at"]
    assert data["urgency"] is None
    assert data["queue"] is None
    assert data["assigned_role"] is None
    assert data["fields"]["amount"]["value"] == "80"
    again = client.post(f"{_ticket_url(conversation_id)}/confirm", headers=headers)
    assert again.status_code == 200
    assert again.json()["data"]["id"] == data["id"]
    assert again.json()["data"]["status"] == "pending"
    assert again.json()["data"]["ticket_no"] == data["ticket_no"]

    type_change = client.patch(
        _ticket_url(conversation_id),
        headers=headers,
        json={"ticket_type": "invoice"},
    )
    assert type_change.status_code == 409
    assert type_change.json()["error"] == "工单已确认，不能更改工单类型"
    assert type_change.json()["error_code"] == "CONFLICT"

    line = client.patch(
        _ticket_url(conversation_id),
        headers=headers,
        json={"business_line": "digital_3c"},
    )
    assert line.status_code == 200
    assert line.json()["data"]["business_line"] == "digital_3c"
    assert line.json()["data"]["status"] == "pending"
    assert line.json()["data"]["ticket_type"] == "return_exchange"

    fields = client.patch(
        _ticket_url(conversation_id),
        headers=headers,
        json={"fields": {"intent_summary": "坐席手改摘要"}},
    )
    assert fields.status_code == 200
    assert fields.json()["data"]["fields"]["intent_summary"]["status"] == "agent_edited"
    assert fields.json()["data"]["fields"]["intent_summary"]["value"] == "坐席手改摘要"


def test_confirm_then_new_message_does_not_extract(
    client: TestClient, fake_llm: FakeExtractLlm
) -> None:
    headers, conversation_id = _open_handed_off(client)
    client.patch(
        _ticket_url(conversation_id),
        headers=headers,
        json={
            "ticket_type": "return_exchange",
            "business_line": "apparel_beauty",
            "fields": _RETURN_FIELDS,
        },
    )
    client.post(f"{_ticket_url(conversation_id)}/confirm", headers=headers)
    calls = len(fake_llm.chat_calls)
    posted = client.post(
        f"/api/conversations/{conversation_id}/messages",
        headers=headers,
        json={"content": "改成 88 元"},
    )
    assert posted.status_code == 200
    assert "ticket_type" not in posted.json()["data"]
    assert len(fake_llm.chat_calls) == calls
    got = client.get(_ticket_url(conversation_id), headers=headers).json()["data"]
    assert got["status"] == "pending"
    assert got["fields"]["amount"]["value"] == "80"


def test_ungrounded_amount_is_missing(client: TestClient, fake_llm: FakeExtractLlm) -> None:
    headers, conversation_id = _open_handed_off(client)
    fake_llm.payload["amount"] = "12345"
    client.post(
        f"/api/conversations/{conversation_id}/messages",
        headers=headers,
        json={"content": "这件连衣裙要退货，没有说金额"},
    )
    client.patch(
        _ticket_url(conversation_id),
        headers=headers,
        json={"ticket_type": "return_exchange", "business_line": "apparel_beauty"},
    )
    data = client.get(_ticket_url(conversation_id), headers=headers).json()["data"]
    assert data["fields"]["amount"]["value"] is None
    assert data["fields"]["amount"]["status"] == "missing"


def test_switch_type_changes_visible_keys(client: TestClient) -> None:
    headers, conversation_id = _open_handed_off(client)
    returned = client.patch(
        _ticket_url(conversation_id),
        headers=headers,
        json={"ticket_type": "return_exchange", "business_line": "apparel_beauty"},
    )
    assert set(returned.json()["data"]["fields"]) == _RETURN_KEYS
    invoiced = client.patch(
        _ticket_url(conversation_id),
        headers=headers,
        json={"ticket_type": "invoice"},
    )
    assert set(invoiced.json()["data"]["fields"]) == _INVOICE_KEYS
    assert "return_method" not in invoiced.json()["data"]["fields"]
    assert "tax_id" in invoiced.json()["data"]["fields"]
    fee = client.patch(
        _ticket_url(conversation_id),
        headers=headers,
        json={"ticket_type": "fee_dispute"},
    )
    assert set(fee.json()["data"]["fields"]) == _FEE_KEYS
    logistics = client.patch(
        _ticket_url(conversation_id),
        headers=headers,
        json={"ticket_type": "logistics_exception"},
    )
    assert set(logistics.json()["data"]["fields"]) == _LOGISTICS_KEYS


def test_patch_unknown_field_key_is_400(client: TestClient) -> None:
    headers, conversation_id = _open_handed_off(client)
    response = client.patch(
        _ticket_url(conversation_id),
        headers=headers,
        json={"fields": {"tax_id": "123"}},
    )
    assert response.status_code == 400
    body = response.json()
    _assert_envelope(body, success=False)
    assert body["error_code"] == "VALIDATION_ERROR"
    assert body["error"] == "工单字段无效"


def test_vat_special_without_tax_id_cannot_confirm(client: TestClient) -> None:
    headers, conversation_id = _open_handed_off(client)
    client.patch(
        _ticket_url(conversation_id),
        headers=headers,
        json={
            "ticket_type": "invoice",
            "business_line": "digital_3c",
            "fields": {
                "order_no": "JD1",
                "product_info": "手机",
                "amount": "99",
                "intent_summary": "要专票",
                "invoice_kind": "vat_special",
                "invoice_title": "测试公司",
                "invoice_contact": "a@example.com",
            },
        },
    )
    confirm = client.post(f"{_ticket_url(conversation_id)}/confirm", headers=headers)
    assert confirm.status_code == 409
    assert confirm.json()["error"] == "专用发票需要纳税人识别号"
    filled = client.patch(
        _ticket_url(conversation_id),
        headers=headers,
        json={"fields": {"tax_id": "91110000MA12345678"}},
    )
    assert filled.status_code == 200
    ok = client.post(f"{_ticket_url(conversation_id)}/confirm", headers=headers)
    assert ok.status_code == 200
    assert ok.json()["data"]["status"] == "pending"
    assert ok.json()["data"]["ticket_no"]


def test_fee_dispute_without_attachment_cannot_confirm(client: TestClient) -> None:
    headers, conversation_id = _open_handed_off(client)
    client.patch(
        _ticket_url(conversation_id),
        headers=headers,
        json={
            "ticket_type": "fee_dispute",
            "business_line": "digital_3c",
            "fields": {
                "order_no": "JD1",
                "product_info": "手机",
                "amount": "99",
                "intent_summary": "价保",
                "dispute_type": "price_protect",
                "claimed_amount": "50",
                "platform_amount": "20",
                "diff_reason": "活动价差",
            },
        },
    )
    confirm = client.post(f"{_ticket_url(conversation_id)}/confirm", headers=headers)
    assert confirm.status_code == 409
    assert confirm.json()["error"] == "费用争议需要证据截图"
    data = client.get(_ticket_url(conversation_id), headers=headers).json()["data"]
    assert data["status"] == "draft"
    assert "attachments" in data["confirm_blockers"]


def test_stale_extracting_marked_failed_keeps_fields(
    client: TestClient, db_path: Path
) -> None:
    headers, conversation_id = _open_handed_off(client)
    client.patch(
        _ticket_url(conversation_id),
        headers=headers,
        json={
            "ticket_type": "return_exchange",
            "business_line": "apparel_beauty",
            "fields": {"amount": "80"},
        },
    )
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        UPDATE tickets
        SET extract_status = 'extracting', extract_error = NULL, updated_at = ?
        WHERE conversation_id = ?
        """,
        ("2000-01-01T00:00:00", conversation_id),
    )
    conn.commit()
    conn.close()
    got = client.get(_ticket_url(conversation_id), headers=headers)
    data = got.json()["data"]
    assert data["extract_status"] == "failed"
    assert data["extract_error"] == "抽取暂时失败，请稍后重试或手填"
    assert data["fields"]["amount"]["value"] == "80"
    assert data["status"] == "draft"


def test_no_key_hand_fill_confirm_still_200(client_no_key: TestClient) -> None:
    headers, conversation_id = _open_handed_off(client_no_key)
    patched = client_no_key.patch(
        _ticket_url(conversation_id),
        headers=headers,
        json={"ticket_type": "complaint", "business_line": "digital_3c"},
    )
    assert patched.status_code == 200
    after = client_no_key.get(_ticket_url(conversation_id), headers=headers).json()["data"]
    assert after["extract_status"] == "failed"
    filled = client_no_key.patch(
        _ticket_url(conversation_id),
        headers=headers,
        json={
            "fields": {
                "order_no": "JD1",
                "product_info": "包装",
                "amount": "10",
                "intent_summary": "用户投诉包装破损",
                "complaint_category": "物流",
                "incident_summary": "外箱破损",
                "user_expectation": "补发",
                "need_escalate": "false",
            }
        },
    )
    assert filled.status_code == 200
    confirmed = client_no_key.post(
        f"{_ticket_url(conversation_id)}/confirm", headers=headers
    )
    assert confirmed.status_code == 200
    data = confirmed.json()["data"]
    _assert_public(data)
    assert data["status"] == "pending"
    assert data["ticket_no"]
    assert data["fields"]["intent_summary"]["value"] == "用户投诉包装破损"


def test_extract_prompts_have_no_plugin_or_oms() -> None:
    files = list(_PROMPT_DIR.glob("extract_*.md")) + list(_PROMPT_DIR.glob("line_*.md"))
    assert {path.name for path in files} == {
        "extract_common.md",
        "extract_return_exchange.md",
        "extract_address_change.md",
        "extract_invoice.md",
        "extract_complaint.md",
        "extract_fee_dispute.md",
        "extract_logistics_exception.md",
        "line_digital_3c.md",
        "line_apparel_beauty.md",
    }
    joined = "\n".join(path.read_text(encoding="utf-8") for path in files).lower()
    assert "plugin" not in joined
    assert "oms" not in joined
    assert "dashscope" not in joined
