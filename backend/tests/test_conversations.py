from collections.abc import Generator
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pycore.core.config import ConfigManager
from src.db.session import AppSettings, reset_engine

_TEST_SECRET = "test-secret-placeholder"
_TEST_PASSWORD = "it-help123"
_JWT_EXPIRE_MINUTES = 720


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
        "jwt_expire_minutes": _JWT_EXPIRE_MINUTES,
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
        "chunk_overlap_chars": 80,
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
def client(db_path: Path) -> Generator[TestClient, None, None]:
    ConfigManager.reset()
    reset_engine()
    ConfigManager().load_from_dict(AppSettings, _settings(str(db_path)))
    from src.main import app

    with TestClient(app) as test_client:
        yield test_client
    reset_engine()
    ConfigManager.reset()


def _auth_header(client: TestClient) -> dict[str, str]:
    login = client.post(
        "/api/sessions",
        json={"username": "it-help", "password": _TEST_PASSWORD},
    )
    token = login.json()["data"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _insert_employee_turn(db_path: Path, conversation_id: str) -> None:
    import sqlite3

    now = datetime.now(UTC).isoformat()
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        INSERT INTO messages (
            id, conversation_id, role, kind, content,
            original_content, rewritten_content, created_at
        ) VALUES (?, ?, 'employee', 'employee_turn', ?, ?, ?, ?)
        """,
        (
            str(uuid4()),
            conversation_id,
            "VPN 连不上",
            "VPN 连不上",
            "VPN 连接失败排查",
            now,
        ),
    )
    conn.commit()
    conn.close()


def test_create_conversation_requires_bearer(client: TestClient) -> None:
    response = client.post("/api/conversations")
    assert response.status_code == 401
    body = response.json()
    assert body["success"] is False
    assert body["error_code"] == "UNAUTHORIZED"
    assert body["error"] == "请先登录"


def test_create_conversation_status_bot(client: TestClient) -> None:
    response = client.post("/api/conversations", headers=_auth_header(client))
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    data = body["data"]
    assert data["status"] == "bot"
    assert data["waiting_for_agent"] is False
    assert data["clarification_round"] == 0
    assert data["messages"] == []
    assert isinstance(data["id"], str) and data["id"]
    assert data["created_at"]
    assert data["updated_at"]


def test_list_does_not_return_bot_until_transfer(
    client: TestClient, db_path: Path
) -> None:
    headers = _auth_header(client)
    created = client.post("/api/conversations", headers=headers)
    conversation_id = created.json()["data"]["id"]
    listed = client.get("/api/conversations", headers=headers)
    assert listed.status_code == 200
    body = listed.json()
    assert body["success"] is True
    ids = [item["id"] for item in body["data"]]
    assert conversation_id not in ids
    assert all(item["status"] == "handed_off" for item in body["data"])

    missing = client.post("/api/conversations", headers=headers)
    bot_id = missing.json()["data"]["id"]
    transferred = client.post(f"/api/conversations/{conversation_id}/transfer", headers=headers)
    assert transferred.status_code == 200
    assert transferred.json()["data"]["status"] == "handed_off"
    assert transferred.json()["data"]["waiting_for_agent"] is True

    listed_after = client.get("/api/conversations", headers=headers)
    assert listed_after.status_code == 200
    after_body = listed_after.json()
    after_ids = [item["id"] for item in after_body["data"]]
    assert conversation_id in after_ids
    assert bot_id not in after_ids
    item = next(row for row in after_body["data"] if row["id"] == conversation_id)
    assert item["status"] == "handed_off"
    assert item["waiting_for_agent"] is True
    assert "preview" in item
    assert after_body["pagination"]["total_items"] >= 1

    _insert_employee_turn(db_path, conversation_id)
    detail = client.get(f"/api/conversations/{conversation_id}", headers=headers)
    assert detail.status_code == 200
    messages = detail.json()["data"]["messages"]
    assert messages
    assert "original_content" in messages[0]
    assert "rewritten_content" in messages[0]
    assert messages[0]["original_content"] == "VPN 连不上"
    assert messages[0]["rewritten_content"] == "VPN 连接失败排查"


def test_detail_missing_conversation_is_404(client: TestClient) -> None:
    headers = _auth_header(client)
    response = client.get(f"/api/conversations/{uuid4()}", headers=headers)
    assert response.status_code == 404
    body = response.json()
    assert body["success"] is False
    assert body["error_code"] == "NOT_FOUND"
    assert body["error"] == "会话不存在"


def test_untransferred_agent_reply_is_409(client: TestClient) -> None:
    headers = _auth_header(client)
    created = client.post("/api/conversations", headers=headers)
    conversation_id = created.json()["data"]["id"]
    response = client.post(
        f"/api/conversations/{conversation_id}/replies",
        headers=headers,
        json={"content": "请先重启客户端再试。"},
    )
    assert response.status_code == 409
    body = response.json()
    assert body["success"] is False
    assert body["error_code"] == "CONFLICT"
    assert body["error"] == "会话尚未转人工，无法以客服身份回复"
    still_bot = client.get(f"/api/conversations/{conversation_id}", headers=headers)
    assert still_bot.json()["data"]["status"] == "bot"
    assert still_bot.json()["data"]["messages"] == []


def test_agent_reply_after_transfer(client: TestClient) -> None:
    headers = _auth_header(client)
    created = client.post("/api/conversations", headers=headers)
    conversation_id = created.json()["data"]["id"]
    client.post(f"/api/conversations/{conversation_id}/transfer", headers=headers)
    again = client.post(f"/api/conversations/{conversation_id}/transfer", headers=headers)
    assert again.status_code == 200
    assert again.json()["data"]["status"] == "handed_off"

    response = client.post(
        f"/api/conversations/{conversation_id}/replies",
        headers=headers,
        json={"content": "请改用公司配置文件后重连 VPN。"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    reply = body["data"]["reply"]
    conversation = body["data"]["conversation"]
    assert reply["role"] == "agent"
    assert reply["kind"] == "agent"
    assert reply["content"] == "请改用公司配置文件后重连 VPN。"
    assert reply["original_content"] is None
    assert reply["rewritten_content"] is None
    assert conversation["status"] == "handed_off"
    assert conversation["waiting_for_agent"] is False
    assert conversation["messages"][-1]["id"] == reply["id"]

    listed = client.get("/api/conversations", headers=headers)
    item = next(row for row in listed.json()["data"] if row["id"] == conversation_id)
    assert item["preview"] == "请改用公司配置文件后重连 VPN。"
    assert item["waiting_for_agent"] is False


def test_reply_missing_conversation_is_404(client: TestClient) -> None:
    headers = _auth_header(client)
    response = client.post(
        f"/api/conversations/{uuid4()}/replies",
        headers=headers,
        json={"content": "客服回复"},
    )
    assert response.status_code == 404
    body = response.json()
    assert body["error_code"] == "NOT_FOUND"
    assert body["error"] == "会话不存在"


def test_conversation_endpoints_require_bearer(client: TestClient) -> None:
    fake_id = str(uuid4())
    cases = [
        client.get("/api/conversations"),
        client.get(f"/api/conversations/{fake_id}"),
        client.post(f"/api/conversations/{fake_id}/transfer"),
        client.post(f"/api/conversations/{fake_id}/replies", json={"content": "x"}),
    ]
    for response in cases:
        assert response.status_code == 401
        assert response.json()["error_code"] == "UNAUTHORIZED"


def test_routes_do_not_use_websocket_or_llm() -> None:
    from pathlib import Path

    scoped = [
        Path("backend/src/api/routes/conversations.py").read_text(encoding="utf-8"),
        Path("backend/src/services/handoff.py").read_text(encoding="utf-8"),
        Path("backend/src/models/conversation.py").read_text(encoding="utf-8"),
        Path("backend/src/repositories/conversation_repository.py").read_text(encoding="utf-8"),
    ]
    joined = "\n".join(scoped).lower()
    assert "websocket" not in joined
    assert "dashscope" not in joined
    assert "chat/completions" not in joined
    assert "embeddings" not in joined
    route_text = Path("backend/src/api/routes/conversations.py").read_text(encoding="utf-8")
    assert "/messages" in route_text


def test_transfer_inserts_empty_ticket_without_changing_response(
    client: TestClient, db_path: Path
) -> None:
    import sqlite3

    headers = _auth_header(client)
    created = client.post("/api/conversations", headers=headers)
    conversation_id = created.json()["data"]["id"]
    transferred = client.post(f"/api/conversations/{conversation_id}/transfer", headers=headers)
    assert transferred.status_code == 200
    data = transferred.json()["data"]
    assert data["status"] == "handed_off"
    assert "ticket_type" not in data
    assert "fields" not in data
    assert "extract_status" not in data
    assert "can_confirm" not in data
    assert set(data) == {
        "id",
        "status",
        "clarification_round",
        "waiting_for_agent",
        "messages",
        "created_at",
        "updated_at",
    }
    conn = sqlite3.connect(db_path)
    row = conn.execute(
        """
        SELECT status, ticket_type, business_line, extract_status
        FROM tickets WHERE conversation_id = ?
        """,
        (conversation_id,),
    ).fetchone()
    conn.close()
    assert row is not None
    assert row[0] == "draft"
    assert row[1] is None
    assert row[2] is None
    assert row[3] == "idle"
