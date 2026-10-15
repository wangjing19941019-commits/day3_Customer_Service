from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from pycore.core.logger import get_logger
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import Chunk, Document, Faq
from src.db.session import AppSettings, ensure_config, get_session_maker
from src.integrations.bailian import BailianClient, BailianError
from src.models.document import (
    INVALID_EFFECTIVE_RANGE,
    INVALID_VISIBILITY,
    VISIBILITY_VALUES,
    ChunkPreview,
    DocumentListItem,
    DocumentPublic,
    DocumentUpdate,
    EntityTag,
    FaqItem,
)
from src.repositories.document_repository import (
    DEFAULT_READY_VISIBILITY,
    REUPLOAD_MESSAGE,
    DocumentRepository,
)
from src.utils.text import (
    chunk_markdown,
    convert_file_to_markdown,
    extract_pdf_copyable_text,
    has_copyable_paragraph,
    is_allowed_upload_suffix,
    parse_markdown_sections,
    upload_suffix,
)

logger = get_logger()

_SRC_DIR = Path(__file__).resolve().parent.parent
_BACKEND_DIR = _SRC_DIR.parent
_TAXONOMY_PATH = _SRC_DIR / "resources" / "tag-taxonomy.json"
_PROMPT_PATH = _SRC_DIR / "prompts" / "ingest_tag_faq.md"
_ENTITY_TYPES = {"product", "order", "spec"}


class IngestValidationError(Exception):
    def __init__(self, message: str = REUPLOAD_MESSAGE):
        self.message = message
        super().__init__(message)


class IngestConflictError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class DocumentNotFoundError(Exception):
    pass


def has_llm_key(settings: AppSettings) -> bool:
    key = settings.llm_api_key.strip()
    return bool(key) and key != "your-llm-api-key"


def load_taxonomy() -> dict:
    return json.loads(_TAXONOMY_PATH.read_text(encoding="utf-8"))


def taxonomy_codes() -> tuple[set[str], set[str]]:
    taxonomy = load_taxonomy()
    object_codes = {item["code"] for item in taxonomy.get("object_types", [])}
    request_codes = {item["code"] for item in taxonomy.get("request_types", [])}
    return object_codes, request_codes


def resolve_upload_dir(settings: AppSettings) -> Path:
    path = Path(settings.upload_dir)
    if not path.is_absolute():
        path = _BACKEND_DIR / path
    path.mkdir(parents=True, exist_ok=True)
    return path.resolve()


def upload_file_path(settings: AppSettings, document_id: str, suffix: str = ".md") -> Path:
    normalized = suffix.lower() if suffix.startswith(".") else f".{suffix.lower()}"
    return resolve_upload_dir(settings) / f"{document_id}{normalized}"


def find_upload_path(settings: AppSettings, document_id: str) -> Path | None:
    directory = resolve_upload_dir(settings)
    for suffix in (".md", ".txt", ".pdf"):
        path = directory / f"{document_id}{suffix}"
        if path.is_file():
            return path
    return None


def delete_upload_file(settings: AppSettings, document_id: str) -> None:
    path = find_upload_path(settings, document_id)
    if path is not None and path.is_file():
        path.unlink()


def validate_upload_bytes(filename: str | None, raw: bytes, settings: AppSettings) -> str:
    suffix = upload_suffix(filename)
    if not is_allowed_upload_suffix(suffix):
        raise IngestValidationError(REUPLOAD_MESSAGE)
    if not raw:
        raise IngestValidationError(REUPLOAD_MESSAGE)
    if len(raw) > settings.max_upload_bytes:
        raise IngestValidationError(REUPLOAD_MESSAGE)
    if suffix in {".md", ".txt"}:
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise IngestValidationError(REUPLOAD_MESSAGE) from exc
        if not text.strip():
            raise IngestValidationError(REUPLOAD_MESSAGE)
        return suffix
    extracted = extract_pdf_copyable_text(raw)
    if not has_copyable_paragraph(extracted):
        raise IngestValidationError(REUPLOAD_MESSAGE)
    return suffix


def _is_ready(document: Document) -> bool:
    return document.ingest_status == "ready"


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def resolved_visibility(document: Document) -> str | None:
    if _is_ready(document) and not document.visibility:
        return DEFAULT_READY_VISIBILITY
    return document.visibility


