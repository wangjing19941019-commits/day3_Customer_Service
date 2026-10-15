from collections.abc import Generator
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from jose import jwt
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
def client(tmp_path: Path) -> Generator[TestClient, None, None]:
    ConfigManager.reset()
    reset_engine()
    ConfigManager().load_from_dict(AppSettings, _settings(str(tmp_path / "test.db")))
    from src.main import app

    with TestClient(app) as test_client:
        yield test_client
    reset_engine()
    ConfigManager.reset()


def test_login_success_returns_token_and_username(client: TestClient) -> None:
    response = client.post(
        "/api/sessions",
        json={"username": "it-help", "password": _TEST_PASSWORD},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["error"] is None
    assert body["error_code"] is None
    data = body["data"]
    assert data["username"] == "it-help"
    assert data["role"] == "employee"
    assert data["token_type"] == "bearer"
    assert isinstance(data["access_token"], str) and data["access_token"]
    assert "password" not in data
    assert _TEST_PASSWORD not in response.text
    payload = jwt.decode(data["access_token"], _TEST_SECRET, algorithms=["HS256"])
    assert payload["role"] == "employee"
    exp = datetime.fromtimestamp(payload["exp"], tz=UTC)
    delta_minutes = (exp - datetime.now(UTC)).total_seconds() / 60
    assert _JWT_EXPIRE_MINUTES - 1 < delta_minutes < _JWT_EXPIRE_MINUTES + 1


def test_login_wrong_password_is_unauthorized(client: TestClient) -> None:
    response = client.post(
        "/api/sessions",
        json={"username": "it-help", "password": "wrong-password"},
    )
    assert response.status_code == 401
    body = response.json()
    assert body["success"] is False
    assert body["data"] is None
    assert body["error"] == "用户名或密码错误"
    assert body["error_code"] == "UNAUTHORIZED"


def test_login_missing_fields_is_validation_error(client: TestClient) -> None:
    response = client.post("/api/sessions", json={})
    assert response.status_code == 400
    body = response.json()
    assert body["success"] is False
    assert body["error"] == "请输入用户名和密码"
    assert body["error_code"] == "VALIDATION_ERROR"


def test_current_session_without_token(client: TestClient) -> None:
    response = client.get("/api/sessions/current")
    assert response.status_code == 401
    body = response.json()
    assert body["success"] is False
    assert body["data"] is None
    assert body["error"] == "请先登录"
    assert body["error_code"] == "UNAUTHORIZED"


def test_current_session_with_token(client: TestClient) -> None:
    login = client.post(
        "/api/sessions",
        json={"username": "it-help", "password": _TEST_PASSWORD},
    )
    token = login.json()["data"]["access_token"]
    response = client.get(
        "/api/sessions/current",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"] == {"username": "it-help", "role": "employee"}
    assert _TEST_PASSWORD not in response.text


def test_orm_tables_and_password_hash(client: TestClient, tmp_path: Path) -> None:
    client.get("/health")
    db_path = tmp_path / "test.db"
    import sqlite3

    tables = {
        row[0]
        for row in sqlite3.connect(db_path).execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
    }
    assert {
        "users",
        "documents",
        "chunks",
        "faqs",
        "conversations",
        "messages",
    }.issubset(tables)
    columns = {
        row[1]
        for row in sqlite3.connect(db_path).execute("PRAGMA table_info(users)")
    }
    assert {"role", "last_seen_at"}.issubset(columns)
    row = sqlite3.connect(db_path).execute(
        "SELECT username, hashed_password, role FROM users WHERE username = ?",
        ("it-help",),
    ).fetchone()
    assert row is not None
    assert row[0] == "it-help"
    assert row[1] != _TEST_PASSWORD
    assert row[1].startswith("$2")
    assert row[2] == "employee"


def test_cors_allows_agent_and_gate_origins(client: TestClient) -> None:
    for origin in (
        "http://localhost:5199",
        "http://127.0.0.1:5199",
        "http://localhost:5175",
        "http://127.0.0.1:5175",
    ):
        response = client.options(
            "/api/sessions/current",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "Authorization",
            },
        )
        assert response.status_code in {200, 204}
        assert response.headers.get("access-control-allow-origin") == origin
