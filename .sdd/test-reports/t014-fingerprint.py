# T-014 static fingerprint / source-consistency check. Does not import business modules or read .env.
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

ROOT = Path(r"c:\Users\慈海客服\Desktop\demo\Develop_Helper\Projects_Repo\Customer_Service")
MAP_PATH = ROOT / "docs" / "project-map.json"
HTML_PATH = ROOT / "docs" / "project-console.html"
SESSION_PY = ROOT / "backend" / "src" / "db" / "session.py"
ENV_EXAMPLE = ROOT / "backend" / ".env.example"
FE_ENV_EXAMPLE = ROOT / "frontend" / ".env.example"
OUT = Path(__file__).with_name("t014-fingerprint-evidence.json")

FORBIDDEN_SECRET_PATTERNS = [
    r"it-help123",
    r"sk-[A-Za-z0-9]{8,}",
    r"shared_password\s*=\s*\S+",
    r"llm_api_key\s*=\s*(?!your-llm)[^\s\"]+",
]
OLD_DASHBOARD = ["项目概况", "启动指南", "验收看板", "决策看板", "六区"]


def sha256_file(path: Path) -> tuple[str, int]:
    data = path.read_bytes()
    return "sha256:" + hashlib.sha256(data).hexdigest(), len(data)


def parse_appsettings_defaults(text: str) -> dict[str, str]:
    fields = {}
    for m in re.finditer(r"^    ([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*:\s*[^=]+)?\s*=\s*(.+)$", text, re.M):
        key, raw = m.group(1), m.group(2).strip()
        if raw.endswith("\\"):
            continue
        if raw.startswith("("):
            continue
        fields[key] = raw.strip('"')
    # multiline fallback_reply
    fb = re.search(r'fallback_reply:\s*str\s*=\s*\(\s*"([^"]+)"\s*\)', text, re.S)
    if fb:
        fields["fallback_reply"] = fb.group(1)
    return fields


def env_example_values(path: Path) -> dict[str, str]:
    out = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip()
    return out


