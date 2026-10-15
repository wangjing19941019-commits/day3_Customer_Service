from __future__ import annotations

import json
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pycore.core.config import ConfigManager
from src.db.session import AppSettings, reset_engine
from src.integrations.adapters.logistics import (
    MockLogisticsAdapter,
    set_logistics_adapter_override,
)
from src.integrations.adapters.order import MockOrderAdapter, set_order_adapter_override
from src.services.ticket import _merge_slot, set_extract_llm_override

_TEST_SECRET = "test-secret-placeholder"
_TEST_PASSWORD = "it-help123"


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


class FakeExtractLlm:
    def __init__(self) -> None:
        self.chat_calls: list[dict] = []
        self.payload: dict = {
            "order_no": None,
            "product_info": "蓝色手机",
            "amount": "99",
            "intent_summary": "要退昨天买的蓝色手机",
            "return_method": None,
            "return_reason": None,
            "quantity": None,
            "time_range_text": "昨天",
            "keywords": ["蓝色", "手机"],
        }
        self.low_keys: set[str] = set()

    async def chat_completions(
        self, messages: list[dict[str, str]], *, json_object: bool = False
    ) -> str:
        self.chat_calls.append({"json_object": json_object, "messages": messages})
        user = messages[-1]["content"] if messages else ""
        payload = dict(self.payload)
        if "88" in user:
            payload["amount"] = "88"
        if "屏幕有划痕" in user:
            payload["return_reason"] = "屏幕有划痕"
        wrapped: dict = {}
        for key, value in payload.items():
            if key in {"time_range_text", "keywords"}:
                wrapped[key] = value
                continue
            confidence = "low" if key in self.low_keys else "high"
            wrapped[key] = {"value": value, "confidence": confidence}
        return json.dumps(wrapped, ensure_ascii=False)


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "extract.db"


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


def _auth_header(client: TestClient) -> dict[str, str]:
    login = client.post(
        "/api/sessions",
        json={"username": "it-help", "password": _TEST_PASSWORD},
    )
    return {"Authorization": f"Bearer {login.json()['data']['access_token']}"}


def _open_handed_off(client: TestClient) -> tuple[dict[str, str], str]:
    headers = _auth_header(client)
    created = client.post("/api/conversations", headers=headers)
    conversation_id = created.json()["data"]["id"]
    client.post(f"/api/conversations/{conversation_id}/transfer", headers=headers)
    return headers, conversation_id


def _ticket_url(conversation_id: str) -> str:
    return f"/api/conversations/{conversation_id}/ticket"


def _prepare_return_draft(
    client: TestClient, content: str = "我昨天买的那个蓝色手机要退，金额 99"
) -> tuple[dict[str, str], str]:
    headers, conversation_id = _open_handed_off(client)
    client.post(
        f"/api/conversations/{conversation_id}/messages",
        headers=headers,
        json={"content": content},
    )
    client.patch(
        _ticket_url(conversation_id),
        headers=headers,
        json={"ticket_type": "return_exchange", "business_line": "digital_3c"},
    )
    return headers, conversation_id


def test_later_high_confidence_amount_keeps_original_and_marks_conflict(
    client: TestClient,
) -> None:
    headers, conversation_id = _prepare_return_draft(client)
    first = client.get(_ticket_url(conversation_id), headers=headers).json()["data"]
    assert first["fields"]["amount"]["value"] == "99"
    assert first["fields"]["amount"]["status"] == "filled"
    client.post(
        f"/api/conversations/{conversation_id}/messages",
        headers=headers,
        json={"content": "改成 88 元"},
    )
    second = client.get(_ticket_url(conversation_id), headers=headers).json()["data"]
    amount = second["fields"]["amount"]
    assert amount["value"] == "99"
    assert amount["status"] == "conflict"
    assert amount["conflict_value"] == "88"
    confirm = client.post(f"{_ticket_url(conversation_id)}/confirm", headers=headers)
    assert confirm.status_code == 409
    assert "amount" in confirm.json()["metadata"]["confirm_blockers"]
    assert "amount" in confirm.json()["error"]


