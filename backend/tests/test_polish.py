from __future__ import annotations

from collections.abc import Generator
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pycore.core.config import ConfigManager
from src.db.session import AppSettings, reset_engine
from src.integrations.bailian import BailianError
from src.services.polish import check_compliance, set_polish_llm_override
from src.services.ticket import set_extract_llm_override

_TEST_SECRET = "test-secret-placeholder"
_TEST_PASSWORD = "it-help123"
_UNAVAILABLE = "服务暂时不可用，请稍后重试。"
_POLISHED = "您好，已了解您希望办理退货。请提供订单号，我们会按售后流程帮您登记。"
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
    "original_content",
    "polished_content",
    "compliance_passed",
    "can_adopt",
    "risk_reasons",
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


class FakePolishLlm:
    def __init__(self) -> None:
        self.chat_calls: list[dict] = []
        self.text_raw: str = _POLISHED
        self.chat_error: Exception | None = None

    async def chat_completions(
        self, messages: list[dict[str, str]], *, json_object: bool = False
    ) -> str:
        if self.chat_error is not None:
            raise self.chat_error
        self.chat_calls.append({"json_object": json_object, "messages": messages})
        return self.text_raw


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


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "test.db"


@pytest.fixture
def fake_llm() -> Generator[FakePolishLlm, None, None]:
    fake = FakePolishLlm()
    set_polish_llm_override(fake)
    set_extract_llm_override(fake)
    yield fake
    set_polish_llm_override(None)
    set_extract_llm_override(None)


@pytest.fixture
def client(db_path: Path, fake_llm: FakePolishLlm) -> Generator[TestClient, None, None]:
    ConfigManager.reset()
    reset_engine()
    set_polish_llm_override(fake_llm)
    set_extract_llm_override(fake_llm)
    ConfigManager().load_from_dict(AppSettings, _settings(str(db_path)))
    from src.main import app

    with TestClient(app) as test_client:
        yield test_client
    set_polish_llm_override(None)
    set_extract_llm_override(None)
    reset_engine()
    ConfigManager.reset()


@pytest.fixture
def client_no_key(db_path: Path) -> Generator[TestClient, None, None]:
    ConfigManager.reset()
    reset_engine()
    set_polish_llm_override(None)
    set_extract_llm_override(None)
    ConfigManager().load_from_dict(AppSettings, _settings(str(db_path), llm_api_key=""))
    from src.main import app

    with TestClient(app) as test_client:
        yield test_client
    set_polish_llm_override(None)
    set_extract_llm_override(None)
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


def _polish_url(conversation_id: str) -> str:
    return f"/api/conversations/{conversation_id}/replies/polish"


def _event_outcomes(db_path: Path, conversation_id: str) -> list[tuple[str | None, str | None]]:
    import sqlite3

    conn = sqlite3.connect(db_path)
    rows = conn.execute(
        "SELECT outcome, polished_content FROM template_polish_events "
        "WHERE conversation_id = ? ORDER BY created_at",
        (conversation_id,),
    ).fetchall()
    conn.close()
    return rows


def test_sent_reply_marks_polish_adopted_modified_or_discarded(
    client: TestClient, fake_llm: FakePolishLlm, db_path: Path
) -> None:
    headers, conversation_id = _open_handed_off(client)
    client.patch(
        f"/api/conversations/{conversation_id}/ticket",
        headers=headers,
        json={"ticket_type": "return_exchange", "business_line": "apparel_beauty"},
    )
    replies = f"/api/conversations/{conversation_id}/replies"

    polished = client.post(
        _polish_url(conversation_id), headers=headers, json={"content": "退货发单号"}
    )
    assert polished.status_code == 200
    assert client.post(replies, headers=headers, json={"content": _POLISHED}).status_code == 200

    client.post(_polish_url(conversation_id), headers=headers, json={"content": "退货发单号"})
    client.post(replies, headers=headers, json={"content": _POLISHED + "谢谢您的耐心。"})

    client.post(_polish_url(conversation_id), headers=headers, json={"content": "第一稿"})
    client.post(_polish_url(conversation_id), headers=headers, json={"content": "第二稿"})
    client.post(replies, headers=headers, json={"content": "第二稿"})

    outcomes = [row[0] for row in _event_outcomes(db_path, conversation_id)]
    assert outcomes == ["adopted", "modified", "discarded", "discarded"]
    assert _event_outcomes(db_path, conversation_id)[0][1] == _POLISHED


