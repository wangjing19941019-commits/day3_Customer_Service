from __future__ import annotations

import math
import re
from collections.abc import Sequence
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

from pycore.core.logger import get_logger
from pypdf import PdfReader

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
_HEADING_JOIN = " / "
_ALLOWED_UPLOAD_SUFFIXES = {".md", ".txt", ".pdf"}
_WORD_CHAR_RE = re.compile(r"[\w\u4e00-\u9fff]", re.UNICODE)
_PDF_CHAPTER_RE = re.compile(r"^第[0-9零一二三四五六七八九十百千万两]+\s*[章节篇部]")
_PDF_DOTTED_HEADING_RE = re.compile(r"^\d+\.\d+(?:\.\d+)*\s+\S")

logger = get_logger()


@dataclass(frozen=True)
class TextChunk:
    position: int
    heading_path: str
    content: str


def cosine_similarity(left: Sequence[float], right: Sequence[float]) -> float:
    if not left or not right:
        return 0.0
    size = min(len(left), len(right))
    if size == 0:
        return 0.0
    dot = 0.0
    norm_left = 0.0
    norm_right = 0.0
    for index in range(size):
        a = float(left[index])
        b = float(right[index])
        dot += a * b
        norm_left += a * a
        norm_right += b * b
    if norm_left == 0.0 or norm_right == 0.0:
        return 0.0
    return dot / (math.sqrt(norm_left) * math.sqrt(norm_right))


def upload_suffix(filename: str | None) -> str:
    return Path(filename or "").suffix.lower()


def is_allowed_upload_suffix(suffix: str) -> bool:
    return suffix in _ALLOWED_UPLOAD_SUFFIXES


def has_copyable_paragraph(text: str) -> bool:
    stripped = text.strip()
    if not stripped:
        return False
    return _WORD_CHAR_RE.search(stripped) is not None


def extract_pdf_copyable_text(raw: bytes) -> str:
    if not raw:
        return ""
    try:
        reader = PdfReader(BytesIO(raw), strict=False)
    except Exception:
        logger.info("PDF 无法打开，抽不出可复制文字")
        return ""
    if getattr(reader, "is_encrypted", False):
        try:
            reader.decrypt("")
        except Exception:
            logger.info("PDF 已加密，抽不出可复制文字")
            return ""
        if getattr(reader, "is_encrypted", False):
            try:
                _ = reader.pages
            except Exception:
                logger.info("PDF 已加密，抽不出可复制文字")
                return ""
    pages: list[str] = []
    try:
        page_list = list(reader.pages)
    except Exception:
        logger.info("PDF 无法读取页面，抽不出可复制文字")
        return ""
    for page in page_list:
        try:
            extracted = page.extract_text() or ""
        except Exception:
            continue
        text = extracted.strip()
        if text:
            pages.append(text)
    return "\n\n".join(pages)


def _as_markdown_body(block: str) -> str:
    lines: list[str] = []
    for line in block.splitlines():
        if _HEADING_RE.match(line):
            lines.append("\\" + line)
        else:
            lines.append(line)
    return "\n".join(lines)


def convert_txt_to_markdown(text: str) -> str:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    blocks = [block.strip() for block in re.split(r"\n\s*\n", normalized) if block.strip()]
    if not blocks:
        return ""
    return "\n\n".join(_as_markdown_body(block) for block in blocks)


def _recognized_pdf_heading(line: str) -> str | None:
    atx = _HEADING_RE.match(line)
    if atx:
        return f"{atx.group(1)} {atx.group(2).strip()}"
    if _PDF_CHAPTER_RE.match(line):
        return f"# {line}"
    if _PDF_DOTTED_HEADING_RE.match(line):
        return f"## {line}"
    return None


def convert_pdf_text_to_markdown(extracted: str) -> str:
    normalized = extracted.replace("\r\n", "\n").replace("\r", "\n")
    output: list[str] = []
    for raw_line in normalized.splitlines():
        line = raw_line.strip()
        if not line:
            if output and output[-1] != "":
                output.append("")
            continue
        heading = _recognized_pdf_heading(line)
        if heading is not None:
            if output and output[-1] != "":
                output.append("")
            output.append(heading)
            output.append("")
        else:
            output.append(line)
    text = "\n".join(output)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def convert_file_to_markdown(name: str, raw: bytes) -> str:
    suffix = Path(name).suffix.lower()
    if not suffix:
        lowered = name.lower()
        if lowered in _ALLOWED_UPLOAD_SUFFIXES:
            suffix = lowered
        elif f".{lowered}" in _ALLOWED_UPLOAD_SUFFIXES:
            suffix = f".{lowered}"
    if suffix == ".md":
        return raw.decode("utf-8")
    if suffix == ".txt":
        return convert_txt_to_markdown(raw.decode("utf-8"))
    if suffix == ".pdf":
        return convert_pdf_text_to_markdown(extract_pdf_copyable_text(raw))
    raise ValueError("不支持的文件类型")