def test_agent_edited_is_not_overwritten(client: TestClient) -> None:
    headers, conversation_id = _prepare_return_draft(client)
    edited = client.patch(
        _ticket_url(conversation_id),
        headers=headers,
        json={"fields": {"amount": "80"}},
    )
    assert edited.status_code == 200
    assert edited.json()["data"]["fields"]["amount"]["status"] == "agent_edited"
    assert edited.json()["data"]["fields"]["amount"]["value"] == "80"
    client.post(
        f"/api/conversations/{conversation_id}/messages",
        headers=headers,
        json={"content": "其实是 88"},
    )
    after_edit = client.get(_ticket_url(conversation_id), headers=headers).json()["data"]
    assert after_edit["fields"]["amount"]["value"] == "80"
    assert after_edit["fields"]["amount"]["status"] == "conflict"
    assert after_edit["fields"]["amount"]["conflict_value"] == "88"


def test_reextracted_same_amount_with_unit_is_not_conflict(
    client: TestClient, fake_llm: FakeExtractLlm
) -> None:
    headers, conversation_id = _prepare_return_draft(client)
    first = client.get(_ticket_url(conversation_id), headers=headers).json()["data"]
    assert first["fields"]["amount"]["value"] == "99"
    fake_llm.payload["amount"] = "99元"
    client.post(
        f"/api/conversations/{conversation_id}/messages",
        headers=headers,
        json={"content": "退 1 件，金额是 99元"},
    )
    second = client.get(_ticket_url(conversation_id), headers=headers).json()["data"]
    amount = second["fields"]["amount"]
    assert amount["value"] == "99"
    assert amount["status"] == "filled"
    assert amount["conflict_value"] is None


@pytest.mark.parametrize(
    ("current_value", "new_value"),
    [("99", "99元"), ("99", "¥99.00"), ("99", " 99 "), ("８８", "88块")],
)
def test_merge_slot_amount_equivalents_do_not_conflict(
    current_value: str, new_value: str
) -> None:
    current = {"value": current_value, "status": "filled", "candidates": []}
    merged = _merge_slot(current, new_value, "high", "amount")
    assert merged["status"] == "filled"
    assert merged["value"] == current_value


def test_merge_slot_different_amount_keeps_original_and_conflicts() -> None:
    current = {"value": "99", "status": "filled", "candidates": []}
    merged = _merge_slot(current, "88元", "high", "amount")
    assert merged["value"] == "99"
    assert merged["status"] == "conflict"
    assert merged["conflict_value"] == "88元"


def test_merge_slot_agent_pick_not_conflicted_by_unit_variant() -> None:
    current = {"value": "88", "status": "agent_edited", "candidates": []}
    merged = _merge_slot(current, "88元", "high", "amount")
    assert merged["status"] == "agent_edited"
    assert merged["value"] == "88"


def test_low_confidence_is_candidate_and_blocks_confirm(
    client: TestClient, fake_llm: FakeExtractLlm
) -> None:
    fake_llm.low_keys.add("amount")
    headers, conversation_id = _prepare_return_draft(client)
    data = client.get(_ticket_url(conversation_id), headers=headers).json()["data"]
    amount = data["fields"]["amount"]
    assert amount["value"] is None
    assert amount["status"] == "candidate"
    assert any(item.get("value") == "99" for item in amount["candidates"])
    confirm = client.post(f"{_ticket_url(conversation_id)}/confirm", headers=headers)
    assert confirm.status_code == 409
    assert "amount" in confirm.json()["metadata"]["confirm_blockers"]