def to_document_public(document: Document) -> DocumentPublic:
    ready = _is_ready(document)
    chunks: list[ChunkPreview] = []
    faqs: list[FaqItem] = []
    if ready:
        chunks = [
            ChunkPreview(
                position=chunk.position,
                heading_path=chunk.heading_path,
                content=chunk.content,
            )
            for chunk in sorted(document.chunks, key=lambda item: item.position)
        ]
        faqs = [
            FaqItem(id=faq.id, question=faq.question, answer=faq.answer)
            for faq in document.faqs
        ]
    ingest_error = REUPLOAD_MESSAGE if document.ingest_status == "failed" else None
    object_types = list(document.object_types_json or []) if ready else []
    request_types = list(document.request_types_json or []) if ready else []
    raw_entities = document.entities_json or [] if ready else []
    entities = [EntityTag.model_validate(item) for item in raw_entities]
    return DocumentPublic(
        id=document.id,
        filename=document.filename,
        ingest_status=document.ingest_status,
        ingest_error=ingest_error,
        object_types=object_types,
        request_types=request_types,
        entities=entities,
        faqs=faqs,
        chunks=chunks,
        chunk_count=len(chunks) if ready else 0,
        visibility=resolved_visibility(document),
        effective_from=_as_utc(document.effective_from),
        effective_to=_as_utc(document.effective_to),
        created_at=document.created_at,
        updated_at=document.updated_at,
    )


def to_list_item(document: Document) -> DocumentListItem:
    ready = _is_ready(document)
    ingest_error = REUPLOAD_MESSAGE if document.ingest_status == "failed" else None
    return DocumentListItem(
        id=document.id,
        filename=document.filename,
        ingest_status=document.ingest_status,
        ingest_error=ingest_error,
        object_types=list(document.object_types_json or []) if ready else [],
        request_types=list(document.request_types_json or []) if ready else [],
        faq_count=len(document.faqs) if ready else 0,
        chunk_count=len(document.chunks) if ready else 0,
        visibility=resolved_visibility(document),
        effective_from=_as_utc(document.effective_from),
        effective_to=_as_utc(document.effective_to),
        created_at=document.created_at,
        updated_at=document.updated_at,
    )


