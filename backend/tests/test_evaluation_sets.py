from __future__ import annotations

import json
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pycore.core.config import ConfigManager
from src.db.session import AppSettings, reset_engine

_TEST_SECRET = "test-secret-placeholder"
_TEST_PASSWORD = "it-help123"
_SEED_PASSWORD = "seed-password-placeholder"


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
        "llm_api_key": "your-llm-api-key",
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
        "template_gray_percent": 5,
        "eval_min_items": 5000,
        "alert_intercept_delta": 0.20,
        "alert_intercept_min_n": 10,
        "alert_window_minutes": 30,
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


def _admin(client: TestClient) -> dict[str, str]:
    response = client.post("/api/sessions", json={"username": "admin", "password": _SEED_PASSWORD})
    token = response.json()["data"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _agent(client: TestClient) -> dict[str, str]:
    response = client.post("/api/sessions", json={"username": "agent", "password": _SEED_PASSWORD})
    token = response.json()["data"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _jsonl(count: int) -> bytes:
    lines = [
        json.dumps(
            {
                "scene": "after_sale",
                "input": f"case-{index}",
                "expected_slots": {"intent": "return"},
            },
            ensure_ascii=False,
        )
        for index in range(count)
    ]
    return ("\n".join(lines) + "\n").encode("utf-8")


def _csv(count: int) -> bytes:
    rows = ["scene,input,labels"]
    rows.extend(f"after_sale,case-{index},return" for index in range(count))
    return ("\n".join(rows) + "\n").encode("utf-8")


def test_frontline_agent_cannot_import_evaluation_set(client: TestClient) -> None:
    headers = _agent(client)
    response = client.post(
        "/api/evaluation-sets",
        headers=headers,
        files={"file": ("set.jsonl", _jsonl(3), "application/jsonl")},
    )
    assert response.status_code == 403
    body = response.json()
    assert body["success"] is False
    assert body["error_code"] == "FORBIDDEN"


def test_import_jsonl_and_csv_counts_items(client: TestClient) -> None:
    headers = _admin(client)
    jsonl = client.post(
        "/api/evaluation-sets",
        headers=headers,
        files={"file": ("set.jsonl", _jsonl(12), "application/jsonl")},
    )
    assert jsonl.status_code == 200
    data = jsonl.json()["data"]
    assert data["item_count"] == 12
    assert data["id"]
    csv_resp = client.post(
        "/api/evaluation-sets",
        headers=headers,
        files={"file": ("set.csv", _csv(8), "text/csv")},
    )
    assert csv_resp.status_code == 200
    assert csv_resp.json()["data"]["item_count"] == 8


def test_small_eval_set_does_not_unlock_gray(client: TestClient) -> None:
    headers = _admin(client)
    listed = client.get("/api/prompt-templates", headers=headers)
    template_id = next(
        item["id"] for item in listed.json()["data"] if item["ticket_type"] == "return_exchange"
    )
    imported = client.post(
        "/api/evaluation-sets",
        headers=headers,
        files={"file": ("small.jsonl", _jsonl(4999), "application/jsonl")},
    )
    assert imported.status_code == 200
    assert imported.json()["data"]["item_count"] == 4999
    client.patch(
        f"/api/prompt-templates/{template_id}",
        headers=headers,
        json={"body": "灰度稿", "change_summary": "准备灰度"},
    )
    gray = client.post(
        f"/api/prompt-templates/{template_id}/releases",
        headers=headers,
        json={"version": 2, "gray_percent": 5},
    )
    assert gray.status_code == 409
    assert gray.json()["error"] == "没有不少于 5000 条的评测集，不能开始灰度"


def test_eval_file_missing_or_invalid_is_400(client: TestClient) -> None:
    headers = _admin(client)
    missing = client.post("/api/evaluation-sets", headers=headers)
    assert missing.status_code == 400
    assert missing.json()["error_code"] == "VALIDATION_ERROR"
    invalid = client.post(
        "/api/evaluation-sets",
        headers=headers,
        files={"file": ("bad.jsonl", b"not-json\n", "application/jsonl")},
    )
    assert invalid.status_code == 400
    assert invalid.json()["error_code"] == "VALIDATION_ERROR"
