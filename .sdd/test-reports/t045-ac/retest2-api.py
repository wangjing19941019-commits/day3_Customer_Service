"""T-045 retest env/API probe. Does not print secrets."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import httpx
from pycore.core.config import DotEnvConfigLoader

ROOT = Path(__file__).resolve().parents[3]
BACKEND = ROOT / "backend"
BASE = "http://127.0.0.1:8110"
PROXY = "http://127.0.0.1:5220"
OUT = Path(__file__).resolve().parent / "t045-retest2-api.json"


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
        body = {"raw": (resp.text or "")[:200]}
    if isinstance(body, dict):
        body = redact(body)
    data = body.get("data") if isinstance(body, dict) else None
    return {
        "status": resp.status_code,
        "success": body.get("success") if isinstance(body, dict) else None,
        "error": body.get("error") if isinstance(body, dict) else None,
        "error_code": body.get("error_code") if isinstance(body, dict) else None,
        "data_keys": sorted(data.keys()) if isinstance(data, dict) else None,
        "role": data.get("role") if isinstance(data, dict) else None,
        "username": data.get("username") if isinstance(data, dict) else None,
        "item_count": len(data) if isinstance(data, list) else None,
    }


def login(client: httpx.Client, username: str, password: str) -> tuple[str, dict]:
    resp = client.post("/api/sessions", json={"username": username, "password": password})
    body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
    token = ""
    if resp.status_code == 200 and isinstance(body.get("data"), dict):
        token = str(body["data"].get("access_token") or "")
    return token, envelope(resp)


def stat_db(path: Path) -> dict:
    if not path.is_file():
        return {"exists": False}
    st = path.stat()
    return {
        "exists": True,
        "bytes": st.st_size,
        "mtime": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).astimezone().isoformat(timespec="seconds"),
    }


def summarize_docs(items: list) -> list[dict]:
    out = []
    for item in items:
        out.append(
            {
                "filename": item.get("filename"),
                "ingest_status": item.get("ingest_status"),
                "visibility": item.get("visibility"),
                "has_from": bool(item.get("effective_from")),
                "has_to": bool(item.get("effective_to")),
                "chunk_count": item.get("chunk_count"),
            }
        )
    return out


def main() -> None:
    cfg = DotEnvConfigLoader().load(BACKEND / ".env")
    password = str(cfg.get("shared_password") or "")
    llm_key = str(cfg.get("llm_api_key") or "").strip()
    evidence: dict = {
        "backend": BASE,
        "frontend": PROXY,
        "database_path": "data/t045.db",
        "llm_api_key": "present" if llm_key and llm_key != "your-llm-api-key" else "missing",
        "shared_password_set": bool(password),
        "t045_db": stat_db(BACKEND / "data" / "t045.db"),
        "biz_db": stat_db(BACKEND / "data" / "Customer_Service.db"),
        "checks": {},
    }
    with httpx.Client(base_url=BASE, timeout=20.0, trust_env=False) as client:
        evidence["checks"]["docs"] = {"status": client.get("/docs").status_code}
        admin_token, admin_login = login(client, "admin", password)
        evidence["checks"]["admin_login"] = admin_login
        _, employee_login = login(client, "employee", password)
        evidence["checks"]["employee_login"] = employee_login
        _, agent_login = login(client, "agent", password)
        evidence["checks"]["agent_login"] = agent_login
        listed = client.get(
            "/api/documents?page=1&page_size=20",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        body = listed.json() if listed.status_code == 200 else {}
        items = body.get("data") or []
        evidence["checks"]["admin_list_documents"] = {
            **envelope(listed),
            "docs": summarize_docs(items),
        }

    with httpx.Client(base_url=PROXY, timeout=20.0, trust_env=False) as proxy:
        proxied = proxy.post("/api/sessions", json={"username": "admin", "password": password})
        evidence["checks"]["proxy_admin_login"] = envelope(proxied)
        token = ""
        if proxied.status_code == 200:
            token = str((proxied.json().get("data") or {}).get("access_token") or "")
        listed = proxy.get(
            "/api/documents?page=1&page_size=20",
            headers={"Authorization": f"Bearer {token}"} if token else {},
        )
        body = listed.json() if listed.status_code == 200 else {}
        proxy_docs = summarize_docs(body.get("data") or [])
        evidence["checks"]["proxy_list_documents"] = {
            **envelope(listed),
            "docs": proxy_docs,
        }
        fe = proxy.get("/")
        evidence["checks"]["frontend_index"] = {
            "status": fe.status_code,
            "has_mock_badge_in_html": "[Mock]" in (fe.text or ""),
        }

    backend_names = [
        d.get("filename") for d in evidence["checks"]["admin_list_documents"].get("docs") or []
    ]
    proxy_names = [d.get("filename") for d in proxy_docs]
    evidence["same_docs_on_proxy"] = proxy_names
    evidence["proxy_matches_backend"] = backend_names == proxy_names
    OUT.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
