from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.db.models import Chunk, Document, Faq
from src.db.session import AppSettings, ensure_config
from src.repositories.document_repository import DEFAULT_READY_VISIBILITY, DocumentRepository
from src.utils.text import cosine_similarity

Audience = Literal["user", "agent"]
AUDIENCE_USER: Audience = "user"
AUDIENCE_AGENT: Audience = "agent"

POLICY_REQUEST_TYPES = frozenset({"policy_process", "after_sale_howto"})
USER_VISIBLE = DEFAULT_READY_VISIBILITY
AGENT_VISIBILITIES = frozenset(
    {"user_visible", "agent_only", "high_risk_human_only"}
)
_OBJECT_3C = "product_3c"
_OBJECT_FASHION = "product_fashion"
_TOKEN_RE = re.compile(r"[A-Za-z0-9_]+|[\u4e00-\u9fff]")


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def resolved_visibility(document: Document) -> str | None:
    if document.ingest_status == "ready" and not document.visibility:
        return USER_VISIBLE
    return document.visibility


def is_current_basis(document: Document, now: datetime | None = None) -> bool:
    request_types = set(document.request_types_json or [])
    if not request_types.intersection(POLICY_REQUEST_TYPES):
        return True
    if document.effective_from is None or document.effective_to is None:
        return False
    current = _as_utc(now or datetime.now(UTC))
    start = _as_utc(document.effective_from)
    end = _as_utc(document.effective_to)
    return start <= current <= end


def allowed_for_audience(
    document: Document, audience: Audience, now: datetime | None = None
) -> bool:
    if document.ingest_status != "ready":
        return False
    visibility = resolved_visibility(document)
    if audience == AUDIENCE_USER:
        if visibility != USER_VISIBLE:
            return False
    elif visibility not in AGENT_VISIBILITIES:
        return False
    return is_current_basis(document, now)


def tokenize(text: str) -> list[str]:
    return [match.group(0).lower() for match in _TOKEN_RE.finditer(text or "")]


def keyword_overlap_rate(
    query: str, heading_path: str, content: str, filename: str = ""
) -> float:
    query_tokens = set(tokenize(query))
    if not query_tokens:
        return 0.0
    doc_tokens = set(tokenize(f"{heading_path} {content} {filename}"))
    return len(query_tokens & doc_tokens) / len(query_tokens)


def filename_matches_query(query: str, filename: str) -> bool:
    raw = (query or "").strip().lower()
    name = (filename or "").strip().lower()
    if not raw or not name:
        return False
    if raw == name:
        return True
    stem = name.rsplit(".", 1)[0] if "." in name else name
    if not stem:
        return False
    if raw == stem:
        return True
    compact_q = raw.replace(" ", "")
    compact_name = name.replace(" ", "")
    compact_stem = stem.replace(" ", "")
    if len(compact_q) >= 8 and (
        compact_q in compact_name or compact_q in compact_stem
    ):
        return True
    return len(compact_stem) >= 8 and compact_stem in compact_q


def fusion_score(
    cosine: float,
    keyword: float,
    settings: AppSettings | None = None,
) -> float:
    loaded = settings or ensure_config()
    return loaded.retrieve_cosine_weight * cosine + loaded.retrieve_keyword_weight * keyword


def _chunk_object_types(chunk: Chunk) -> set[str]:
    return set(chunk.object_types_json or [])


def _is_cross_category_chunk(chunk: Chunk, primary: str | None) -> bool:
    objects = _chunk_object_types(chunk)
    if primary == _OBJECT_3C and _OBJECT_FASHION in objects and _OBJECT_3C not in objects:
        return True
    if primary == _OBJECT_FASHION and _OBJECT_3C in objects and _OBJECT_FASHION not in objects:
        return True
    return False


def filter_chunks_for_issue(chunks: list[Chunk], issue: object) -> list[Chunk]:
    tags: set[str] = set(getattr(issue, "related_object_types", None) or [])
    primary = getattr(issue, "primary_object_type", None)
    if primary:
        tags.add(primary)
    if not tags:
        return []
    matched = [
        chunk
        for chunk in chunks
        if tags.intersection(_chunk_object_types(chunk))
        and not _is_cross_category_chunk(chunk, primary)
    ]
    request_type = getattr(issue, "request_type", None)
    if request_type:
        subset = [
            chunk
            for chunk in matched
            if request_type in (chunk.request_types_json or [])
        ]
        if subset:
            return subset
    return matched


def rank_chunks(
    query_vec: list[float],
    chunks: list[Chunk],
    top_k: int,
    min_score: float,
) -> list[Chunk]:
    scored: list[tuple[float, int, Chunk]] = []
    for index, chunk in enumerate(chunks):
        embedding = chunk.embedding
        if not isinstance(embedding, list) or not embedding:
            continue
        score = cosine_similarity(query_vec, embedding)
        if score >= min_score:
            scored.append((score, index, chunk))
    scored.sort(key=lambda item: (-item[0], item[1]))
    return [item[2] for item in scored[:top_k]]


def rank_retrieved_chunks(
    query_vec: list[float],
    query_text: str,
    chunks: list[Chunk],
    top_k: int,
    min_score: float,
    settings: AppSettings | None = None,
) -> list[Chunk]:
    loaded = settings or ensure_config()
    scored: list[tuple[float, int, Chunk]] = []
    for index, chunk in enumerate(chunks):
        document = chunk.document
        filename = document.filename if document is not None else ""
        embedding = chunk.embedding
        has_vec = isinstance(embedding, list) and bool(embedding)
        name_hit = filename_matches_query(query_text, filename)
        if not has_vec and not name_hit:
            continue
        cosine = cosine_similarity(query_vec, embedding) if has_vec else 0.0
        keyword = keyword_overlap_rate(
            query_text, chunk.heading_path, chunk.content, filename
        )
        score = fusion_score(cosine, keyword, loaded)
        if score >= min_score or name_hit:
            ranked_score = max(score, 1.0) if name_hit else score
            scored.append((ranked_score, index, chunk))
    scored.sort(key=lambda item: (-item[0], item[1]))
    return [item[2] for item in scored[:top_k]]


async def load_ready_chunks(
    db: AsyncSession,
    audience: Audience,
    now: datetime | None = None,
) -> list[Chunk]:
    repo = DocumentRepository(db)
    await repo.ensure_columns()
    result = await db.execute(
        select(Chunk)
        .options(selectinload(Chunk.document))
        .join(Document, Document.id == Chunk.document_id)
        .where(Document.ingest_status == "ready")
        .order_by(Document.created_at.asc(), Chunk.position.asc())
    )
    chunks = list(result.scalars().unique().all())
    current = now or datetime.now(UTC)
    return [
        chunk
        for chunk in chunks
        if chunk.document is not None and allowed_for_audience(chunk.document, audience, current)
    ]


async def load_ready_faqs(
    db: AsyncSession,
    audience: Audience,
    now: datetime | None = None,
) -> list[Faq]:
    repo = DocumentRepository(db)
    await repo.ensure_columns()
    result = await db.execute(
        select(Faq)
        .options(selectinload(Faq.document))
        .join(Document, Document.id == Faq.document_id)
        .where(Document.ingest_status == "ready")
        .order_by(Document.created_at.asc(), Faq.id.asc())
    )
    faqs = list(result.scalars().unique().all())
    current = now or datetime.now(UTC)
    return [
        faq
        for faq in faqs
        if faq.document is not None and allowed_for_audience(faq.document, audience, current)
    ]
