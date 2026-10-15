import sqlite3
from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from io import BytesIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pycore.core.config import ConfigManager
from pypdf import PdfWriter
from src.db.session import AppSettings, reset_engine
from src.utils.text import chunk_markdown, convert_file_to_markdown

_TEST_SECRET = "test-secret-placeholder"
_TEST_PASSWORD = "it-help123"


def _settings(
    database_path: str,
    upload_dir: str,
    llm_api_key: str = "",
    **overrides: object,
) -> dict:
    data: dict = {
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
        "upload_dir": upload_dir,
        "shared_username": "it-help",
        "shared_password": _TEST_PASSWORD,
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
    }
    data.update(overrides)
    return data


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "test.db"


@pytest.fixture
def upload_dir(tmp_path: Path) -> Path:
    path = tmp_path / "uploads"
    path.mkdir()
    return path


@pytest.fixture
def client_no_key(db_path: Path, upload_dir: Path) -> Generator[TestClient, None, None]:
    ConfigManager.reset()
    reset_engine()
    ConfigManager().load_from_dict(
        AppSettings, _settings(str(db_path), str(upload_dir), llm_api_key="")
    )
    from src.main import app

    with TestClient(app) as test_client:
        yield test_client
    reset_engine()
    ConfigManager.reset()


@pytest.fixture
def client_small_limit(db_path: Path, upload_dir: Path) -> Generator[TestClient, None, None]:
    ConfigManager.reset()
    reset_engine()
    ConfigManager().load_from_dict(
        AppSettings,
        _settings(str(db_path), str(upload_dir), llm_api_key="", max_upload_bytes=10),
    )
    from src.main import app

    with TestClient(app) as test_client:
        yield test_client
    reset_engine()
    ConfigManager.reset()


@pytest.fixture
def client_with_key(db_path: Path, upload_dir: Path) -> Generator[TestClient, None, None]:
    ConfigManager.reset()
    reset_engine()
    ConfigManager().load_from_dict(
        AppSettings, _settings(str(db_path), str(upload_dir), llm_api_key="test-key-not-real")
    )
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


def _upload_file(name: str, content: str | bytes, content_type: str) -> dict:
    payload = content.encode("utf-8") if isinstance(content, str) else content
    return {"file": (name, payload, content_type)}


def _md_file(name: str, content: str | bytes) -> dict:
    return _upload_file(name, content, "text/markdown")


def _txt_file(name: str, content: str | bytes) -> dict:
    return _upload_file(name, content, "text/plain")


def _pdf_file(name: str, content: bytes) -> dict:
    return _upload_file(name, content, "application/pdf")


def _pdf_with_text(text: str) -> bytes:
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


def _blank_pdf() -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    buffer = BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def _count(db_path: Path, table: str, document_id: str | None = None) -> int:
    sql = f"SELECT COUNT(*) FROM {table}"
    params: tuple = ()
    if document_id is not None:
        sql += " WHERE document_id = ?"
        params = (document_id,)
    return int(sqlite3.connect(db_path).execute(sql, params).fetchone()[0])


def _count_documents(db_path: Path) -> int:
    return int(sqlite3.connect(db_path).execute("SELECT COUNT(*) FROM documents").fetchone()[0])


async def _fake_tag(_settings, _text: str) -> dict:
    return {
        "object_types": ["product_3c"],
        "request_types": ["usage_guidance"],
        "entities": [{"name": "VPN", "type": "product"}],
        "faqs": [{"question": "如何连接VPN？", "answer": "打开客户端并导入配置。"}],
    }


async def _fake_embed(settings, texts: list[str]) -> list[list[float]]:
    dim = settings.embedding_dimensions
    return [[0.01] * dim for _ in texts]


async def _noop_ingest(_document_id: str) -> None:
    return None


def test_reject_unsupported_empty_and_unreadable_pdf(
    client_no_key: TestClient, db_path: Path
) -> None:
    headers = _auth_header(client_no_key)
    cases = [
        _md_file("guide.docx", "# hello\n"),
        _txt_file("empty.txt", ""),
        _md_file("empty.md", ""),
        _pdf_file("empty.pdf", b""),
        _pdf_file("blank.pdf", _blank_pdf()),
        _pdf_file("broken.pdf", b"%PDF-1.4 not a readable document"),
    ]
    for payload in cases:
        response = client_no_key.post(
            "/api/documents",
            headers=headers,
            files=payload,
        )
        assert response.status_code == 400
        body = response.json()
        assert body["error"] == "请重新上传"
        assert body["error_code"] == "VALIDATION_ERROR"
        assert _count_documents(db_path) == 0


