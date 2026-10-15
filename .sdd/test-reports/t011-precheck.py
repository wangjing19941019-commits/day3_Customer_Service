"""T-011 environment and request-period API precheck. No secrets in output."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from io import BytesIO
from pathlib import Path

from pypdf import PdfReader, PdfWriter

BACKEND = "http://127.0.0.1:8099"
FRONTEND = "http://127.0.0.1:5199"
OUT_DIR = Path(__file__).resolve().parent
FIXTURE_DIR = OUT_DIR / "t011-fixtures"
PROJECT = Path(__file__).resolve().parents[2]
FRONTEND_ENV = PROJECT / "frontend" / ".env"
FRONTEND_EXAMPLE = PROJECT / "frontend" / ".env.example"
BACKEND_ENV = PROJECT / "backend" / ".env"
BACKEND_EXAMPLE = PROJECT / "backend" / ".env.example"


def env_keys(path: Path) -> list[str]:
    keys: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        keys.append(stripped.split("=", 1)[0].strip())
    return keys


def env_value(path: Path, key: str) -> str | None:
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.startswith(f"{key}="):
            return stripped.split("=", 1)[1].strip()
    return None


def json_request(method: str, url: str, *, data: dict | None = None, headers: dict | None = None):
    body = None if data is None else json.dumps(data).encode("utf-8")
    req_headers = {"Accept": "application/json"}
    if body is not None:
        req_headers["Content-Type"] = "application/json"
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(url, data=body, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read()
            parsed = json.loads(raw.decode("utf-8")) if raw else None
            return resp.status, parsed, dict(resp.headers)
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        parsed = json.loads(raw.decode("utf-8")) if raw else None
        return exc.code, parsed, dict(exc.headers)


def multipart_upload(token: str, filename: str, content: bytes, content_type: str):
    boundary = "----T011Boundary"
    disposition = (
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n"
    )
    parts = (
        f"--{boundary}\r\n".encode("utf-8")
        + disposition.encode("utf-8")
        + content
        + f"\r\n--{boundary}--\r\n".encode("utf-8")
    )
    req = urllib.request.Request(
        f"{BACKEND}/api/documents",
        data=parts,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            parsed = json.loads(resp.read().decode("utf-8"))
            return resp.status, parsed
    except urllib.error.HTTPError as exc:
        parsed = json.loads(exc.read().decode("utf-8"))
        return exc.code, parsed


def make_blank_pdf() -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    buffer = BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def make_text_pdf(text: str) -> bytes:
    escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    stream = f"BT /F1 12 Tf 72 720 Td ({escaped}) Tj ET\n".encode("latin-1")
    header = b"%PDF-1.4\n"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>"
        ),
        b"<< /Length "
        + str(len(stream)).encode("ascii")
        + b" >>\nstream\n"
        + stream
        + b"endstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    body = header
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(body))
        body += f"{index} 0 obj\n".encode("ascii") + obj + b"\nendobj\n"
    xref_pos = len(body)
    xref = b"xref\n0 6\n0000000000 65535 f \n"
    for offset in offsets[1:]:
        xref += f"{offset:010d} 00000 n \n".encode("ascii")
    trailer = (
        b"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n"
        + str(xref_pos).encode("ascii")
        + b"\n%%EOF\n"
    )
    return body + xref + trailer


def main() -> None:
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    blank_pdf = make_blank_pdf()
    long_pdf_text = (
        "T011PRINTER Office printer reset steps. Confirm the device is on the company network "
        "and powered on. Clear the paper path then restart the spooler. "
    ) * 24
    text_pdf = make_text_pdf(long_pdf_text)
    (FIXTURE_DIR / "blank.pdf").write_bytes(blank_pdf)
    (FIXTURE_DIR / "printer-guide.pdf").write_bytes(text_pdf)
    (FIXTURE_DIR / "notes.docx").write_bytes(b"PK\x03\x04not-a-real-docx")
    (FIXTURE_DIR / "empty.txt").write_bytes(b"")

    blank_extracted = ""
    try:
        reader = PdfReader(BytesIO(blank_pdf), strict=False)
        blank_extracted = "\n".join((page.extract_text() or "").strip() for page in reader.pages)
    except Exception as exc:  # noqa: BLE001
        blank_extracted = f"error:{type(exc).__name__}"
    text_extracted = ""
    try:
        reader = PdfReader(BytesIO(text_pdf), strict=False)
        text_extracted = "\n".join((page.extract_text() or "").strip() for page in reader.pages)
    except Exception as exc:  # noqa: BLE001
        text_extracted = f"error:{type(exc).__name__}"

    vite_status = urllib.request.urlopen(FRONTEND, timeout=10).status
    backend_status = urllib.request.urlopen(f"{BACKEND}/docs", timeout=10).status
    mock_flag = env_value(FRONTEND_ENV, "VITE_USE_MOCK")
    poll_ms = env_value(FRONTEND_ENV, "VITE_POLL_INTERVAL_MS")
    llm_key = env_value(BACKEND_ENV, "llm_api_key") or ""
    llm_configured = bool(llm_key) and llm_key not in {
        "",
        "your-llm-api-key",
        "change-me",
        "sk-placeholder",
    }
    fe_keys = env_keys(FRONTEND_ENV)
    fe_example = env_keys(FRONTEND_EXAMPLE)
    be_keys = env_keys(BACKEND_ENV)
    be_example = env_keys(BACKEND_EXAMPLE)

    login_status, login_body, _ = json_request(
        "POST",
        f"{BACKEND}/api/sessions",
        data={"username": "it-help", "password": "it-help123"},
    )
    token = (login_body or {}).get("data", {}).get("access_token") if login_status == 200 else None
    auth = {"Authorization": f"Bearer {token}"} if token else {}

    invalid_status, invalid_body, _ = json_request(
        "GET",
        f"{BACKEND}/api/documents?ingest_status=bogus",
        headers=auth,
    )
    all_status, all_body, _ = json_request(
        "GET",
        f"{BACKEND}/api/documents?page=1&page_size=20",
        headers=auth,
    )
    filters = {}
    for value in ("ingesting", "ready", "failed"):
        st, body, _ = json_request(
            "GET",
            f"{BACKEND}/api/documents?page=1&page_size=20&ingest_status={value}",
            headers=auth,
        )
        items = (body or {}).get("data") or []
        filters[value] = {
            "status": st,
            "total": ((body or {}).get("pagination") or {}).get("total_items"),
            "count": len(items),
            "statuses": sorted({item.get("ingest_status") for item in items}),
        }

    rejects = []
    before_total = ((all_body or {}).get("pagination") or {}).get("total_items")
    cases = [
        ("notes.docx", (FIXTURE_DIR / "notes.docx").read_bytes(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        ("empty.txt", b"", "text/plain"),
        ("blank.pdf", blank_pdf, "application/pdf"),
    ]
    for name, content, mime in cases:
        status, body = multipart_upload(token, name, content, mime)
        rejects.append(
            {
                "filename": name,
                "http": status,
                "error": (body or {}).get("error"),
                "error_code": (body or {}).get("error_code"),
                "success": (body or {}).get("success"),
            }
        )
    after_status, after_body, _ = json_request(
        "GET",
        f"{BACKEND}/api/documents?page=1&page_size=20",
        headers=auth,
    )
    after_total = ((after_body or {}).get("pagination") or {}).get("total_items")
    after_names = [item.get("filename") for item in ((after_body or {}).get("data") or [])]

    evidence = {
        "viteStatus": vite_status,
        "backendStatus": backend_status,
        "viteUseMock": mock_flag,
        "vitePollIntervalMs": poll_ms,
        "llmKeyConfigured": llm_configured,
        "llmKeyLength": len(llm_key) if llm_configured else 0,
        "frontendEnvKeysMatchExample": fe_keys == fe_example,
        "backendEnvKeysMatchExample": be_keys == be_example,
        "frontendExtraKeys": sorted(set(fe_keys) - set(fe_example)),
        "backendExtraKeys": sorted(set(be_keys) - set(be_example)),
        "loginHttp": login_status,
        "loginSuccess": (login_body or {}).get("success"),
        "hasToken": bool(token),
        "invalidFilter": {
            "http": invalid_status,
            "error": (invalid_body or {}).get("error"),
            "error_code": (invalid_body or {}).get("error_code"),
        },
        "listAll": {
            "http": all_status,
            "total": ((all_body or {}).get("pagination") or {}).get("total_items"),
            "count": len((all_body or {}).get("data") or []),
        },
        "filters": filters,
        "rejects": rejects,
        "listTotalBeforeRejects": before_total,
        "listTotalAfterRejects": after_total,
        "listHttpAfterRejects": after_status,
        "rejectNamesInList": [
            name for name in ("notes.docx", "empty.txt", "blank.pdf") if name in after_names
        ],
        "blankPdfBytes": len(blank_pdf),
        "blankPdfExtractedLen": len((blank_extracted or "").strip()),
        "textPdfBytes": len(text_pdf),
        "textPdfExtractedLen": len((text_extracted or "").strip()),
        "textPdfHasToken": "T011PRINTER" in (text_extracted or ""),
        "textPdfSourceLen": len(long_pdf_text),
        "fixtureDir": str(FIXTURE_DIR),
    }
    (OUT_DIR / "t011-api-precheck.json").write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print("precheck_written")
    print(f"vite={vite_status} backend={backend_status} mock={mock_flag} llm={llm_configured}")
    print(
        "invalid_filter",
        invalid_status,
        (invalid_body or {}).get("error"),
        (invalid_body or {}).get("error_code"),
    )
    print("rejects", json.dumps(rejects, ensure_ascii=False))
    print("list_after_rejects", after_total, "leaked", evidence["rejectNamesInList"])
    print("blank_extracted", evidence["blankPdfExtractedLen"], "text_extracted", evidence["textPdfExtractedLen"])


if __name__ == "__main__":
    main()
