from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pycore.core.config import ConfigManager
from src.db.session import AppSettings, reset_engine
from src.services.workspace_settings import urgency_elevated_by_amount

_TEST_SECRET = "test-secret-placeholder"
_TEST_PASSWORD = "it-help123"
_SEED_PASSWORD = "seed-password-placeholder"
_BACKEND_DIR = Path(__file__).resolve().parent.parent
_ENV_EXAMPLE = _BACKEND_DIR / ".env.example"
_SETTINGS_PATH = "/api/workspace-settings"


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


def _login(client: TestClient, username: str) -> str:
    response = client.post(
        "/api/sessions",
        json={"username": username, "password": _SEED_PASSWORD},
    )
    assert response.status_code == 200
    return response.json()["data"]["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_admin_patch_value_then_get_matches(client: TestClient) -> None:
    token = _login(client, "admin")
    patch = client.patch(
        _SETTINGS_PATH,
        json={"high_risk_amount_threshold": 1000},
        headers=_auth(token),
    )
    assert patch.status_code == 200
    assert patch.json()["success"] is True
    assert patch.json()["data"] == {"high_risk_amount_threshold": 1000}
    fetched = client.get(_SETTINGS_PATH, headers=_auth(token))
    assert fetched.status_code == 200
    assert fetched.json()["data"] == {"high_risk_amount_threshold": 1000}


def test_patch_null_does_not_elevate_vip_or_high_risk_by_amount(client: TestClient) -> None:
    token = _login(client, "admin")
    assert (
        client.patch(
            _SETTINGS_PATH,
            json={"high_risk_amount_threshold": 1},
            headers=_auth(token),
        ).status_code
        == 200
    )
    cleared = client.patch(
        _SETTINGS_PATH,
        json={"high_risk_amount_threshold": None},
        headers=_auth(token),
    )
    assert cleared.status_code == 200
    assert cleared.json()["data"] == {"high_risk_amount_threshold": None}
    fetched = client.get(_SETTINGS_PATH, headers=_auth(token))
    assert fetched.status_code == 200
    threshold = fetched.json()["data"]["high_risk_amount_threshold"]
    assert threshold is None
    elevated = urgency_elevated_by_amount(999999, threshold)
    assert elevated is None
    assert elevated != "vip"
    assert elevated != "high_risk"


def test_frontline_agent_patch_is_forbidden(client: TestClient) -> None:
    token = _login(client, "agent")
    response = client.patch(
        _SETTINGS_PATH,
        json={"high_risk_amount_threshold": 500},
        headers=_auth(token),
    )
    assert response.status_code == 403
    body = response.json()
    assert body["success"] is False
    assert body["data"] is None
    assert body["error_code"] == "FORBIDDEN"


def test_supervisor_get_is_ok(client: TestClient) -> None:
    token = _login(client, "supervisor")
    response = client.get(_SETTINGS_PATH, headers=_auth(token))
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"] == {"high_risk_amount_threshold": None}


def test_env_example_does_not_add_secret_fields() -> None:
    text = _ENV_EXAMPLE.read_text(encoding="utf-8")
    assert "sk-" not in text
    assert "Bearer " not in text
    assert "high_risk_amount_threshold=" not in text
    assert "workspace_settings" not in text


def test_configured_amount_line_marks_high_risk_not_vip() -> None:
    assert urgency_elevated_by_amount(1000, 1000) == "high_risk"
    assert urgency_elevated_by_amount(999, 1000) is None
    assert urgency_elevated_by_amount(1000, None) is None