class IngestService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = DocumentRepository(db)
        self.settings = ensure_config()

    async def accept_upload(self, filename: str | None, raw: bytes) -> DocumentPublic:
        suffix = validate_upload_bytes(filename, raw, self.settings)
        await fail_stale_ingesting_documents(self.db)
        document_id = str(uuid4())
        display_name = Path(filename or f"document{suffix}").name
        path = upload_file_path(self.settings, document_id, suffix)
        path.write_bytes(raw)
        document = await self.repo.create_ingesting(document_id, display_name)
        logger.info("已受理文档上传", document_id=document_id, filename=display_name)
        return to_document_public(document)

    async def list_documents(self, page: int, page_size: int) -> tuple[list[DocumentListItem], int]:
        await fail_stale_ingesting_documents(self.db)
        offset = (page - 1) * page_size
        documents, total = await self.repo.list_page(offset, page_size)
        return [to_list_item(item) for item in documents], total

    async def get_document(self, document_id: str) -> DocumentPublic:
        await fail_stale_ingesting_documents(self.db)
        document = await self.repo.get(document_id)
        if document is None:
            raise DocumentNotFoundError
        return to_document_public(document)

    async def update_document(self, document_id: str, body: DocumentUpdate) -> DocumentPublic:
        await fail_stale_ingesting_documents(self.db)
        document = await self.repo.get(document_id)
        if document is None:
            raise DocumentNotFoundError
        if document.ingest_status == "ingesting":
            raise IngestConflictError("文档仍在入库中，完成后才能修改标签或 FAQ。")
        if document.ingest_status == "failed":
            raise IngestConflictError(REUPLOAD_MESSAGE)
        if document.ingest_status != "ready":
            raise IngestConflictError(REUPLOAD_MESSAGE)
        object_codes, request_codes = taxonomy_codes()
        if body.object_types is not None:
            _require_codes(body.object_types, object_codes, "对象标签不在体系内")
        if body.request_types is not None:
            _require_codes(body.request_types, request_codes, "诉求标签不在体系内")

        new_faqs: list[Faq] | None = None
        if body.faqs is not None:
            new_faqs = await _build_replaced_faqs(document, body.faqs, self.settings)

        if body.object_types is not None:
            document.object_types_json = list(body.object_types)
            for chunk in document.chunks:
                chunk.object_types_json = list(body.object_types)
        if body.request_types is not None:
            document.request_types_json = list(body.request_types)
            for chunk in document.chunks:
                chunk.request_types_json = list(body.request_types)
        if body.entities is not None:
            entities = [item.model_dump() for item in body.entities]
            document.entities_json = entities
            for chunk in document.chunks:
                chunk.entities_json = [
                    item for item in entities if item["name"] in chunk.content
                ]
        if new_faqs is not None:
            await self.repo.delete_faqs(document.id)
            for faq in new_faqs:
                self.db.add(faq)
        if "visibility" in body.model_fields_set:
            if body.visibility is None:
                document.visibility = DEFAULT_READY_VISIBILITY
            elif body.visibility not in VISIBILITY_VALUES:
                raise IngestValidationError(INVALID_VISIBILITY)
            else:
                document.visibility = body.visibility
        next_from = document.effective_from
        next_to = document.effective_to
        if "effective_from" in body.model_fields_set:
            next_from = _as_utc(body.effective_from)
        if "effective_to" in body.model_fields_set:
            next_to = _as_utc(body.effective_to)
        if next_from is not None and next_to is not None and next_to < next_from:
            raise IngestValidationError(INVALID_EFFECTIVE_RANGE)
        if "effective_from" in body.model_fields_set:
            document.effective_from = next_from
        if "effective_to" in body.model_fields_set:
            document.effective_to = next_to
        document.updated_at = datetime.now(UTC)
        await self.db.flush()
        self.db.expire(document, ["chunks", "faqs", "updated_at"])
        refreshed = await self.repo.get(document_id)
        logger.info("已更新文档标签或 FAQ", document_id=document_id)
        return to_document_public(refreshed or document)


async def fail_stale_ingesting_documents(db: AsyncSession | None = None) -> None:
    settings = ensure_config()
    cutoff = datetime.now(UTC) - timedelta(seconds=settings.ingest_stale_seconds)

    async def _run(session: AsyncSession) -> None:
        repo = DocumentRepository(session)
        changed = await repo.mark_stale(cutoff)
        if changed:
            logger.info("已将过期入库中文档标为失败", count=changed)

    if db is not None:
        await _run(db)
        return
    async with get_session_maker()() as session:
        await _run(session)
        await session.commit()


async def fail_document(document_id: str) -> None:
    settings = ensure_config()
    async with get_session_maker()() as session:
        repo = DocumentRepository(session)
        await repo.mark_failed(document_id)
        await session.commit()
    delete_upload_file(settings, document_id)
    logger.info("文档入库已标为失败", document_id=document_id)