def _message_snapshot(
    client: TestClient, headers: dict[str, str], conversation_id: str
) -> list[tuple[str, str, str]]:
    detail = client.get(f"/api/conversations/{conversation_id}", headers=headers)
    assert detail.status_code == 200
    return [
        (item["id"], item["role"], item["content"])
        for item in detail.json()["data"]["messages"]
    ]


def test_polish_prompt_forbids_new_promises() -> None:
    text = Path("backend/src/prompts/ticket/polish.md").read_text(encoding="utf-8")
    assert "一定全额退" in text
    assert "赔付" in text
    assert "改价" in text
    assert "退款" in text
    assert "愤怒" in text
    assert "时效" in text


def test_compliance_rejects_new_payout_and_keeps_existing_deadline() -> None:
    passed, reasons = check_compliance(
        "你这个退不了，超时间了",
        "已超过 7 天无理由，不能直接退货，我们可以继续看其他办法。",
        "用户：签收已经超过 7 天了",
        ticket_type="return_exchange",
    )
    assert passed is True
    assert reasons == []
    failed, fail_reasons = check_compliance(
        "帮看一下能不能退",
        "可以一定全额退，赔500元。",
        "用户：质量有问题想退货",
        ticket_type="return_exchange",
    )
    assert failed is False
    assert fail_reasons
    assert any("赔付金额" in item or "退款保证" in item for item in fail_reasons)


def test_compliance_rejects_dropped_draft_amount() -> None:
    conversation = "用户：我主张应退200元，平台核算只退120元"
    original = "您主张退差价200元，平台核算可退120元，差异是活动券不参与价保。"
    passed, reasons = check_compliance(
        original,
        "平台核算可退差价为120元，差异部分是活动券不参与价保。",
        conversation,
        ticket_type="fee_dispute",
    )
    assert passed is False
    assert "润色稿删掉了原稿中的金额" in reasons
    kept, kept_reasons = check_compliance(
        original,
        "您好，您主张退差价200元，平台核算可退120元，差异原因是活动券不参与价保。",
        conversation,
        ticket_type="fee_dispute",
    )
    assert kept is True
    assert kept_reasons == []


def test_polish_requires_bearer(client: TestClient) -> None:
    response = client.post(_polish_url(str(uuid4())), json={"content": "退货"})
    assert response.status_code == 401
    body = response.json()
    _assert_envelope(body, success=False)
    assert body["error_code"] == "UNAUTHORIZED"


def test_polish_empty_content_is_400(client: TestClient) -> None:
    headers, conversation_id = _open_handed_off(client)
    response = client.post(
        _polish_url(conversation_id),
        headers=headers,
        json={"content": "   "},
    )
    assert response.status_code == 400
    body = response.json()
    _assert_envelope(body, success=False)
    assert body["error_code"] == "VALIDATION_ERROR"
    assert body["error"] == "请输入回复内容"


def test_bot_session_polish_is_409(client: TestClient) -> None:
    headers = _auth_header(client)
    created = client.post("/api/conversations", headers=headers)
    conversation_id = created.json()["data"]["id"]
    response = client.post(
        _polish_url(conversation_id),
        headers=headers,
        json={"content": "退货 把单号发一下"},
    )
    assert response.status_code == 409
    body = response.json()
    _assert_envelope(body, success=False)
    assert body["error_code"] == "CONFLICT"
    assert body["error"] == "会话尚未转人工"
    still = client.get(f"/api/conversations/{conversation_id}", headers=headers)
    assert still.json()["data"]["status"] == "bot"
    assert still.json()["data"]["messages"] == []


