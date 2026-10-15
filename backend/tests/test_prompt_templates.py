from __future__ import annotations

import json
import sqlite3
from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pycore.core.config import ConfigManager
from src.db.session import AppSettings, reset_engine
from src.services.templates import gray_bucket

_TEST_SECRET = "test-secret-placeholder"
_TEST_PASSWORD = "it-help123"
_SEED_PASSWORD = "seed-password-placeholder"
_BACKEND_DIR = Path(__file__).resolve().parent.parent
_ENV_EXAMPLE = _BACKEND_DIR / ".env.example"
_SAMPLE = "我很生气，订单JD20260922001还没按七天无理由退货处理。"
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


def _settings(database_path: str, llm_api_key: str = "your-llm-api-key") -> dict:
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


def _login(client: TestClient, username: str, password: str) -> dict[str, str]:
    response = client.post("/api/sessions", json={"username": username, "password": password})
    assert response.status_code == 200
    token = response.json()["data"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _admin(client: TestClient) -> dict[str, str]:
    return _login(client, "admin", _SEED_PASSWORD)


def _agent(client: TestClient) -> dict[str, str]:
    return _login(client, "agent", _SEED_PASSWORD)


def _return_template(client: TestClient, headers: dict[str, str]) -> dict:
    response = client.get("/api/prompt-templates", headers=headers)
    assert response.status_code == 200
    items = response.json()["data"]
    return next(
        item
        for item in items
        if item["ticket_type"] == "return_exchange" and item["scene"] == "after_sale"
    )


def _eval_jsonl(count: int) -> bytes:
    lines = [
        json.dumps(
            {"scene": "after_sale", "input": f"退货说法{index}", "labels": ["return"]},
            ensure_ascii=False,
        )
        for index in range(count)
    ]
    return ("\n".join(lines) + "\n").encode("utf-8")


def test_save_creates_version_with_editor_and_summary(client: TestClient) -> None:
    headers = _admin(client)
    template = _return_template(client, headers)
    response = client.patch(
        f"/api/prompt-templates/{template['id']}",
        headers=headers,
        json={"body": "新正文{{emotion}}{{order}}{{policy}}", "change_summary": "补充退货说明"},
    )
    assert response.status_code == 200
    body = response.json()
    assert _ENVELOPE.issubset(body)
    data = body["data"]
    assert data["version"] == 2
    assert data["editor"] == "admin"
    assert data["change_summary"] == "补充退货说明"
    assert data["edited_at"]


def test_versions_can_diff(client: TestClient) -> None:
    headers = _admin(client)
    template = _return_template(client, headers)
    client.patch(
        f"/api/prompt-templates/{template['id']}",
        headers=headers,
        json={"body": "版本二正文差异标记", "change_summary": "改正文"},
    )
    response = client.get(
        f"/api/prompt-templates/{template['id']}/versions",
        headers=headers,
        params={"from": 1, "to": 2},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    versions = {item["version"]: item for item in data["versions"]}
    assert 1 in versions and 2 in versions
    assert data["diff"]
    assert "版本二正文差异标记" in data["diff"]


def test_version_times_are_utc_aware(client: TestClient) -> None:
    headers = _admin(client)
    template = _return_template(client, headers)
    saved = client.patch(
        f"/api/prompt-templates/{template['id']}",
        headers=headers,
        json={"body": "时区检查正文", "change_summary": "时区"},
    ).json()["data"]
    response = client.get(f"/api/prompt-templates/{template['id']}/versions", headers=headers)
    versions = {item["version"]: item for item in response.json()["data"]["versions"]}
    listed = datetime.fromisoformat(versions[saved["version"]]["edited_at"].replace("Z", "+00:00"))
    returned = datetime.fromisoformat(saved["edited_at"].replace("Z", "+00:00"))
    assert listed.tzinfo is not None
    assert listed == returned


def test_preview_replaces_placeholders_without_emit_path(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def boom(*_args, **_kwargs):
        raise AssertionError("emit path called")

    monkeypatch.setattr("src.integrations.bailian.BailianClient.chat_completions", boom)
    monkeypatch.setattr("src.services.polish.PolishService.polish", boom)
    monkeypatch.setattr("src.services.handoff.HandoffService.agent_reply", boom)
    headers = _admin(client)
    template = _return_template(client, headers)
    response = client.post(
        f"/api/prompt-templates/{template['id']}/preview",
        headers=headers,
        json={"sample_utterance": _SAMPLE},
    )
    assert response.status_code == 200
    rendered = response.json()["data"]["rendered_body"]
    assert "{{emotion}}" not in rendered
    assert "{{order}}" not in rendered
    assert "{{policy}}" not in rendered
    assert "生气" in rendered
    assert "JD20260922001" in rendered
    assert "七天无理由退货" in rendered


def test_frontline_agent_forbidden_on_template_write_and_eval(client: TestClient) -> None:
    headers = _agent(client)
    listed = client.get("/api/prompt-templates", headers=headers)
    assert listed.status_code == 403
    admin = _admin(client)
    template_id = _return_template(client, admin)["id"]
    calls = [
        client.get(f"/api/prompt-templates/{template_id}", headers=headers),
        client.patch(
            f"/api/prompt-templates/{template_id}",
            headers=headers,
            json={"body": "x", "change_summary": "y"},
        ),
        client.post(
            f"/api/prompt-templates/{template_id}/preview",
            headers=headers,
            json={"sample_utterance": _SAMPLE},
        ),
        client.get(f"/api/prompt-templates/{template_id}/versions", headers=headers),
        client.post(
            f"/api/prompt-templates/{template_id}/releases",
            headers=headers,
            json={"version": 1},
        ),
        client.post(f"/api/prompt-templates/{template_id}/rollback", headers=headers, json={}),
        client.post(
            "/api/evaluation-sets",
            headers=headers,
            files={"file": ("set.jsonl", _eval_jsonl(2), "application/jsonl")},
        ),
    ]
    for response in calls:
        assert response.status_code == 403
        body = response.json()
        assert body["success"] is False
        assert body["error_code"] == "FORBIDDEN"


def test_gray_without_eval_set_is_409(client: TestClient) -> None:
    headers = _admin(client)
    template = _return_template(client, headers)
    client.patch(
        f"/api/prompt-templates/{template['id']}",
        headers=headers,
        json={"body": "灰度稿", "change_summary": "准备灰度"},
    )
    response = client.post(
        f"/api/prompt-templates/{template['id']}/releases",
        headers=headers,
        json={"version": 2},
    )
    assert response.status_code == 409
    body = response.json()
    assert body["error_code"] == "CONFLICT"
    assert body["error"] == "没有不少于 5000 条的评测集，不能开始灰度"


def test_gray_below_min_items_is_409(client: TestClient) -> None:
    headers = _admin(client)
    template = _return_template(client, headers)
    imported = client.post(
        "/api/evaluation-sets",
        headers=headers,
        files={"file": ("small.jsonl", _eval_jsonl(20), "application/jsonl")},
    )
    assert imported.status_code == 200
    assert imported.json()["data"]["item_count"] == 20
    client.patch(
        f"/api/prompt-templates/{template['id']}",
        headers=headers,
        json={"body": "灰度稿", "change_summary": "准备灰度"},
    )
    response = client.post(
        f"/api/prompt-templates/{template['id']}/releases",
        headers=headers,
        json={"version": 2},
    )
    assert response.status_code == 409
    assert response.json()["error"] == "没有不少于 5000 条的评测集，不能开始灰度"


def test_gray_with_min_items_defaults_percent_and_rollback_uses_stable(
    client: TestClient, db_path: Path
) -> None:
    headers = _admin(client)
    template = _return_template(client, headers)
    imported = client.post(
        "/api/evaluation-sets",
        headers=headers,
        files={"file": ("full.jsonl", _eval_jsonl(5000), "application/jsonl")},
    )
    assert imported.status_code == 200
    assert imported.json()["data"]["item_count"] == 5000
    client.patch(
        f"/api/prompt-templates/{template['id']}",
        headers=headers,
        json={"body": "灰度正文", "change_summary": "准备灰度"},
    )
    released = client.post(
        f"/api/prompt-templates/{template['id']}/releases",
        headers=headers,
        json={"version": 2},
    )
    assert released.status_code == 200
    data = released.json()["data"]
    assert data["gray_version"] == 2
    assert data["stable_version"] == 1
    assert data["gray_percent"] == 5

    gray_cid = next(
        cid for cid in (f"conv-gray-{index}" for index in range(400)) if gray_bucket(cid) < 5
    )
    stable_cid = next(
        cid for cid in (f"conv-stable-{index}" for index in range(400)) if gray_bucket(cid) >= 5
    )
    conn = sqlite3.connect(db_path)
    conn.execute(
        "INSERT INTO template_session_bindings "
        "(id, conversation_id, template_id, version, bound_at) VALUES (?, ?, ?, ?, ?)",
        (str(uuid4()), gray_cid, template["id"], 2, datetime.now(UTC).isoformat()),
    )
    conn.execute(
        "INSERT INTO template_session_bindings "
        "(id, conversation_id, template_id, version, bound_at) VALUES (?, ?, ?, ?, ?)",
        (str(uuid4()), stable_cid, template["id"], 1, datetime.now(UTC).isoformat()),
    )
    conn.commit()
    rolled = client.post(
        f"/api/prompt-templates/{template['id']}/rollback",
        headers=headers,
        json={},
    )
    assert rolled.status_code == 200
    rolled_data = rolled.json()["data"]
    assert rolled_data["gray_version"] is None
    assert rolled_data["stable_version"] == 1
    assert rolled_data["gray_percent"] == 0
    row = conn.execute(
        "SELECT gray_version, stable_version, gray_percent FROM prompt_templates WHERE id = ?",
        (template["id"],),
    ).fetchone()
    assert row == (None, 1, 0)
    bound = {
        item[0]: item[1]
        for item in conn.execute(
            "SELECT conversation_id, version FROM template_session_bindings WHERE template_id = ?",
            (template["id"],),
        ).fetchall()
    }
    assert bound[gray_cid] == 2
    new_cid = "conv-new-after-rollback"
    chosen = 2 if row[0] is not None and gray_bucket(new_cid) < row[2] else row[1]
    assert chosen == 1
    conn.close()


def test_intercept_rate_spike_creates_alert(client: TestClient, db_path: Path) -> None:
    headers = _admin(client)
    template = _return_template(client, headers)
    now = datetime.now(UTC)
    conn = sqlite3.connect(db_path)
    for index in range(10):
        conn.execute(
            "INSERT INTO template_polish_events "
            "(id, template_id, version, intercepted, created_at) VALUES (?, ?, ?, ?, ?)",
            (
                str(uuid4()),
                template["id"],
                1,
                1,
                (now - timedelta(minutes=2, seconds=index)).isoformat(),
            ),
        )
    conn.commit()
    conn.close()
    response = client.get("/api/prompt-template-alerts", headers=headers)
    assert response.status_code == 200
    alerts = response.json()["data"]["alerts"]
    assert any(
        item["template_id"] == template["id"] and item["metric"] == "compliance_intercept_rate"
        for item in alerts
    )


def test_latest_eval_set_is_current_and_smaller_import_blocks_gray(client: TestClient) -> None:
    headers = _admin(client)
    template = _return_template(client, headers)
    empty = client.get("/api/evaluation-sets/current", headers=headers)
    assert empty.status_code == 200
    assert empty.json()["data"] == {"id": None, "item_count": 0}
    client.post(
        "/api/evaluation-sets",
        headers=headers,
        files={"file": ("full.jsonl", _eval_jsonl(5000), "application/jsonl")},
    )
    assert client.get("/api/evaluation-sets/current", headers=headers).json()["data"][
        "item_count"
    ] == 5000
    client.patch(
        f"/api/prompt-templates/{template['id']}",
        headers=headers,
        json={"body": "灰度稿", "change_summary": "准备灰度"},
    )
    released = client.post(
        f"/api/prompt-templates/{template['id']}/releases", headers=headers, json={"version": 2}
    )
    assert released.status_code == 200
    client.post(f"/api/prompt-templates/{template['id']}/rollback", headers=headers, json={})
    client.post(
        "/api/evaluation-sets",
        headers=headers,
        files={"file": ("small.jsonl", _eval_jsonl(3), "application/jsonl")},
    )
    assert client.get("/api/evaluation-sets/current", headers=headers).json()["data"][
        "item_count"
    ] == 3
    blocked = client.post(
        f"/api/prompt-templates/{template['id']}/releases", headers=headers, json={"version": 2}
    )
    assert blocked.status_code == 409
    assert _agent_forbidden(client, "/api/evaluation-sets/current")


def _agent_forbidden(client: TestClient, url: str) -> bool:
    return client.get(url, headers=_agent(client)).status_code == 403


def test_metrics_are_none_without_samples(client: TestClient) -> None:
    headers = _admin(client)
    template = _return_template(client, headers)
    data = client.get(f"/api/prompt-templates/{template['id']}/metrics", headers=headers).json()[
        "data"
    ]
    for key in (
        "extraction_accuracy",
        "adoption_rate",
        "compliance_intercept_rate",
        "modification_rate",
        "complaint_rate",
    ):
        assert data[key] is None
    assert data["stable_version"] == 1
    assert data["gray_version"] is None


def test_metrics_split_adoption_and_intercept_by_version(
    client: TestClient, db_path: Path
) -> None:
    headers = _admin(client)
    template = _return_template(client, headers)
    now = datetime.now(UTC).isoformat()
    rows = [
        (1, 0, "adopted"),
        (1, 0, "modified"),
        (1, 0, "adopted"),
        (1, 0, None),
        (2, 1, "discarded"),
        (2, 0, "adopted"),
    ]
    conn = sqlite3.connect(db_path)
    client.get(f"/api/prompt-templates/{template['id']}/metrics", headers=headers)
    for version, intercepted, outcome in rows:
        conn.execute(
            "INSERT INTO template_polish_events "
            "(id, template_id, version, intercepted, created_at, outcome) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (str(uuid4()), template["id"], version, intercepted, now, outcome),
        )
    conn.execute(
        "INSERT INTO prompt_template_versions "
        "(id, template_id, version, editor, edited_at, change_summary, body) "
        "VALUES (?, ?, 2, 'admin', ?, '灰度稿', '灰度稿')",
        (str(uuid4()), template["id"], now),
    )
    conn.execute(
        "UPDATE prompt_templates SET gray_version = 2, gray_percent = 5 WHERE id = ?",
        (template["id"],),
    )
    conn.commit()
    conn.close()
    data = client.get(f"/api/prompt-templates/{template['id']}/metrics", headers=headers).json()[
        "data"
    ]
    assert data["stable"]["adoption_rate"] == pytest.approx(2 / 3)
    assert data["stable"]["modification_rate"] == pytest.approx(1 / 3)
    assert data["stable"]["compliance_intercept_rate"] == 0.0
    assert data["gray"]["adoption_rate"] == pytest.approx(0.5)
    assert data["gray"]["compliance_intercept_rate"] == pytest.approx(0.5)
    assert data["gray_version"] == 2
    assert data["stable"]["extraction_accuracy"] is None


def test_ticket_field_counts_only_counts_untouched_auto_fields() -> None:
    from src.db.models import Ticket
    from src.services.templates import _ticket_field_counts

    ticket = Ticket(
        ticket_type="return_exchange",
        fields_json={
            "order_no": {"value": "JD1", "status": "filled"},
            "product_info": {"value": "大衣", "status": "agent_edited"},
            "return_reason": {"value": "起球", "status": "filled"},
            "amount": {"value": None, "status": "missing"},
            "tax_id": {"value": "X", "status": "filled"},
            "_meta": {"ticket_no": "T1"},
        },
    )
    assert _ticket_field_counts(ticket) == (3, 2)


def test_env_example_lists_template_alert_keys() -> None:
    text = _ENV_EXAMPLE.read_text(encoding="utf-8")
    assert "sk-" not in text
    assert "Bearer " not in text
    for key in (
        "template_gray_percent",
        "eval_min_items",
        "alert_intercept_delta",
        "alert_intercept_min_n",
        "alert_window_minutes",
    ):
        assert f"{key}=" in text


def test_preview_works_without_llm_key(client: TestClient) -> None:
    headers = _admin(client)
    template = _return_template(client, headers)
    response = client.post(
        f"/api/prompt-templates/{template['id']}/preview",
        headers=headers,
        json={"sample_utterance": _SAMPLE},
    )
    assert response.status_code == 200
    assert "JD20260922001" in response.json()["data"]["rendered_body"]