async def run_ingest_job(document_id: str) -> None:
    settings = ensure_config()
    path = find_upload_path(settings, document_id)
    try:
        if path is None or not path.is_file():
            raise FileNotFoundError(document_id)
        upload_path = path
        raw = upload_path.read_bytes()
        markdown = convert_file_to_markdown(upload_path.name, raw)
        if not markdown.strip():
            raise IngestValidationError(REUPLOAD_MESSAGE)
        logger.info(
            "已将上传文件转为 Markdown", document_id=document_id, suffix=upload_path.suffix
        )
        chunk_specs = chunk_markdown(
            markdown, settings.chunk_max_chars, settings.chunk_overlap_chars
        )
        if not chunk_specs:
            raise IngestValidationError(REUPLOAD_MESSAGE)
        if not has_llm_key(settings):
            raise BailianError("未配置模型密钥")
        tagged = await tag_document(settings, markdown)
        object_types = tagged["object_types"]
        if not object_types:
            raise IngestValidationError(REUPLOAD_MESSAGE)
        request_types = tagged["request_types"]
        entities = tagged["entities"]
        faqs_data = tagged["faqs"]
        embed_inputs = [item.content for item in chunk_specs] + [
            item["question"] for item in faqs_data
        ]
        vectors = await embed_texts(settings, embed_inputs)
        chunk_vectors = vectors[: len(chunk_specs)]
        faq_vectors = vectors[len(chunk_specs) :]
        chunks = [
            Chunk(
                id=str(uuid4()),
                document_id=document_id,
                position=item.position,
                heading_path=item.heading_path,
                content=item.content,
                object_types_json=list(object_types),
                request_types_json=list(request_types),
                entities_json=[
                    entity for entity in entities if entity["name"] in item.content
                ],
                embedding=chunk_vectors[index],
            )
            for index, item in enumerate(chunk_specs)
        ]
        faqs = [
            Faq(
                id=str(uuid4()),
                document_id=document_id,
                question=item["question"],
                answer=item["answer"],
                embedding=faq_vectors[index],
            )
            for index, item in enumerate(faqs_data)
        ]
        async with get_session_maker()() as session:
            repo = DocumentRepository(session)
            document = await repo.get(document_id)
            if document is None or document.ingest_status != "ingesting":
                logger.info("跳过入库任务，文档状态已变化", document_id=document_id)
                return
            await repo.save_ready(
                document,
                object_types=object_types,
                request_types=request_types,
                entities=entities,
                chunks=chunks,
                faqs=faqs,
            )
            await session.commit()
        if upload_path.is_file():
            upload_path.unlink()
        logger.info(
            "文档入库成功",
            document_id=document_id,
            chunk_count=len(chunk_specs),
            faq_count=len(faqs),
        )
    except Exception:
        logger.exception("文档入库失败", document_id=document_id)
        await fail_document(document_id)


async def tag_document(settings: AppSettings, text: str) -> dict:
    segments = _split_for_ingest(text, settings.ingest_max_chars)
    merged_objects: list[str] = []
    merged_requests: list[str] = []
    merged_entities: list[dict] = []
    merged_faqs: list[dict] = []
    for segment in segments:
        parsed = await _tag_one_segment(settings, segment)
        merged_objects = _unique_extend(merged_objects, parsed["object_types"])
        merged_requests = _unique_extend(merged_requests, parsed["request_types"])
        merged_entities = _merge_entities(merged_entities, parsed["entities"])
        merged_faqs = _merge_faqs(merged_faqs, parsed["faqs"])
    return {
        "object_types": merged_objects,
        "request_types": merged_requests,
        "entities": merged_entities,
        "faqs": merged_faqs,
    }


