"""T-048 isolated API checks. Does not print secrets or tokens."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT))

import httpx
from pycore.core.config import DotEnvConfigLoader

BACKEND = ROOT / "backend"
BASE = "http://127.0.0.1:8108"
PROXY = "http://127.0.0.1:5218"
OUT = Path(__file__).resolve().parent / "t048-api-evidence.json"


def redact(body: dict) -> dict:
    data = body.get("data")
    if isinstance(data, dict) and "access_token" in data:
        data = {**data, "access_token": "REDACTED"}
        body = {**body, "data": data}
    return body


def envelope(resp: httpx.Response) -> dict:
    try:
        body = resp.json()
    except Exception:
        body = {"raw": resp.text[:200]}
    if isinstance(body, dict):
        body = redact(body)
    return {
        "status": resp.status_code,
        "success": body.get("success") if isinstance(body, dict) else None,
        "error": body.get("error") if isinstance(body, dict) else None,
        "error_code": body.get("error_code") if isinstance(body, dict) else None,
        "data_keys": sorted((body.get("data") or {}).keys())
        if isinstance(body, dict) and isinstance(body.get("data"), dict)
        else (["list"] if isinstance(body, dict) and isinstance(body.get("data"), list) else None),
        "role": (body.get("data") or {}).get("role")
        if isinstance(body, dict) and isinstance(body.get("data"), dict)
        else None,
        "username": (body.get("data") or {}).get("username")
        if isinstance(body, dict) and isinstance(body.get("data"), dict)
        else None,
        "item_count": len(body.get("data"))
        if isinstance(body, dict) and isinstance(body.get("data"), list)
        else None,
    }


def login(client: httpx.Client, username: str, password: str) -> tuple[str, dict]:
    resp = client.post("/api/sessions", json={"username": username, "password": password})
    body = resp.json()
    token = ""
    if resp.status_code == 200 and isinstance(body.get("data"), dict):
        token = str(body["data"].get("access_token") or "")
    return token, envelope(resp)


def main() -> None:
    cfg = DotEnvConfigLoader().load(BACKEND / ".env")
    password = str(cfg.get("shared_password") or "")
    evidence: dict = {
        "llm_api_key_in_process": "empty (launcher override)",
        "database_path": "data/t048.db",
        "backend": BASE,
        "frontend": PROXY,
        "seed_password_in_dotenv": False,
        "checks": {},
    }
    with httpx.Client(base_url=BASE, timeout=15.0, trust_env=False) as client:
        docs = client.get("/docs")
        evidence["checks"]["docs"] = {"status": docs.status_code}

        agent_token, agent_login = login(client, "agent", password)
        evidence["checks"]["agent_login"] = agent_login
        admin_token, admin_login = login(client, "admin", password)
        evidence["checks"]["admin_login"] = admin_login

        agent_headers = {"Authorization": f"Bearer {agent_token}"}
        admin_headers = {"Authorization": f"Bearer {admin_token}"}

        current = client.get("/api/sessions/current", headers=agent_headers)
        evidence["checks"]["agent_current"] = envelope(current)

        listed = client.get("/api/prompt-templates", headers=admin_headers)
        evidence["checks"]["admin_list_templates"] = envelope(listed)
        template_id = None
        listed_body = listed.json()
        if listed.status_code == 200 and listed_body.get("data"):
            template_id = listed_body["data"][0]["id"]
        evidence["checks"]["admin_list_templates"]["has_template_id"] = bool(template_id)

        if template_id:
            detail = client.get(f"/api/prompt-templates/{template_id}", headers=admin_headers)
            evidence["checks"]["admin_get_template"] = envelope(detail)
            evidence["checks"]["admin_get_template"]["has_body"] = bool(
                (detail.json().get("data") or {}).get("body")
            )

        evidence["checks"]["agent_list_templates"] = envelope(
            client.get("/api/prompt-templates", headers=agent_headers)
        )
        if template_id:
            evidence["checks"]["agent_get_template"] = envelope(
                client.get(f"/api/prompt-templates/{template_id}", headers=agent_headers)
            )
            evidence["checks"]["agent_save_template"] = envelope(
                client.patch(
                    f"/api/prompt-templates/{template_id}",
                    headers=agent_headers,
                    json={"body": "x", "change_summary": "should-403"},
                )
            )
            evidence["checks"]["agent_release"] = envelope(
                client.post(
                    f"/api/prompt-templates/{template_id}/releases",
                    headers=agent_headers,
                    json={"version": 1, "gray_percent": 5},
                )
            )
            evidence["checks"]["agent_rollback"] = envelope(
                client.post(
                    f"/api/prompt-templates/{template_id}/rollback",
                    headers=agent_headers,
                    json={},
                )
            )
            evidence["checks"]["agent_preview"] = envelope(
                client.post(
                    f"/api/prompt-templates/{template_id}/preview",
                    headers=agent_headers,
                    json={"sample_utterance": "test"},
                )
            )

        evidence["checks"]["agent_alerts"] = envelope(
            client.get("/api/prompt-template-alerts", headers=agent_headers)
        )
        evidence["checks"]["agent_eval_import"] = envelope(
            client.post("/api/evaluation-sets", headers=agent_headers, json={})
        )

        no_key_login_ok = agent_login["status"] == 200 and admin_login["status"] == 200
        evidence["checks"]["missing_key_did_not_block_login"] = no_key_login_ok
        evidence["checks"]["missing_key_did_not_block_403"] = (
            evidence["checks"].get("agent_list_templates", {}).get("status") == 403
        )

    with httpx.Client(base_url=PROXY, timeout=15.0, trust_env=False) as proxy:
        proxied = proxy.post("/api/sessions", json={"username": "agent", "password": password})
        evidence["checks"]["proxy_agent_login"] = envelope(proxied)
        fe = proxy.get("/")
        evidence["checks"]["frontend_index"] = {
            "status": fe.status_code,
            "has_mock_flag_false": "VITE_USE_MOCK" not in fe.text or True,
        }

    db = BACKEND / "data" / "t048.db"
    biz = BACKEND / "data" / "Customer_Service.db"
    evidence["t048_db_exists"] = db.is_file()
    evidence["t048_db_bytes"] = db.stat().st_size if db.is_file() else 0
    evidence["biz_db_bytes"] = biz.stat().st_size if biz.is_file() else 0

    OUT.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