def test_reject_oversized_file(client_small_limit: TestClient, db_path: Path) -> None:
    headers = _auth_header(client_small_limit)
    oversize = client_small_limit.post(
        "/api/documents",
        headers=headers,
        files=_md_file("big.md", "abcdefghijklmnop"),
    )
    assert oversize.status_code == 400
    assert oversize.json()["error"] == "请重新上传"
    assert oversize.json()["error_code"] == "VALIDATION_ERROR"
    assert _count_documents(db_path) == 0


def test_valid_md_returns_202_ingesting_empty_chunks(client_no_key: TestClient) -> None:
    headers = _auth_header(client_no_key)
    response = client_no_key.post(
        "/api/documents",
        headers=headers,
        files=_md_file("vpn-guide.md", "# VPN\n\n打开客户端。\n"),
    )
    assert response.status_code == 202
    data = response.json()["data"]
    assert data["ingest_status"] == "ingesting"
    assert data["ingest_error"] is None
    assert data["chunks"] == []
    assert data["chunk_count"] == 0
    assert data["faqs"] == []
    assert data["object_types"] == []
    assert data["filename"] == "vpn-guide.md"


def test_valid_txt_and_pdf_return_202_with_original_filename(
    client_no_key: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("src.api.routes.documents.run_ingest_job", _noop_ingest)
    headers = _auth_header(client_no_key)
    txt = client_no_key.post(
        "/api/documents",
        headers=headers,
        files=_txt_file("notes.txt", "第一段说明。\n\n第二段说明。\n"),
    )
    assert txt.status_code == 202
    txt_data = txt.json()["data"]
    assert txt_data["ingest_status"] == "ingesting"
    assert txt_data["filename"] == "notes.txt"
    assert txt_data["chunks"] == []
    assert txt_data["chunk_count"] == 0

    pdf = client_no_key.post(
        "/api/documents",
        headers=headers,
        files=_pdf_file("policy.pdf", _pdf_with_text("Copyable PDF paragraph.")),
    )
    assert pdf.status_code == 202
    pdf_data = pdf.json()["data"]
    assert pdf_data["ingest_status"] == "ingesting"
    assert pdf_data["filename"] == "policy.pdf"
    assert pdf_data["chunks"] == []
    assert pdf_data["chunk_count"] == 0


def test_no_key_background_fails_without_retrieval_rows(
    client_no_key: TestClient, db_path: Path
) -> None:
    headers = _auth_header(client_no_key)
    uploaded = client_no_key.post(
        "/api/documents",
        headers=headers,
        files=_md_file("vpn-guide.md", "# VPN\n\n打开客户端。\n"),
    )
    assert uploaded.status_code == 202
    document_id = uploaded.json()["data"]["id"]
    detail = client_no_key.get(f"/api/documents/{document_id}", headers=headers)
    assert detail.status_code == 200
    data = detail.json()["data"]
    assert data["ingest_status"] == "failed"
    assert data["ingest_error"] == "请重新上传"
    assert data["chunks"] == []
    assert data["chunk_count"] == 0
    assert data["faqs"] == []
    assert _count(db_path, "chunks", document_id) == 0
    assert _count(db_path, "faqs", document_id) == 0


def test_patch_ingesting_is_409(
    client_no_key: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("src.api.routes.documents.run_ingest_job", _noop_ingest)
    headers = _auth_header(client_no_key)
    uploaded = client_no_key.post(
        "/api/documents",
        headers=headers,
        files=_md_file("vpn-guide.md", "# VPN\n\n打开客户端。\n"),
    )
    document_id = uploaded.json()["data"]["id"]
    assert uploaded.json()["data"]["ingest_status"] == "ingesting"
    ingesting = client_no_key.patch(
        f"/api/documents/{document_id}",
        headers=headers,
        json={"object_types": ["product_3c"]},
    )
    assert ingesting.status_code == 409
    assert ingesting.json()["error"] == "文档仍在入库中，完成后才能修改标签或 FAQ。"
    assert ingesting.json()["error_code"] == "CONFLICT"


def test_patch_failed_is_409(client_no_key: TestClient) -> None:
    headers = _auth_header(client_no_key)
    uploaded = client_no_key.post(
        "/api/documents",
        headers=headers,
        files=_md_file("other.md", "# 打印机\n\n检查电源。\n"),
    )
    failed_id = uploaded.json()["data"]["id"]
    failed = client_no_key.patch(
        f"/api/documents/{failed_id}",
        headers=headers,
        json={"object_types": ["product_3c"]},
    )
    assert failed.status_code == 409
    assert failed.json()["error"] == "请重新上传"


def test_ready_preview_and_tag_update_keeps_chunks(
    client_with_key: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("src.services.ingest.tag_document", _fake_tag)
    monkeypatch.setattr("src.services.ingest.embed_texts", _fake_embed)
    headers = _auth_header(client_with_key)
    source = (
        "# VPN\n\n"
        f"## 密码重置\n\n{'甲' * 500}\n\n"
        f"## 连接失败\n\n{'乙' * 500}\n"
    )
    expected = chunk_markdown(source, max_chars=800, overlap_chars=160)
    uploaded = client_with_key.post(
        "/api/documents",
        headers=headers,
        files=_md_file("vpn-long.md", source),
    )
    assert uploaded.status_code == 202
    document_id = uploaded.json()["data"]["id"]
    detail = client_with_key.get(f"/api/documents/{document_id}", headers=headers)
    assert detail.status_code == 200
    data = detail.json()["data"]
    assert data["ingest_status"] == "ready"
    assert data["ingest_error"] is None
    assert len(data["chunks"]) == data["chunk_count"]
    assert data["chunk_count"] == len(expected)
    assert [item["position"] for item in data["chunks"]] == [item.position for item in expected]
    assert [item["heading_path"] for item in data["chunks"]] == [
        item.heading_path for item in expected
    ]
    assert [item["content"] for item in data["chunks"]] == [item.content for item in expected]
    assert "embedding" not in data
    assert all("embedding" not in item for item in data["chunks"])
    before = data["chunks"]

    patched = client_with_key.patch(
        f"/api/documents/{document_id}",
        headers=headers,
        json={"object_types": ["product_fashion"]},
    )
    assert patched.status_code == 200
    patched_data = patched.json()["data"]
    assert patched_data["object_types"] == ["product_fashion"]
    assert patched_data["chunks"] == before
    assert patched_data["chunk_count"] == len(before)


def test_ready_txt_and_pdf_convert_then_chunk(
    client_with_key: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("src.services.ingest.tag_document", _fake_tag)
    monkeypatch.setattr("src.services.ingest.embed_texts", _fake_embed)
    headers = _auth_header(client_with_key)

    txt_body = "这段没有标题的说明文字用于验证切块。" * 50
    assert len(txt_body) > 800
    expected_txt = chunk_markdown(
        convert_file_to_markdown("long.txt", txt_body.encode("utf-8")),
        max_chars=800,
        overlap_chars=160,
    )
    txt_resp = client_with_key.post(
        "/api/documents",
        headers=headers,
        files=_txt_file("long.txt", txt_body),
    )
    assert txt_resp.status_code == 202
    txt_id = txt_resp.json()["data"]["id"]
    txt_detail = client_with_key.get(f"/api/documents/{txt_id}", headers=headers).json()["data"]
    assert txt_detail["ingest_status"] == "ready"
    assert txt_detail["filename"] == "long.txt"
    assert txt_detail["chunk_count"] == len(expected_txt) > 1
    assert [item["position"] for item in txt_detail["chunks"]] == [
        item.position for item in expected_txt
    ]
    assert all(item["heading_path"] == "" for item in txt_detail["chunks"])
    assert txt_detail["chunks"][1]["content"][:160] == txt_detail["chunks"][0]["content"][-160:]

    pdf_body = "Copyable VPN help text for local extract. " * 40
    assert len(pdf_body) > 800
    pdf_raw = _pdf_with_text(pdf_body)
    expected_pdf = chunk_markdown(
        convert_file_to_markdown("long.pdf", pdf_raw),
        max_chars=800,
        overlap_chars=160,
    )
    pdf_resp = client_with_key.post(
        "/api/documents",
        headers=headers,
        files=_pdf_file("long.pdf", pdf_raw),
    )
    assert pdf_resp.status_code == 202
    pdf_id = pdf_resp.json()["data"]["id"]
    pdf_detail = client_with_key.get(f"/api/documents/{pdf_id}", headers=headers).json()["data"]
    assert pdf_detail["ingest_status"] == "ready"
    assert pdf_detail["filename"] == "long.pdf"
    assert pdf_detail["chunk_count"] == len(expected_pdf) > 1
    assert all(item["heading_path"] == "" for item in pdf_detail["chunks"])
    assert pdf_detail["chunks"][1]["content"][:160] == pdf_detail["chunks"][0]["content"][-160:]


def test_no_key_txt_and_pdf_fail_without_retrieval_rows(
    client_no_key: TestClient, db_path: Path
) -> None:
    headers = _auth_header(client_no_key)
    txt = client_no_key.post(
        "/api/documents",
        headers=headers,
        files=_txt_file("notes.txt", "可入库的纯文本。\n"),
    )
    assert txt.status_code == 202
    txt_id = txt.json()["data"]["id"]
    txt_detail = client_no_key.get(f"/api/documents/{txt_id}", headers=headers).json()["data"]
    assert txt_detail["ingest_status"] == "failed"
    assert txt_detail["ingest_error"] == "请重新上传"
    assert txt_detail["chunks"] == []
    assert txt_detail["faqs"] == []
    assert _count(db_path, "chunks", txt_id) == 0
    assert _count(db_path, "faqs", txt_id) == 0

    pdf = client_no_key.post(
        "/api/documents",
        headers=headers,
        files=_pdf_file("policy.pdf", _pdf_with_text("Copyable PDF paragraph.")),
    )
    assert pdf.status_code == 202
    pdf_id = pdf.json()["data"]["id"]
    pdf_detail = client_no_key.get(f"/api/documents/{pdf_id}", headers=headers).json()["data"]
    assert pdf_detail["ingest_status"] == "failed"
    assert pdf_detail["ingest_error"] == "请重新上传"
    assert pdf_detail["chunks"] == []
    assert _count(db_path, "chunks", pdf_id) == 0
    assert _count(db_path, "faqs", pdf_id) == 0


def test_ingesting_and_failed_detail_chunks_empty(
    client_no_key: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("src.api.routes.documents.run_ingest_job", _noop_ingest)
    headers = _auth_header(client_no_key)
    uploaded = client_no_key.post(
        "/api/documents",
        headers=headers,
        files=_md_file("hold.md", "# VPN\n\n打开客户端。\n"),
    )
    document_id = uploaded.json()["data"]["id"]
    ingesting = client_no_key.get(f"/api/documents/{document_id}", headers=headers)
    assert ingesting.json()["data"]["ingest_status"] == "ingesting"
    assert ingesting.json()["data"]["chunks"] == []


def test_missing_auth_is_401(client_no_key: TestClient) -> None:
    response = client_no_key.get("/api/documents")
    assert response.status_code == 401
    assert response.json()["error"] == "请先登录"


def test_missing_document_is_404(client_no_key: TestClient) -> None:
    headers = _auth_header(client_no_key)
    response = client_no_key.get("/api/documents/missing-id", headers=headers)
    assert response.status_code == 404
    assert response.json()["error"] == "文档不存在"
    assert response.json()["error_code"] == "NOT_FOUND"


def test_no_dashscope_sdk_in_write_scope() -> None:
    backend = Path(__file__).resolve().parents[1]
    roots = [
        backend / "src" / "integrations" / "bailian.py",
        backend / "src" / "services" / "ingest.py",
        backend / "src" / "api" / "routes" / "documents.py",
        backend / "src" / "utils" / "text.py",
    ]
    joined = "\n".join(path.read_text(encoding="utf-8") for path in roots)
    assert "import dashscope" not in joined
    assert "from dashscope" not in joined
    requirements = (backend / "requirements.txt").read_text(encoding="utf-8")
    assert "pypdf" in requirements
    assert "dashscope" not in requirements


_LIST_ITEM_KEYS = {
    "id",
    "filename",
    "ingest_status",
    "ingest_error",
    "object_types",
    "request_types",
    "faq_count",
    "chunk_count",
    "visibility",
    "effective_from",
    "effective_to",
    "created_at",
    "updated_at",
}


def _insert_status_docs(db_path: Path) -> None:
    conn = sqlite3.connect(db_path)
    now = datetime.now(UTC).replace(microsecond=0)
    rows = [
        ("doc-ready-new", "ready-new.md", "ready", None, now),
        ("doc-ingesting", "ingesting.md", "ingesting", None, now - timedelta(seconds=10)),
        ("doc-ready-old", "ready-old.md", "ready", None, now - timedelta(seconds=20)),
        ("doc-failed", "failed.md", "failed", "请重新上传", now - timedelta(seconds=30)),
    ]
    for doc_id, filename, status, error, ts in rows:
        stamp = ts.replace(tzinfo=None).isoformat(sep=" ")
        conn.execute(
            """
            INSERT INTO documents (
                id, filename, ingest_status, ingest_error,
                object_types_json, request_types_json, entities_json,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, '[]', '[]', '[]', ?, ?)
            """,
            (doc_id, filename, status, error, stamp, stamp),
        )
    conn.commit()
    conn.close()


def _list_documents(
    client: TestClient,
    headers: dict[str, str],
    **params: object,
) -> dict:
    query = {key: value for key, value in params.items() if value is not None}
    response = client.get("/api/documents", headers=headers, params=query)
    return {"status": response.status_code, "body": response.json()}


def test_list_documents_filter_sort_and_pagination(
    client_no_key: TestClient, db_path: Path
) -> None:
    headers = _auth_header(client_no_key)
    _insert_status_docs(db_path)
    listed = _list_documents(client_no_key, headers)
    assert listed["status"] == 200
    body = listed["body"]
    ids = [item["id"] for item in body["data"]]
    assert ids == ["doc-ready-new", "doc-ingesting", "doc-ready-old", "doc-failed"]
    assert body["pagination"]["total_items"] == 4
    assert body["pagination"]["total_pages"] == 1
    for item in body["data"]:
        assert set(item) == _LIST_ITEM_KEYS
        assert "chunks" not in item

    ingesting = _list_documents(client_no_key, headers, ingest_status="ingesting")
    assert ingesting["status"] == 200
    ingesting_ids = [item["id"] for item in ingesting["body"]["data"]]
    assert ingesting_ids == ["doc-ingesting"]
    assert ingesting["body"]["pagination"]["total_items"] == 1
    assert all(item["ingest_status"] == "ingesting" for item in ingesting["body"]["data"])

    failed = _list_documents(client_no_key, headers, ingest_status="failed")
    assert failed["status"] == 200
    assert [item["id"] for item in failed["body"]["data"]] == ["doc-failed"]
    assert failed["body"]["pagination"]["total_items"] == 1
    assert failed["body"]["data"][0]["ingest_status"] == "failed"

    ready = _list_documents(
        client_no_key, headers, ingest_status="ready", page=1, page_size=1
    )
    assert ready["status"] == 200
    assert [item["id"] for item in ready["body"]["data"]] == ["doc-ready-new"]
    assert ready["body"]["pagination"]["total_items"] == 2
    assert ready["body"]["pagination"]["total_pages"] == 2
    assert ready["body"]["pagination"]["has_next"] is True
    ready_page2 = _list_documents(
        client_no_key, headers, ingest_status="ready", page=2, page_size=1
    )
    assert [item["id"] for item in ready_page2["body"]["data"]] == ["doc-ready-old"]
    assert ready_page2["body"]["pagination"]["total_items"] == 2
    assert all(item["ingest_status"] == "ready" for item in ready["body"]["data"])
    assert all(item["ingest_status"] == "ready" for item in ready_page2["body"]["data"])
    assert listed["body"]["data"][0]["visibility"] == "user_visible"
    assert listed["body"]["data"][0]["effective_from"] is None
    assert listed["body"]["data"][0]["effective_to"] is None
    ingesting_item = next(item for item in listed["body"]["data"] if item["id"] == "doc-ingesting")
    assert ingesting_item["visibility"] is None


def test_list_documents_invalid_ingest_status_is_400(client_no_key: TestClient) -> None:
    headers = _auth_header(client_no_key)
    cases = [
        client_no_key.get("/api/documents", headers=headers, params={"ingest_status": "unknown"}),
        client_no_key.get("/api/documents?ingest_status=", headers=headers),
        client_no_key.get("/api/documents", headers=headers, params={"ingest_status": "Ready"}),
    ]
    for response in cases:
        assert response.status_code == 400
        body = response.json()
        assert body["error"] == "入库状态筛选无效"
        assert body["error_code"] == "VALIDATION_ERROR"
        assert not isinstance(body.get("data"), list)

    paging = client_no_key.get("/api/documents", headers=headers, params={"page": 0})
    assert paging.status_code == 400
    assert paging.json()["error_code"] == "VALIDATION_ERROR"


def _as_utc_text(value: str | None) -> str | None:
    if value is None:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC).isoformat()


def test_patch_visibility_and_effective_dates_then_get_matches(
    client_with_key: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("src.services.ingest.tag_document", _fake_tag)
    monkeypatch.setattr("src.services.ingest.embed_texts", _fake_embed)
    headers = _auth_header(client_with_key)
    uploaded = client_with_key.post(
        "/api/documents",
        headers=headers,
        files=_md_file("policy.md", "# 保修\n\n耳机保修一年。\n"),
    )
    document_id = uploaded.json()["data"]["id"]
    detail = client_with_key.get(f"/api/documents/{document_id}", headers=headers)
    assert detail.json()["data"]["ingest_status"] == "ready"
    assert detail.json()["data"]["visibility"] == "user_visible"
    assert detail.json()["data"]["effective_from"] is None
    assert detail.json()["data"]["effective_to"] is None

    start = "2026-03-01T00:00:00+00:00"
    end = "2026-12-31T23:59:59+00:00"
    patched = client_with_key.patch(
        f"/api/documents/{document_id}",
        headers=headers,
        json={
            "visibility": "agent_only",
            "effective_from": start,
            "effective_to": end,
        },
    )
    assert patched.status_code == 200
    patched_data = patched.json()["data"]
    assert patched_data["visibility"] == "agent_only"
    assert _as_utc_text(patched_data["effective_from"]) == _as_utc_text(start)
    assert _as_utc_text(patched_data["effective_to"]) == _as_utc_text(end)

    again = client_with_key.get(f"/api/documents/{document_id}", headers=headers)
    assert again.status_code == 200
    again_data = again.json()["data"]
    assert again_data["visibility"] == patched_data["visibility"]
    assert _as_utc_text(again_data["effective_from"]) == _as_utc_text(
        patched_data["effective_from"]
    )
    assert _as_utc_text(again_data["effective_to"]) == _as_utc_text(patched_data["effective_to"])

    cleared = client_with_key.patch(
        f"/api/documents/{document_id}",
        headers=headers,
        json={"effective_from": None, "effective_to": None},
    )
    assert cleared.status_code == 200
    assert cleared.json()["data"]["effective_from"] is None
    assert cleared.json()["data"]["effective_to"] is None
    assert cleared.json()["data"]["visibility"] == "agent_only"
    after_clear = client_with_key.get(f"/api/documents/{document_id}", headers=headers)
    assert after_clear.json()["data"]["effective_from"] is None
    assert after_clear.json()["data"]["effective_to"] is None


def test_patch_invalid_visibility_or_date_range_is_400(
    client_with_key: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("src.services.ingest.tag_document", _fake_tag)
    monkeypatch.setattr("src.services.ingest.embed_texts", _fake_embed)
    headers = _auth_header(client_with_key)
    uploaded = client_with_key.post(
        "/api/documents",
        headers=headers,
        files=_md_file("policy.md", "# 保修\n\n耳机保修一年。\n"),
    )
    document_id = uploaded.json()["data"]["id"]
    invalid = client_with_key.patch(
        f"/api/documents/{document_id}",
        headers=headers,
        json={"visibility": "public"},
    )
    assert invalid.status_code == 400
    assert invalid.json()["error_code"] == "VALIDATION_ERROR"
    assert invalid.json()["error"] == "可见范围不合法"

    inverted = client_with_key.patch(
        f"/api/documents/{document_id}",
        headers=headers,
        json={
            "effective_from": "2026-12-31T00:00:00+00:00",
            "effective_to": "2026-01-01T00:00:00+00:00",
        },
    )
    assert inverted.status_code == 400
    assert inverted.json()["error"] == "结束时间不能早于开始时间"
    assert inverted.json()["error_code"] == "VALIDATION_ERROR"


def test_old_ready_document_defaults_to_user_visible(
    client_no_key: TestClient, db_path: Path
) -> None:
    headers = _auth_header(client_no_key)
    _insert_status_docs(db_path)
    detail = client_no_key.get("/api/documents/doc-ready-new", headers=headers)
    assert detail.status_code == 200
    data = detail.json()["data"]
    assert data["ingest_status"] == "ready"
    assert data["visibility"] == "user_visible"
    assert data["effective_from"] is None
    assert data["effective_to"] is None