def test_ext003_one_hit_auto_fills_order_no(
    client: TestClient, fake_order: MockOrderAdapter
) -> None:
    fake_order.rows = [
        {
            "order_no": "JD20260922001",
            "title": "蓝色手机",
            "ordered_at": "2026-09-21T10:00:00.000000",
        }
    ]
    headers, conversation_id = _prepare_return_draft(client)
    data = client.get(_ticket_url(conversation_id), headers=headers).json()["data"]
    assert data["fields"]["order_no"]["value"] == "JD20260922001"
    assert data["fields"]["order_no"]["status"] == "filled"
    assert data["order_match"]["status"] == "auto_filled"
    assert data["order_match"]["candidates"][0]["order_no"] == "JD20260922001"
    assert fake_order.calls
    assert fake_order.calls[0]["time_range"] == "昨天"


def test_ext003_two_hits_are_candidates_without_preselect(
    client: TestClient, fake_order: MockOrderAdapter
) -> None:
    fake_order.rows = [
        {"order_no": "JD-A", "title": "蓝色手机", "ordered_at": "2026-09-21T10:00:00.000000"},
        {"order_no": "JD-B", "title": "蓝色手机", "ordered_at": "2026-09-21T18:00:00.000000"},
    ]
    headers, conversation_id = _prepare_return_draft(client)
    data = client.get(_ticket_url(conversation_id), headers=headers).json()["data"]
    order_no = data["fields"]["order_no"]
    assert order_no["value"] is None
    assert order_no["status"] == "candidate"
    listed = [item["order_no"] for item in order_no["candidates"]]
    assert listed == ["JD-A", "JD-B"]
    assert data["order_match"]["status"] == "candidates"
    confirm = client.post(f"{_ticket_url(conversation_id)}/confirm", headers=headers)
    assert confirm.status_code == 409
    assert "order_no" in confirm.json()["metadata"]["confirm_blockers"]


def test_ext003_zero_hits_missing_with_message(
    client: TestClient, fake_order: MockOrderAdapter
) -> None:
    fake_order.rows = []
    headers, conversation_id = _prepare_return_draft(client)
    data = client.get(_ticket_url(conversation_id), headers=headers).json()["data"]
    assert data["fields"]["order_no"]["value"] is None
    assert data["fields"]["order_no"]["status"] == "missing"
    assert data["order_match"]["status"] == "missing"
    assert data["order_match"]["query_message"] == "暂未查到"


def test_ext003_failure_missing_with_message(
    client: TestClient, fake_order: MockOrderAdapter
) -> None:
    fake_order.fail = True
    headers, conversation_id = _prepare_return_draft(client)
    data = client.get(_ticket_url(conversation_id), headers=headers).json()["data"]
    assert data["fields"]["order_no"]["value"] is None
    assert data["fields"]["order_no"]["status"] == "missing"
    assert data["order_match"]["status"] == "query_failed"
    assert data["order_match"]["query_message"] == "暂未查到"
    assert data["extract_status"] == "ready"


def test_get_does_not_call_adapters(
    client: TestClient, fake_order: MockOrderAdapter, fake_logistics: MockLogisticsAdapter
) -> None:
    headers, conversation_id = _prepare_return_draft(client)
    order_calls = len(fake_order.calls)
    logistics_calls = len(fake_logistics.calls)
    client.get(_ticket_url(conversation_id), headers=headers)
    client.get(_ticket_url(conversation_id), headers=headers)
    assert len(fake_order.calls) == order_calls
    assert len(fake_logistics.calls) == logistics_calls