def test_polish_preview_does_not_write_or_send(
    client: TestClient, fake_llm: FakePolishLlm
) -> None:
    headers, conversation_id = _open_handed_off(client)
    client.post(
        f"/api/conversations/{conversation_id}/messages",
        headers=headers,
        json={"content": "质量有问题想退货"},
    )
    client.patch(
        f"/api/conversations/{conversation_id}/ticket",
        headers=headers,
        json={"ticket_type": "complaint", "business_line": "digital_3c"},
    )
    original = "退货 把单号发一下"
    before = _message_snapshot(client, headers, conversation_id)
    response = client.post(
        _polish_url(conversation_id),
        headers=headers,
        json={"content": original},
    )
    assert response.status_code == 200
    body = response.json()
    _assert_envelope(body, success=True)
    data = body["data"]
    assert set(data) == _PUBLIC_KEYS
    assert data["original_content"] == original
    assert data["polished_content"] == _POLISHED
    assert data["compliance_passed"] is True
    assert data["can_adopt"] is True
    assert data["risk_reasons"] == []
    assert "一定全额退" not in data["polished_content"]
    assert _message_snapshot(client, headers, conversation_id) == before
    polish_calls = [item for item in fake_llm.chat_calls if item["json_object"] is False]
    assert polish_calls
    system = polish_calls[-1]["messages"][0]["content"]
    user = polish_calls[-1]["messages"][1]["content"]
    assert "一定全额退" in system
    assert "业务线口径：3C 数码" in system
    assert "禁止写成服饰美妆的七天无理由" in system
    assert "业务线口径：服饰美妆" not in system
    assert "当前业务线：3C 数码" in user
    assert "当前是售前咨询" not in user


def test_unlocked_line_does_not_use_exclusive_tone(
    client: TestClient, fake_llm: FakePolishLlm
) -> None:
    headers, conversation_id = _open_handed_off(client)
    response = client.post(
        _polish_url(conversation_id),
        headers=headers,
        json={"content": "帮看一下能不能退"},
    )
    assert response.status_code == 200
    polish_calls = [item for item in fake_llm.chat_calls if item["json_object"] is False]
    user = polish_calls[-1]["messages"][1]["content"]
    system = polish_calls[-1]["messages"][0]["content"]
    assert "未锁定业务线，不要使用 3C 或服饰专属承诺" in user
    assert "line_digital_3c" not in system
    assert "业务线口径：3C 数码" not in system
    assert "业务线口径：服饰美妆" not in system
    assert "当前工单类型：售前咨询（未建工单）" in user
    assert "原稿没有提到的退换货、售后、退款规则不要补充" in user


def test_sent_agent_reply_is_marked_and_not_to_be_repeated(
    client: TestClient, fake_llm: FakePolishLlm
) -> None:
    headers, conversation_id = _open_handed_off(client)
    prior = "您已签收10天，暂无法办理七天无理由退货。"
    sent = client.post(
        f"/api/conversations/{conversation_id}/replies",
        headers=headers,
        json={"content": prior},
    )
    assert sent.status_code == 200
    response = client.post(
        _polish_url(conversation_id),
        headers=headers,
        json={"content": "我这边先帮您登记一下"},
    )
    assert response.status_code == 200
    polish_calls = [item for item in fake_llm.chat_calls if item["json_object"] is False]
    user = polish_calls[-1]["messages"][1]["content"]
    system = polish_calls[-1]["messages"][0]["content"]
    assert f"坐席（已发出）: {prior}" in user
    assert user.rstrip().endswith("处理进度不要补充。")
    assert "不要复述" in user
    assert "信息以原稿为准" in system