def main() -> None:
    mmap = json.loads(MAP_PATH.read_text(encoding="utf-8"))
    html = HTML_PATH.read_text(encoding="utf-8")
    m = re.search(r'<script type="application/json" id="embedded-map">(\{.*?\})\s*</script>', html, re.S)
    embedded_ok = False
    embedded_equal = False
    embedded_error = None
    if m:
        try:
            embedded = json.loads(m.group(1))
            embedded_ok = True
            embedded_equal = embedded == mmap
        except Exception as exc:
            embedded_error = str(exc)
    else:
        embedded_error = "embedded-map script not found"

    hash_mismatches = []
    missing_files = []
    size_mismatches = []
    for rel, meta in mmap.get("files", {}).items():
        path = ROOT / rel.replace("/", "\\")
        if not path.is_file():
            missing_files.append(rel)
            continue
        digest, nbytes = sha256_file(path)
        if digest != meta.get("fingerprint"):
            hash_mismatches.append({"path": rel, "map": meta.get("fingerprint"), "live": digest})
        if meta.get("bytes") != nbytes:
            size_mismatches.append({"path": rel, "map": meta.get("bytes"), "live": nbytes})

    settings_text = SESSION_PY.read_text(encoding="utf-8")
    defaults = parse_appsettings_defaults(settings_text)
    be_env = env_example_values(ENV_EXAMPLE)
    fe_env = env_example_values(FE_ENV_EXAMPLE)

    expected_params = {
        "chunk_max_chars": "800",
        "chunk_overlap_chars": "160",
        "faq_hit_threshold": "0.82",
        "retrieve_top_k": "5",
        "retrieve_min_score": "0.55",
        "clarification_max_rounds": "5",
        "jwt_expire_minutes": "720",
        "shared_username": "it-help",
        "ingest_stale_seconds": "300",
        "ingest_max_chars": "24000",
        "context_message_limit": "20",
        "max_upload_bytes": "5242880",
        "embedding_batch_size": "10",
        "llm_timeout_seconds": "45",
        "llm_model": "qwen-plus",
        "llm_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "embedding_dimensions": "1024",
        "poll_interval_ms": "3000",
        "port": "8099",
    }
    param_mismatch = []
    params_by_key = {p["key"]: p for p in mmap.get("parameters", [])}
    for key, value in expected_params.items():
        src = str(defaults.get(key, "")).strip('"')
        if src != value:
            param_mismatch.append({"key": key, "appsettings": src, "expected": value, "where": "AppSettings"})
        mapped = params_by_key.get(key)
        if mapped and str(mapped.get("value")) != value and key not in {"poll_interval_ms"}:
            # poll is listed under a compound key
            param_mismatch.append({"key": key, "map": mapped.get("value"), "expected": value, "where": "project-map"})
        if key in be_env and be_env[key] != value and not be_env[key].startswith("["):
            param_mismatch.append({"key": key, "env_example": be_env[key], "expected": value, "where": ".env.example"})

    # compound keys in map
    for pid, expect in [
        ("p-chunk-max", "800"),
        ("p-chunk-overlap", "160"),
        ("p-clarify-max", "5"),
        ("p-poll-ms", "3000"),
        ("p-mock", None),
    ]:
        item = next((p for p in mmap["parameters"] if p["id"] == pid), None)
        if item is None:
            param_mismatch.append({"id": pid, "error": "missing"})
        elif expect is not None and str(item["value"]) != expect:
            param_mismatch.append({"id": pid, "map": item["value"], "expected": expect})

    if fe_env.get("VITE_USE_MOCK") != "false":
        param_mismatch.append({"key": "VITE_USE_MOCK", "env_example": fe_env.get("VITE_USE_MOCK")})
    if fe_env.get("VITE_POLL_INTERVAL_MS") != "3000":
        param_mismatch.append({"key": "VITE_POLL_INTERVAL_MS", "env_example": fe_env.get("VITE_POLL_INTERVAL_MS")})
    if fe_env.get("VITE_API_BASE_URL") != "/api":
        param_mismatch.append({"key": "VITE_API_BASE_URL", "env_example": fe_env.get("VITE_API_BASE_URL")})

    html_old = [s for s in OLD_DASHBOARD if s in html]
    html_secrets = []
    for pat in FORBIDDEN_SECRET_PATTERNS:
        if re.search(pat, html):
            html_secrets.append(pat)
    map_secrets = []
    map_text = MAP_PATH.read_text(encoding="utf-8")
    for pat in FORBIDDEN_SECRET_PATTERNS:
        if re.search(pat, map_text):
            map_secrets.append(pat)

    pages = {p["id"]: p for p in mmap["pages"]}
    page_routes = {p["id"]: p["route"] for p in mmap["pages"]}
    expected_pages = {
        "page-login": "/login",
        "page-employee": "/employee",
        "page-agent": "/agent",
        "page-knowledge": "/knowledge",
    }
    page_mismatch = {k: v for k, v in expected_pages.items() if page_routes.get(k) != v}

    apis = {a["id"]: (a["method"], a["url"]) for a in mmap["apis"]}
    expected_apis = {
        "api-001": ("POST", "/api/sessions"),
        "api-002": ("GET", "/api/sessions/current"),
        "api-003": ("POST", "/api/documents"),
        "api-004": ("GET", "/api/documents"),
        "api-005": ("GET", "/api/documents/{document_id}"),
        "api-006": ("PATCH", "/api/documents/{document_id}"),
        "api-007": ("POST", "/api/conversations"),
        "api-008": ("GET", "/api/conversations"),
        "api-009": ("GET", "/api/conversations/{conversation_id}"),
        "api-010": ("POST", "/api/conversations/{conversation_id}/messages"),
        "api-011": ("POST", "/api/conversations/{conversation_id}/transfer"),
        "api-012": ("POST", "/api/conversations/{conversation_id}/replies"),
        "ext-001": ("POST", "{llm_base_url}/chat/completions"),
        "ext-002": ("POST", "{llm_base_url}/embeddings"),
    }
    api_mismatch = {k: {"map": apis.get(k), "expected": v} for k, v in expected_apis.items() if apis.get(k) != v}

    modules = mmap.get("modules", [])
    kinds = {m["id"]: m["kind"] for m in modules}
    invented = [
        m
        for m in modules
        if "Agent" in m["kind"] or "工单" in (m.get("name") + m.get("responsibility"))
        or m["kind"] not in {"普通函数", "外部服务", "模型", "Agent工具"}
    ]
    bailian_ok = kinds.get("mod-bailian-chat") == "外部服务" and kinds.get("mod-bailian-embed") == "外部服务"
    agent_null = mmap.get("agent") is None

    algs = {a["id"]: a for a in mmap.get("algorithms", [])}
    alg_notes = {
        "alg-chunk_800": "800" in "".join(algs.get("alg-chunk", {}).get("steps", [])) + str(algs.get("alg-chunk", {}).get("selection")),
        "alg-chunk_160": "160" in str(algs.get("alg-chunk", {}).get("selection", "")),
        "alg-chunk_markdown": any("Markdown" in s or "markdown" in s.lower() for s in algs.get("alg-chunk", {}).get("steps", [])),
        "alg-qa_5": "5" in str(algs.get("alg-qa-state", {}).get("steps", [])),
        "alg-retrieve_tag": any("对象过滤" in s or "标签" in s for s in algs.get("alg-retrieve", {}).get("steps", [])),
        "alg-handoff": "handed_off" in str(algs.get("alg-handoff", {}).get("steps", [])),
    }

    feature_flows = []
    for feat in mmap.get("features", []):
        flow = feat.get("flow") or []
        feature_flows.append(
            {
                "id": feat["id"],
                "has_trigger": bool(feat.get("trigger")),
                "has_io": bool(feat.get("input") and feat.get("output")),
                "flow_steps": len(flow),
                "flow_has_branch": all(s.get("branch") and s.get("actor") and s.get("action") for s in flow),
                "api_ids": feat.get("api_ids") or [],
            }
        )

    checks = {
        "embedded_parse_ok": embedded_ok,
        "embedded_equals_file": embedded_equal,
        "hash_ok": not hash_mismatches and not missing_files,
        "size_ok": not size_mismatches,
        "params_ok": not param_mismatch,
        "no_old_dashboard_in_html_source": not html_old,
        "no_secrets_in_html": not html_secrets,
        "no_secrets_in_map": not map_secrets,
        "pages_ok": not page_mismatch,
        "apis_ok": not api_mismatch,
        "agent_null": agent_null,
        "bailian_httpx_modules": bailian_ok,
        "no_invented_tools": not invented,
        "algorithm_claims": all(alg_notes.values()),
        "all_features_have_flow": all(f["flow_steps"] >= 2 and f["flow_has_branch"] and f["has_trigger"] and f["has_io"] for f in feature_flows),
    }

    evidence = {
        "checks": checks,
        "hash_mismatches": hash_mismatches,
        "missing_files": missing_files,
        "size_mismatches": size_mismatches,
        "param_mismatch": param_mismatch,
        "html_old_dashboard": html_old,
        "html_secrets": html_secrets,
        "map_secrets": map_secrets,
        "page_mismatch": page_mismatch,
        "api_mismatch": api_mismatch,
        "module_kinds": kinds,
        "invented": invented,
        "agent": mmap.get("agent"),
        "not_present": mmap.get("not_present"),
        "alg_notes": alg_notes,
        "feature_flows": feature_flows,
        "embedded_error": embedded_error,
        "file_count": len(mmap.get("files", {})),
        "pass": all(checks.values()),
    }
    OUT.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"pass": evidence["pass"], "checks": checks, "out": str(OUT)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
