from io import BytesIO
from pathlib import Path

from pypdf import PdfWriter
from src.db.session import AppSettings
from src.utils.text import chunk_markdown, convert_file_to_markdown

_CHUNK_MAX = 800
_CHUNK_OVERLAP = 160
_BACKEND_DIR = Path(__file__).resolve().parents[1]


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


def test_multi_heading_long_markdown_splits_with_paths() -> None:
    body_reset = "甲" * 500
    body_fail = "乙" * 500
    text = (
        "# VPN\n\n"
        f"## 密码重置\n\n{body_reset}\n\n"
        f"## 连接失败\n\n{body_fail}\n"
    )
    assert len(text) > _CHUNK_MAX
    markdown = convert_file_to_markdown("vpn.md", text.encode("utf-8"))
    chunks = chunk_markdown(markdown, max_chars=_CHUNK_MAX, overlap_chars=_CHUNK_OVERLAP)
    assert len(chunks) > 1
    assert [chunk.position for chunk in chunks] == list(range(1, len(chunks) + 1))
    assert chunks[0].heading_path == "VPN / 密码重置"
    assert chunks[0].content.startswith("VPN / 密码重置")
    assert "甲" in chunks[0].content
    paths = [chunk.heading_path for chunk in chunks]
    assert "VPN / 连接失败" in paths
    fail_chunk = next(chunk for chunk in chunks if chunk.heading_path == "VPN / 连接失败")
    assert fail_chunk.content.startswith("VPN / 连接失败")
    assert "乙" in fail_chunk.content
    assert all(len(chunk.content) <= _CHUNK_MAX for chunk in chunks)


def test_parent_heading_without_body_is_not_a_chunk() -> None:
    text = "# A\n\n## B\n\n### C\n\n正文内容。\n"
    chunks = chunk_markdown(text, max_chars=_CHUNK_MAX, overlap_chars=_CHUNK_OVERLAP)
    assert [chunk.heading_path for chunk in chunks] == ["A / B / C"]
    assert all(chunk.content.strip() for chunk in chunks)


def test_headingless_txt_convert_then_chunk() -> None:
    body = "这段没有标题的说明文字用于验证切块。" * 50
    assert len(body) > _CHUNK_MAX
    markdown = convert_file_to_markdown("notes.txt", body.encode("utf-8"))
    assert markdown
    assert not any(line.startswith("#") for line in markdown.splitlines() if line.strip())
    chunks = chunk_markdown(markdown, max_chars=_CHUNK_MAX, overlap_chars=_CHUNK_OVERLAP)
    assert len(chunks) > 1
    assert [chunk.position for chunk in chunks] == list(range(1, len(chunks) + 1))
    assert all(chunk.heading_path == "" for chunk in chunks)
    assert chunks[1].content[:_CHUNK_OVERLAP] == chunks[0].content[-_CHUNK_OVERLAP:]


def test_pdf_long_body_convert_then_chunk() -> None:
    body = "Copyable VPN help text for local extract. " * 40
    assert len(body) > _CHUNK_MAX
    raw = _pdf_with_text(body)
    markdown = convert_file_to_markdown("guide.pdf", raw)
    assert markdown.strip()
    chunks = chunk_markdown(markdown, max_chars=_CHUNK_MAX, overlap_chars=_CHUNK_OVERLAP)
    assert len(chunks) > 1
    assert [chunk.position for chunk in chunks] == list(range(1, len(chunks) + 1))
    assert all(chunk.heading_path == "" for chunk in chunks)
    assert chunks[1].content[:_CHUNK_OVERLAP] == chunks[0].content[-_CHUNK_OVERLAP:]


def test_long_paragraph_uses_overlap() -> None:
    text = "A" * 1000
    chunks = chunk_markdown(text, max_chars=_CHUNK_MAX, overlap_chars=_CHUNK_OVERLAP)
    assert len(chunks) > 1
    assert chunks[0].heading_path == ""
    assert chunks[0].position == 1
    assert chunks[1].content[:_CHUNK_OVERLAP] == chunks[0].content[-_CHUNK_OVERLAP:]


def test_blank_pdf_has_no_copyable_markdown() -> None:
    markdown = convert_file_to_markdown("empty.pdf", _blank_pdf())
    assert markdown.strip() == ""


def test_chunk_overlap_default_is_160() -> None:
    assert AppSettings.model_fields["chunk_overlap_chars"].default == _CHUNK_OVERLAP
    example = (_BACKEND_DIR / ".env.example").read_text(encoding="utf-8")
    assert "chunk_overlap_chars=160" in example


def test_conversion_is_local_only() -> None:
    source = (_BACKEND_DIR / "src" / "utils" / "text.py").read_text(encoding="utf-8")
    assert "import dashscope" not in source
    assert "from dashscope" not in source
    assert "httpx" not in source
    assert "from pypdf" in source
    convert_file_to_markdown("a.txt", ("正文" * 20).encode("utf-8"))
    convert_file_to_markdown("b.pdf", _pdf_with_text("Local copyable paragraph."))