def _heading_path(stack: list[tuple[int, str]]) -> str:
    return _HEADING_JOIN.join(title for _, title in stack)


def _prefixed(heading_path: str, body: str) -> str:
    body = body.strip()
    if not heading_path:
        return body
    if not body:
        return heading_path
    return f"{heading_path}\n\n{body}"


def _window_split(text: str, max_chars: int, overlap_chars: int) -> list[str]:
    if not text:
        return []
    if max_chars <= 0:
        return [text]
    if len(text) <= max_chars:
        return [text]
    overlap = overlap_chars if overlap_chars > 0 else 0
    if overlap >= max_chars:
        overlap = 0
    parts: list[str] = []
    start = 0
    length = len(text)
    while start < length:
        end = min(start + max_chars, length)
        parts.append(text[start:end])
        if end >= length:
            break
        start = end - overlap
    return parts


def parse_markdown_sections(text: str) -> list[tuple[str, str]]:
    stack: list[tuple[int, str]] = []
    sections: list[tuple[str, str]] = []
    current_path = ""
    current_lines: list[str] = []

    def flush(*, heading_only: bool) -> None:
        nonlocal current_lines
        body = "\n".join(current_lines).strip()
        current_lines = []
        if body:
            sections.append((current_path, body))
        elif heading_only and current_path:
            sections.append((current_path, ""))

    for line in text.splitlines():
        match = _HEADING_RE.match(line)
        if match is None:
            current_lines.append(line)
            continue
        flush(heading_only=False)
        level = len(match.group(1))
        title = match.group(2).strip()
        while stack and stack[-1][0] >= level:
            stack.pop()
        stack.append((level, title))
        current_path = _heading_path(stack)
    flush(heading_only=True)
    if not sections and text.strip():
        sections.append(("", text.strip()))
    return sections


def _split_paragraphs(body: str) -> list[str]:
    parts = [part.strip() for part in re.split(r"\n\s*\n", body) if part.strip()]
    return parts if parts else ([body.strip()] if body.strip() else [])


def _pack_section(
    heading_path: str, body: str, max_chars: int, overlap_chars: int
) -> list[tuple[str, str]]:
    prefix = f"{heading_path}\n\n" if heading_path else ""
    body_limit = max_chars - len(prefix)
    if body_limit <= 0:
        return [(heading_path, heading_path[:max_chars] if heading_path else body[:max_chars])]

    paragraphs = _split_paragraphs(body)
    if not paragraphs:
        content = _prefixed(heading_path, "")
        return [(heading_path, content[:max_chars])] if content else []

    packed: list[tuple[str, str]] = []
    current: list[str] = []

    def emit_windows(raw: str) -> None:
        for window in _window_split(raw, body_limit, overlap_chars):
            packed.append((heading_path, prefix + window if prefix else window))

    for paragraph in paragraphs:
        trial_body = "\n\n".join([*current, paragraph]) if current else paragraph
        if len(trial_body) <= body_limit:
            current.append(paragraph)
            continue
        if current:
            emit_windows("\n\n".join(current))
            current = []
        if len(paragraph) <= body_limit:
            current = [paragraph]
        else:
            emit_windows(paragraph)
    if current:
        emit_windows("\n\n".join(current))
    return packed


def chunk_markdown(text: str, max_chars: int, overlap_chars: int) -> list[TextChunk]:
    sections = parse_markdown_sections(text)
    raw_chunks: list[tuple[str, str]] = []
    for heading_path, body in sections:
        raw_chunks.extend(_pack_section(heading_path, body, max_chars, overlap_chars))
    if not raw_chunks and text.strip():
        raw_chunks.extend(_pack_section("", text.strip(), max_chars, overlap_chars))
    return [
        TextChunk(position=index, heading_path=heading_path, content=content)
        for index, (heading_path, content) in enumerate(raw_chunks, start=1)
        if content
    ]
