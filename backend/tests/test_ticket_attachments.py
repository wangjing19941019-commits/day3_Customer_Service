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
_FEE_FIELDS = {
    "order_no": "JD1",
    "product_info": "手机",
    "amount": "99",
    "intent_summary": "价保",
    "dispute_type": "price_protect",
    "claimed_amount": "50",
    "platform_amount": "20",
    "diff_reason": "活动价差",
}
_PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
    b"\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


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
def upload_dir(tmp_path: Path) -> Path:
    path = tmp_path / "uploads"
    path.mkdir()
    return path


@pytest.fixture
def client(db_path: Path, upload_dir: Path) -> Generator[TestClient, None, None]:
    ConfigManager.reset()
    reset_engine()
    set_extract_llm_override(None)
    set_order_adapter_override(MockOrderAdapter())
    set_logistics_adapter_override(MockLogisticsAdapter())
    ConfigManager().load_from_dict(AppSettings, _settings(str(db_path), str(upload_dir)))
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


def _fill_fee_dispute(client: TestClient, headers: dict[str, str], conversation_id: str) -> None:
    patched = client.patch(
        _ticket_url(conversation_id),
        headers=headers,
        json={
            "ticket_type": "fee_dispute",
            "business_line": "digital_3c",
            "fields": _FEE_FIELDS,
        },
    )
    assert patched.status_code == 200


def test_fee_dispute_without_attachment_cannot_confirm(client: TestClient) -> None:
    headers, conversation_id = _open_handed_off(client)
    _fill_fee_dispute(client, headers, conversation_id)
    confirm = client.post(f"{_ticket_url(conversation_id)}/confirm", headers=headers)
    assert confirm.status_code == 409
    body = confirm.json()
    _assert_envelope(body, success=False)
    assert body["error"] == "费用争议需要证据截图"
    data = client.get(_ticket_url(conversation_id), headers=headers).json()["data"]
    assert data["status"] == "draft"
    assert "attachments" in data["confirm_blockers"]
    assert data["attachments"] == []


def test_fee_dispute_confirm_after_valid_image(
    client: TestClient, upload_dir: Path, db_path: Path
) -> None:
    headers, conversation_id = _open_handed_off(client)
    _fill_fee_dispute(client, headers, conversation_id)
    blocked = client.post(f"{_ticket_url(conversation_id)}/confirm", headers=headers)
    assert blocked.status_code == 409
    uploaded = client.post(
        f"{_ticket_url(conversation_id)}/attachments",
        headers=headers,
        files={"file": ("evidence.png", _PNG_BYTES, "image/png")},
    )
    assert uploaded.status_code == 200
    body = uploaded.json()
    _assert_envelope(body, success=True)
    attachments = body["data"]["attachments"]
    assert len(attachments) == 1
    assert attachments[0]["filename"] == "evidence.png"
    stored = upload_dir / attachments[0]["path"]
    assert stored.is_file()
    assert stored.read_bytes() == _PNG_BYTES
    assert (upload_dir / "tickets").is_dir()
    confirm = client.post(f"{_ticket_url(conversation_id)}/confirm", headers=headers)
    assert confirm.status_code == 200
    confirmed = confirm.json()["data"]
    assert confirmed["status"] == "pending"
    assert confirmed["ticket_no"]
    assert "attachments" not in confirmed["confirm_blockers"]
    rows = sqlite3.connect(db_path).execute(
        "SELECT stored_path FROM ticket_attachments WHERE conversation_id = ?",
        (conversation_id,),
    ).fetchall()
    assert rows
    assert rows[0][0].startswith("tickets/")


def test_illegal_attachment_extension_is_400(client: TestClient, upload_dir: Path) -> None:
    headers, conversation_id = _open_handed_off(client)
    response = client.post(
        f"{_ticket_url(conversation_id)}/attachments",
        headers=headers,
        files={"file": ("note.txt", b"not-an-image", "text/plain")},
    )
    assert response.status_code == 400
    body = response.json()
    _assert_envelope(body, success=False)
    assert body["error"] == "请重新上传"
    assert body["error_code"] == "VALIDATION_ERROR"
    tickets_dir = upload_dir / "tickets"
    if tickets_dir.exists():
        assert not any(tickets_dir.glob("*"))
    gif = client.post(
        f"{_ticket_url(conversation_id)}/attachments",
        headers=headers,
        files={"file": ("shot.gif", b"GIF89a", "image/gif")},
    )
    assert gif.status_code == 400
    assert gif.json()["error"] == "请重新上传"


def test_attachment_missing_conversation_is_404(client: TestClient) -> None:
    headers = _auth_header(client)
    response = client.post(
        f"{_ticket_url(str(uuid4()))}/attachments",
        headers=headers,
        files={"file": ("evidence.png", _PNG_BYTES, "image/png")},
    )
    assert response.status_code == 404
    body = response.json()
    _assert_envelope(body, success=False)
    assert body["error_code"] == "NOT_FOUND"