def test_logistics_track_failed_blocks_responsible_party_patch(
    client: TestClient, fake_llm: FakeExtractLlm, fake_logistics: MockLogisticsAdapter
) -> None:
    fake_llm.payload.update(
        {
            "tracking_no": None,
            "exception_type": "lost",
            "responsible_party": "courier",
            "user_request": "查丢件",
            "compensation_plan": "赔付",
        }
    )
    fake_logistics.snapshot = {"events": [], "sign_status": None, "query_status": "failed"}
    headers, conversation_id = _open_handed_off(client)
    client.post(
        f"/api/conversations/{conversation_id}/messages",
        headers=headers,
        json={"content": "快递丢了"},
    )
    client.patch(
        _ticket_url(conversation_id),
        headers=headers,
        json={"ticket_type": "logistics_exception", "business_line": "digital_3c"},
    )
    data = client.get(_ticket_url(conversation_id), headers=headers).json()["data"]
    assert data["logistics_snapshot"]["query_status"] == "failed"
    assert "查不到" in data["logistics_snapshot"]["note"]
    assert "不能判断责任方" in data["logistics_snapshot"]["note"]
    assert data["fields"]["responsible_party"]["status"] == "missing"
    assert data["fields"]["compensation_plan"]["status"] == "missing"
    blocked = client.patch(
        _ticket_url(conversation_id),
        headers=headers,
        json={"fields": {"responsible_party": "courier"}},
    )
    assert blocked.status_code == 409
    assert blocked.json()["error"] == "物流轨迹暂未核实，不能填写责任方或补偿方案"
    compensation = client.patch(
        _ticket_url(conversation_id),
        headers=headers,
        json={"fields": {"compensation_plan": "赔 50"}},
    )
    assert compensation.status_code == 409


def test_logistics_track_ok_allows_agent_fill(
    client: TestClient, fake_llm: FakeExtractLlm, fake_logistics: MockLogisticsAdapter
) -> None:
    fake_llm.payload.update(
        {
            "tracking_no": "SF001",
            "exception_type": "delay",
            "user_request": "催件",
            "responsible_party": "courier",
            "compensation_plan": "赔付",
        }
    )
    fake_logistics.snapshot = {
        "events": [{"text": "运输中"}],
        "sign_status": "in_transit",
        "query_status": "ok",
    }
    headers, conversation_id = _open_handed_off(client)
    client.post(
        f"/api/conversations/{conversation_id}/messages",
        headers=headers,
        json={"content": "运单 SF001 一直没到"},
    )
    client.patch(
        _ticket_url(conversation_id),
        headers=headers,
        json={"ticket_type": "logistics_exception", "business_line": "digital_3c"},
    )
    data = client.get(_ticket_url(conversation_id), headers=headers).json()["data"]
    assert data["logistics_snapshot"]["query_status"] == "ok"
    assert data["logistics_snapshot"]["note"] is None
    assert data["fields"]["responsible_party"]["status"] == "missing"
    filled = client.patch(
        _ticket_url(conversation_id),
        headers=headers,
        json={"fields": {"responsible_party": "courier"}},
    )
    assert filled.status_code == 200
    assert filled.json()["data"]["fields"]["responsible_party"]["status"] == "agent_edited"


def test_logistics_lost_but_signed_note_states_both_without_party(
    client: TestClient, fake_llm: FakeExtractLlm, fake_logistics: MockLogisticsAdapter
) -> None:
    fake_llm.payload.update(
        {
            "tracking_no": "SF002",
            "exception_type": "lost",
            "user_request": "查丢件",
            "responsible_party": "courier",
            "compensation_plan": "赔付",
        }
    )
    fake_logistics.snapshot = {
        "events": [{"text": "本人签收"}],
        "sign_status": "signed",
        "query_status": "ok",
    }
    headers, conversation_id = _open_handed_off(client)
    client.post(
        f"/api/conversations/{conversation_id}/messages",
        headers=headers,
        json={"content": "运单 SF002 快递丢了"},
    )
    client.patch(
        _ticket_url(conversation_id),
        headers=headers,
        json={"ticket_type": "logistics_exception", "business_line": "digital_3c"},
    )
    data = client.get(_ticket_url(conversation_id), headers=headers).json()["data"]
    note = data["logistics_snapshot"]["note"]
    assert "用户称快递丢失" in note
    assert "已签收" in note
    assert "尚未核实" in note
    assert data["fields"]["responsible_party"]["status"] == "missing"
    assert data["fields"]["compensation_plan"]["status"] == "missing"
