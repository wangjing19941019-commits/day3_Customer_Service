import sqlite3
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pycore.core.config import ConfigManager
from src.db.session import AppSettings, reset_engine
from src.services.auth import SEED_USERS

_TEST_SECRET = "test-secret-placeholder"
_TEST_PASSWORD = "it-help123"
_SEED_PASSWORD = "seed-password-placeholder"
_JWT_EXPIRE_MINUTES = 720
_BACKEND_DIR = Path(__file__).resolve().parent.parent
_ENV_EXAMPLE = _BACKEND_DIR / ".env.example"
_SPEC_CONFIG_KEYS = (
    "debug",
    "secret_key",
    "host",
    "port",
    "cors_origins",
    "database_path",
    "upload_dir",
    "seed_password",
    "jwt_expire_minutes",
    "llm_api_key",
    "llm_base_url",
    "llm_model",
    "llm_temperature",
    "llm_timeout_seconds",
    "llm_max_retries",
    "embedding_model",
    "embedding_dimensions",
    "embedding_batch_size",
    "max_upload_bytes",
    "chunk_max_chars",
    "chunk_overlap_chars",
    "ingest_max_chars",
    "context_message_limit",
    "faq_hit_threshold",
    "retrieve_top_k",
    "retrieve_min_score",
    "retrieve_cosine_weight",
    "retrieve_keyword_weight",
    "agent_knowledge_top_k",
    "poll_interval_ms",
    "ingest_stale_seconds",
    "fallback_reply",
    "clarification_max_rounds",
    "extract_high_confidence_min",
    "on_duty_seconds",
    "sla_scan_seconds",
    "template_gray_percent",
    "eval_min_items",
    "alert_intercept_delta",
    "alert_intercept_min_n",
    "alert_window_minutes",
    "order_center_base_url",
    "warehouse_base_url",
    "finance_base_url",
    "member_base_url",
    "logistics_base_url",
    "sla_rules",
)


def _settings(database_path: str, seed_password: str = _SEED_PASSWORD) -> dict:
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
        "seed_password": seed_password,
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
def client(db_path: Path) -> Generator[TestClient, None, None]:
    ConfigManager.reset()
    reset_engine()
    ConfigManager().load_from_dict(AppSettings, _settings(str(db_path)))
    from src.main import app

    with TestClient(app) as test_client:
        yield test_client
    reset_engine()
    ConfigManager.reset()


def test_ten_seed_users_login_with_spec_roles(client: TestClient) -> None:
    for username, role in SEED_USERS:
        response = client.post(
            "/api/sessions",
            json={"username": username, "password": _SEED_PASSWORD},
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["username"] == username
        assert data["role"] == role
        assert "password" not in data
        assert _SEED_PASSWORD not in response.text


def test_seed_user_wrong_password_is_unauthorized(client: TestClient) -> None:
    response = client.post(
        "/api/sessions",
        json={"username": "employee", "password": "wrong-password"},
    )
    assert response.status_code == 401
    body = response.json()
    assert body["success"] is False
    assert body["data"] is None
    assert body["error"] == "用户名或密码错误"
    assert body["error_code"] == "UNAUTHORIZED"


def test_business_route_without_token_is_unauthorized(client: TestClient) -> None:
    response = client.get("/api/documents")
    assert response.status_code == 401
    body = response.json()
    assert body["success"] is False
    assert body["data"] is None
    assert body["error"] == "请先登录"
    assert body["error_code"] == "UNAUTHORIZED"


def test_agent_cannot_access_prompt_templates(client: TestClient) -> None:
    login = client.post(
        "/api/sessions",
        json={"username": "agent", "password": _SEED_PASSWORD},
    )
    token = login.json()["data"]["access_token"]
    response = client.get(
        "/api/prompt-templates",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 403
    body = response.json()
    assert body["success"] is False
    assert body["data"] is None
    assert body["error_code"] == "FORBIDDEN"


def test_current_session_updates_last_seen_at(client: TestClient, db_path: Path) -> None:
    login = client.post(
        "/api/sessions",
        json={"username": "agent", "password": _SEED_PASSWORD},
    )
    token = login.json()["data"]["access_token"]
    before = sqlite3.connect(db_path).execute(
        "SELECT last_seen_at FROM users WHERE username = ?",
        ("agent",),
    ).fetchone()[0]
    assert before is None
    response = client.get(
        "/api/sessions/current",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["data"] == {"username": "agent", "role": "frontline_agent"}
    after = sqlite3.connect(db_path).execute(
        "SELECT last_seen_at FROM users WHERE username = ?",
        ("agent",),
    ).fetchone()[0]
    assert after is not None


def test_old_shared_account_kept_as_employee(client: TestClient, db_path: Path) -> None:
    row = sqlite3.connect(db_path).execute(
        "SELECT username, role FROM users WHERE username = ?",
        ("it-help",),
    ).fetchone()
    assert row == ("it-help", "employee")
    login = client.post(
        "/api/sessions",
        json={"username": "it-help", "password": _TEST_PASSWORD},
    )
    assert login.status_code == 200
    assert login.json()["data"]["role"] == "employee"


def test_env_example_lists_seed_password_and_spec_keys() -> None:
    text = _ENV_EXAMPLE.read_text(encoding="utf-8")
    assert "sk-" not in text
    assert "Bearer " not in text
    for key in _SPEC_CONFIG_KEYS:
        assert f"{key}=" in text