async def embed_texts(settings: AppSettings, texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    if not has_llm_key(settings):
        raise BailianError("未配置模型密钥")
    client = BailianClient(settings)
    return await client.embeddings(texts)


async def _tag_one_segment(settings: AppSettings, segment: str) -> dict:
    prompt = _PROMPT_PATH.read_text(encoding="utf-8")
    object_codes, request_codes = taxonomy_codes()
    user_content = (
        "可用 object_types code："
        + ", ".join(sorted(object_codes))
        + "\n可用 request_types code："
        + ", ".join(sorted(request_codes))
        + "\n\n文档：\n"
        + segment
    )
    messages = [
        {"role": "system", "content": prompt},
        {"role": "user", "content": user_content},
    ]
    client = BailianClient(settings)
    raw = await client.chat_completions(messages, json_object=True)
    try:
        parsed = _parse_tag_faq(raw, object_codes, request_codes)
    except ValueError:
        raw = await client.chat_completions(messages, json_object=True)
        parsed = _parse_tag_faq(raw, object_codes, request_codes)
    return parsed


def _parse_tag_faq(raw: str, object_codes: set[str], request_codes: set[str]) -> dict:
    payload = _loads_json_object(raw)
    object_types = _filter_codes(payload.get("object_types"), object_codes)
    request_types = _filter_codes(payload.get("request_types"), request_codes)
    entities = _filter_entities(payload.get("entities"))
    faqs = _filter_faqs(payload.get("faqs"))
    return {
        "object_types": object_types,
        "request_types": request_types,
        "entities": entities,
        "faqs": faqs,
    }


def _loads_json_object(raw: str) -> dict:
    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError("模型返回无法解析") from exc
    if not isinstance(payload, dict):
        raise ValueError("模型返回无法解析")
    return payload


def _filter_codes(values: object, allowed: set[str]) -> list[str]:
    if not isinstance(values, list):
        return []
    result: list[str] = []
    for item in values:
        if isinstance(item, str) and item in allowed and item not in result:
            result.append(item)
    return result


def _filter_entities(values: object) -> list[dict]:
    if not isinstance(values, list):
        return []
    result: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for item in values:
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        entity_type = item.get("type")
        if not isinstance(name, str) or not isinstance(entity_type, str):
            continue
        name = name.strip()
        if not name or entity_type not in _ENTITY_TYPES:
            continue
        key = (name, entity_type)
        if key in seen:
            continue
        seen.add(key)
        result.append({"name": name, "type": entity_type})
    return result


def _filter_faqs(values: object) -> list[dict]:
    if not isinstance(values, list):
        return []
    result: list[dict] = []
    seen: set[str] = set()
    for item in values:
        if not isinstance(item, dict):
            continue
        question = item.get("question")
        answer = item.get("answer")
        if not isinstance(question, str) or not isinstance(answer, str):
            continue
        question = question.strip()
        answer = answer.strip()
        if not question or not answer:
            continue
        if len(question) > 500 or len(answer) > 4000:
            continue
        if question in seen:
            continue
        seen.add(question)
        result.append({"question": question, "answer": answer})
    return result


def _split_for_ingest(text: str, max_chars: int) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    parts: list[str] = []
    current = ""
    for heading_path, body in parse_markdown_sections(text):
        piece = f"{heading_path}\n\n{body}" if heading_path else body
        if not current:
            if len(piece) <= max_chars:
                current = piece
            else:
                parts.extend(_hard_split(piece, max_chars))
            continue
        trial = f"{current}\n\n{piece}"
        if len(trial) <= max_chars:
            current = trial
            continue
        parts.append(current)
        if len(piece) <= max_chars:
            current = piece
        else:
            parts.extend(_hard_split(piece, max_chars))
            current = ""
    if current:
        parts.append(current)
    return parts or [text[:max_chars]]


def _hard_split(text: str, max_chars: int) -> list[str]:
    return [text[index : index + max_chars] for index in range(0, len(text), max_chars)]


def _unique_extend(existing: list[str], extra: list[str]) -> list[str]:
    result = list(existing)
    for item in extra:
        if item not in result:
            result.append(item)
    return result


def _merge_entities(existing: list[dict], extra: list[dict]) -> list[dict]:
    result = list(existing)
    seen = {(item["name"], item["type"]) for item in existing}
    for item in extra:
        key = (item["name"], item["type"])
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def _merge_faqs(existing: list[dict], extra: list[dict]) -> list[dict]:
    result = list(existing)
    seen = {item["question"] for item in existing}
    for item in extra:
        if item["question"] in seen:
            continue
        seen.add(item["question"])
        result.append(item)
    return result


def _require_codes(values: list[str], allowed: set[str], message: str) -> None:
    if any(code not in allowed for code in values):
        raise IngestValidationError(message)
    if len(set(values)) != len(values):
        raise IngestValidationError(message)


async def _build_replaced_faqs(
    document: Document, items: list[FaqItem], settings: AppSettings
) -> list[Faq]:
    old_by_id = {faq.id: faq for faq in document.faqs}
    prepared: list[tuple[str, str, str, list[float] | None]] = []
    to_embed_index: list[int] = []
    to_embed_text: list[str] = []
    for item in items:
        faq_id = item.id if item.id and item.id in old_by_id else str(uuid4())
        embedding = None
        if item.id and item.id in old_by_id and old_by_id[item.id].question == item.question:
            embedding = old_by_id[item.id].embedding
        prepared.append((faq_id, item.question, item.answer, embedding))
        if embedding is None:
            to_embed_index.append(len(prepared) - 1)
            to_embed_text.append(item.question)
    if to_embed_text:
        vectors = await embed_texts(settings, to_embed_text)
        for index, vector in zip(to_embed_index, vectors, strict=True):
            faq_id, question, answer, _ = prepared[index]
            prepared[index] = (faq_id, question, answer, vector)
    return [
        Faq(
            id=faq_id,
            document_id=document.id,
            question=question,
            answer=answer,
            embedding=embedding,
        )
        for faq_id, question, answer, embedding in prepared
    ]