def test_return_template_is_selected_for_published_after_sale(
    client: TestClient, fake_llm: FakePolishLlm
) -> None:
    headers, conversation_id = _open_handed_off(client)
    client.patch(
        f"/api/conversations/{conversation_id}/ticket",
        headers=headers,
        json={"ticket_type": "return_exchange", "business_line": "digital_3c"},
    )
    response = client.post(
        _polish_url(conversation_id),
        headers=headers,
        json={"content": "退货 把单号发一下"},
    )
    assert response.status_code == 200
    polish_calls = [item for item in fake_llm.chat_calls if item["json_object"] is False]
    system = polish_calls[-1]["messages"][0]["content"]
    assert "{{emotion}}" not in system
    assert "用户情绪" in system or "售后说明" in system


def test_noncompliant_polish_is_200_but_cannot_adopt(
    client: TestClient, fake_llm: FakePolishLlm
) -> None:
    headers, conversation_id = _open_handed_off(client)
    client.post(
        f"/api/conversations/{conversation_id}/messages",
        headers=headers,
        json={"content": "质量有问题想退货"},
    )
    original = "帮看一下能不能退"
    fake_llm.text_raw = "可以一定全额退，赔500元。"
    before = _message_snapshot(client, headers, conversation_id)
    response = client.post(
        _polish_url(conversation_id),
        headers=headers,
        json={"content": original},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert set(data) == _PUBLIC_KEYS
    assert data["original_content"] == original
    assert data["polished_content"] == fake_llm.text_raw
    assert data["compliance_passed"] is False
    assert data["can_adopt"] is False
    assert data["risk_reasons"]
    assert any("赔付金额" in item or "退款保证" in item for item in data["risk_reasons"])
    assert _message_snapshot(client, headers, conversation_id) == before


def test_chat_failure_is_502_then_api012_sends_original(
    client: TestClient, fake_llm: FakePolishLlm
) -> None:
    headers, conversation_id = _open_handed_off(client)
    original = "退货 把单号发一下"
    fake_llm.chat_error = BailianError("调用超时")
    before = _message_snapshot(client, headers, conversation_id)
    failed = client.post(
        _polish_url(conversation_id),
        headers=headers,
        json={"content": original},
    )
    assert failed.status_code == 502
    body = failed.json()
    _assert_envelope(body, success=False)
    assert body["error_code"] == "INTERNAL_ERROR"
    assert body["error"] == _UNAVAILABLE
    assert _message_snapshot(client, headers, conversation_id) == before

    sent = client.post(
        f"/api/conversations/{conversation_id}/replies",
        headers=headers,
        json={"content": original},
    )
    assert sent.status_code == 200
    assert sent.json()["data"]["reply"]["content"] == original
    assert sent.json()["data"]["reply"]["role"] == "agent"
    assert sent.json()["data"]["reply"]["kind"] == "agent"


def test_no_key_polish_is_502_then_api012_still_sends(client_no_key: TestClient) -> None:
    headers, conversation_id = _open_handed_off(client_no_key)
    original = "请提供订单号"
    failed = client_no_key.post(
        _polish_url(conversation_id),
        headers=headers,
        json={"content": original},
    )
    assert failed.status_code == 502
    body = failed.json()
    _assert_envelope(body, success=False)
    assert body["error"] == _UNAVAILABLE
    sent = client_no_key.post(
        f"/api/conversations/{conversation_id}/replies",
        headers=headers,
        json={"content": original},
    )
    assert sent.status_code == 200
    assert sent.json()["data"]["reply"]["content"] == original


def test_empty_model_output_is_502(client: TestClient, fake_llm: FakePolishLlm) -> None:
    headers, conversation_id = _open_handed_off(client)
    fake_llm.text_raw = "   "
    response = client.post(
        _polish_url(conversation_id),
        headers=headers,
        json={"content": "帮我润色一下"},
    )
    assert response.status_code == 502
    assert response.json()["error"] == _UNAVAILABLE
