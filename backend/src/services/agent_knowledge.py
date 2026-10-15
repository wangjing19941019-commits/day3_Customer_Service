from __future__ import annotations

from datetime import datetime
from typing import Protocol

from pycore.core.logger import get_logger
from pydantic import BaseModel

from src.db.models import Chunk, Conversation, Message, Ticket
from src.db.session import AppSettings, ensure_config
from src.integrations.bailian import BailianClient, BailianError
from src.models.ticket import BusinessLine, TicketType
from src.repositories.conversation_repository import ConversationRepository
from src.repositories.ticket_repository import TicketRepository
from src.services.handoff import ConversationNotFoundError, _sorted_messages
from src.services.ingest import has_llm_key
from src.services.retrieve import (
    AUDIENCE_AGENT,
    filename_matches_query,
    keyword_overlap_rate,
    load_ready_chunks,
    rank_retrieved_chunks,
    resolved_visibility,
)

logger = get_logger()

_STATUS_HANDED_OFF = "handed_off"
_UNAVAILABLE = "服务暂时不可用，请稍后重试。"
_NOT_HANDED_OFF = "会话尚未转人工，无法查看知识推送"
_EMPTY_MESSAGE = "当前没有可推送的政策或流程"
_OBJECT_3C = "product_3c"
_OBJECT_FASHION = "product_fashion"
_TYPE_OBJECT_MAP = {
    "return_exchange": "return_exchange",
    "address_change": "address_change",
    "invoice": "invoice",
    "complaint": "complaint",
    "fee_dispute": "complaint",
    "logistics_exception": "order_logistics",
}
_TICKET_TYPE_VALUES: dict[str, TicketType] = {
    "return_exchange": "return_exchange",
    "address_change": "address_change",
    "invoice": "invoice",
    "complaint": "complaint",
    "fee_dispute": "fee_dispute",
    "logistics_exception": "logistics_exception",
}
_BUSINESS_LINE_VALUES: dict[str, BusinessLine] = {
    "digital_3c": "digital_3c",
    "apparel_beauty": "apparel_beauty",
}
_LINE_QUERY = {
    "digital_3c": "3C 数码",
    "apparel_beauty": "服饰美妆",
}
_LINE_OBJECT = {
    "digital_3c": _OBJECT_3C,
    "apparel_beauty": _OBJECT_FASHION,
}
_CATEGORY_LABEL = {
    _OBJECT_3C: "3C数码",
    _OBJECT_FASHION: "服饰美妆",
}
_TYPE_LABELS = {
    "return_exchange": "退换货",
    "address_change": "修改地址",
    "invoice": "发票",
    "complaint": "投诉维权",
    "fee_dispute": "费用争议",
    "logistics_exception": "物流异常",
}
_UNLOCKED_OBJECTS = frozenset(
    {
        "product_3c",
        "product_fashion",
        "order_logistics",
        "return_exchange",
        "address_change",
        "invoice",
        "complaint",
    }
)
_SUMMARY_SEPARATORS = ("。", "！", "？", ".", "!", "?")
_VERIFIED_LOSS_MARKERS = ("已核实丢件", "已核实责任方")

_llm_override: KnowledgeLlmClient | None = None


class KnowledgeLlmClient(Protocol):
    async def embeddings(self, inputs: list[str]) -> list[list[float]]: ...


class KnowledgeConflictError(Exception):
    def __init__(self, message: str = _NOT_HANDED_OFF):
        self.message = message
        super().__init__(message)


class KnowledgeUnavailableError(Exception):
    def __init__(self, message: str = _UNAVAILABLE):
        self.message = message
        super().__init__(message)


class KnowledgeSuggestionItem(BaseModel):
    document_id: str
    filename: str
    heading_path: str
    main_answer: str
    summary: str
    source: str
    effective_from: datetime | None
    effective_to: datetime | None
    applicable_category: str | None
    visibility: str


class KnowledgeSuggestionPublic(BaseModel):
    conversation_id: str
    ticket_type: TicketType | None
    business_line: BusinessLine | None
    business_line_locked: bool
    suggestions: list[KnowledgeSuggestionItem]
    empty_message: str | None


def set_knowledge_llm_override(client: KnowledgeLlmClient | None) -> None:
    global _llm_override
    _llm_override = client


def _message_text(message: Message) -> str:
    if message.role == "employee":
        text = message.original_content or message.content
    else:
        text = message.content
    return text or ""


def _field_value(ticket: Ticket | None, key: str) -> str | None:
    if ticket is None or not isinstance(ticket.fields_json, dict):
        return None
    item = ticket.fields_json.get(key)
    if isinstance(item, dict):
        value = item.get("value")
        if isinstance(value, str) and value.strip():
            return value.strip()
        return None
    if isinstance(item, str) and item.strip():
        return item.strip()
    return None


def _build_query(
    conversation: Conversation,
    ticket: Ticket | None,
    *,
    limit: int,
    locked_line: str | None,
    search_q: str | None,
) -> str:
    if search_q:
        return search_q
    parts: list[str] = []
    for message in _sorted_messages(conversation)[-limit:]:
        text = _message_text(message).strip()
        if text:
            parts.append(text)
    summary = _field_value(ticket, "intent_summary")
    if summary:
        parts.append(summary)
    ticket_type = ticket.ticket_type if ticket is not None else None
    type_label = _TYPE_LABELS.get(ticket_type or "")
    if type_label:
        parts.append(type_label)
    if locked_line in _LINE_QUERY:
        parts.append(_LINE_QUERY[locked_line])
    return "\n".join(parts).strip()


def _object_tags(ticket_type: str | None, business_line: str | None) -> set[str]:
    tags: set[str] = set()
    mapped = _TYPE_OBJECT_MAP.get(ticket_type or "")
    if mapped:
        tags.add(mapped)
    line_object = _LINE_OBJECT.get(business_line or "")
    if line_object:
        tags.add(line_object)
    if tags:
        return tags
    return set(_UNLOCKED_OBJECTS)


def _chunk_objects(chunk: Chunk) -> set[str]:
    return set(chunk.object_types_json or [])


def _is_cross_category_chunk(chunk: Chunk, primary: str | None) -> bool:
    objects = _chunk_objects(chunk)
    if primary == _OBJECT_3C and _OBJECT_FASHION in objects and _OBJECT_3C not in objects:
        return True
    if primary == _OBJECT_FASHION and _OBJECT_3C in objects and _OBJECT_FASHION not in objects:
        return True
    return False


def _filter_by_object_tags(
    chunks: list[Chunk], tags: set[str], locked_line: str | None
) -> list[Chunk]:
    primary = _LINE_OBJECT.get(locked_line or "")
    matched = [
        chunk
        for chunk in chunks
        if tags.intersection(_chunk_objects(chunk))
        and not _is_cross_category_chunk(chunk, primary)
    ]
    return matched


def _opposite_line_chunk(chunk: Chunk, locked_line: str | None) -> bool:
    objects = _chunk_objects(chunk)
    haystack = f"{chunk.heading_path}\n{chunk.content}"
    if locked_line == "digital_3c":
        return "七天无理由" in haystack and _OBJECT_3C not in objects
    if locked_line == "apparel_beauty":
        return (
            "质保年限" in haystack or "只换不修" in haystack
        ) and _OBJECT_FASHION not in objects
    return False


def _post_filter(
    chunks: list[Chunk], locked_line: str | None, ticket_type: str | None
) -> list[Chunk]:
    filtered = chunks
    if locked_line in {"digital_3c", "apparel_beauty"}:
        filtered = [chunk for chunk in filtered if not _opposite_line_chunk(chunk, locked_line)]
    if ticket_type == "logistics_exception":
        filtered = [
            chunk
            for chunk in filtered
            if not any(marker in chunk.content for marker in _VERIFIED_LOSS_MARKERS)
        ]
    return filtered


def _summarize(content: str) -> str:
    text = " ".join((content or "").split())
    if not text:
        return ""
    earliest: int | None = None
    for separator in _SUMMARY_SEPARATORS:
        index = text.find(separator)
        if index >= 0 and (earliest is None or index < earliest):
            earliest = index
    if earliest is None:
        return text
    return text[: earliest + 1]


def _source(filename: str, heading_path: str) -> str:
    name = filename or ""
    heading = heading_path or ""
    if name and heading:
        return f"{name} / {heading}"
    return name or heading


def _applicable_category(chunk: Chunk) -> str | None:
    objects = _chunk_objects(chunk)
    if _OBJECT_3C in objects and _OBJECT_FASHION not in objects:
        return _CATEGORY_LABEL[_OBJECT_3C]
    if _OBJECT_FASHION in objects and _OBJECT_3C not in objects:
        return _CATEGORY_LABEL[_OBJECT_FASHION]
    return None


def _merge_search_hits(
    search_q: str,
    tagged: list[Chunk],
    ranked: list[Chunk],
    top_k: int,
) -> list[Chunk]:
    ranked_ids = {chunk.id for chunk in ranked}
    name_hits: list[Chunk] = []
    keyword_hits: list[tuple[float, Chunk]] = []
    for chunk in tagged:
        if chunk.id in ranked_ids:
            continue
        filename = chunk.document.filename if chunk.document is not None else ""
        if filename_matches_query(search_q, filename):
            name_hits.append(chunk)
            continue
        keyword = keyword_overlap_rate(
            search_q, chunk.heading_path, chunk.content, filename
        )
        if keyword >= 0.8:
            keyword_hits.append((keyword, chunk))
    keyword_hits.sort(key=lambda item: -item[0])
    merged = name_hits + ranked + [chunk for _, chunk in keyword_hits]
    seen: set[str] = set()
    unique: list[Chunk] = []
    for chunk in merged:
        if chunk.id in seen:
            continue
        seen.add(chunk.id)
        unique.append(chunk)
        if len(unique) >= top_k:
            break
    return unique


def _item_from_chunk(chunk: Chunk) -> KnowledgeSuggestionItem:
    document = chunk.document
    filename = document.filename if document is not None else ""
    visibility = resolved_visibility(document) if document is not None else "user_visible"
    return KnowledgeSuggestionItem(
        document_id=chunk.document_id,
        filename=filename,
        heading_path=chunk.heading_path,
        main_answer=chunk.content,
        summary=_summarize(chunk.content),
        source=_source(filename, chunk.heading_path),
        effective_from=document.effective_from if document is not None else None,
        effective_to=document.effective_to if document is not None else None,
        applicable_category=_applicable_category(chunk),
        visibility=visibility or "user_visible",
    )


def _empty_result(
    conversation_id: str,
    ticket_type: TicketType | None,
    business_line: BusinessLine | None,
    locked: bool,
) -> KnowledgeSuggestionPublic:
    return KnowledgeSuggestionPublic(
        conversation_id=conversation_id,
        ticket_type=ticket_type,
        business_line=business_line,
        business_line_locked=locked,
        suggestions=[],
        empty_message=_EMPTY_MESSAGE,
    )


class AgentKnowledgeService:
    def __init__(
        self,
        repo: ConversationRepository,
        settings: AppSettings | None = None,
        llm: KnowledgeLlmClient | None = None,
    ):
        self.repo = repo
        self.tickets = TicketRepository(repo.db)
        self.settings = settings or ensure_config()
        self.llm = llm if llm is not None else _llm_override or BailianClient(self.settings)

    async def suggest(
        self, conversation_id: str, q: str | None = None
    ) -> KnowledgeSuggestionPublic:
        conversation = await self.repo.get_by_id(conversation_id)
        if conversation is None:
            raise ConversationNotFoundError
        if conversation.status != _STATUS_HANDED_OFF:
            raise KnowledgeConflictError(_NOT_HANDED_OFF)

        ticket = await self.tickets.get_by_conversation_id(conversation_id)
        ticket_type = ticket.ticket_type if ticket is not None else None
        business_line = ticket.business_line if ticket is not None else None
        locked = business_line in _BUSINESS_LINE_VALUES
        public_type = _TICKET_TYPE_VALUES.get(ticket_type or "")
        public_line = _BUSINESS_LINE_VALUES.get(business_line or "") if locked else None
        search_q = q.strip() if isinstance(q, str) and q.strip() else None

        chunks = await load_ready_chunks(self.repo.db, AUDIENCE_AGENT)
        tagged = _filter_by_object_tags(
            chunks, _object_tags(ticket_type, business_line), business_line if locked else None
        )
        query = _build_query(
            conversation,
            ticket,
            limit=self.settings.context_message_limit,
            locked_line=business_line if locked else None,
            search_q=search_q,
        )
        if not tagged or not query:
            return _empty_result(conversation_id, public_type, public_line, locked)

        if _llm_override is None and not has_llm_key(self.settings):
            raise KnowledgeUnavailableError(_UNAVAILABLE)
        try:
            vectors = await self.llm.embeddings([query])
        except BailianError as exc:
            logger.warning("坐席知识推送嵌入失败", conversation_id=conversation_id, detail=str(exc))
            raise KnowledgeUnavailableError(_UNAVAILABLE) from exc
        if not vectors:
            raise KnowledgeUnavailableError(_UNAVAILABLE)

        ranked = rank_retrieved_chunks(
            vectors[0],
            query,
            tagged,
            self.settings.agent_knowledge_top_k,
            self.settings.retrieve_min_score,
            self.settings,
        )
        if search_q:
            ranked = _merge_search_hits(
                search_q, tagged, ranked, self.settings.agent_knowledge_top_k
            )
        filtered = _post_filter(ranked, business_line if locked else None, ticket_type)
        if not filtered:
            return _empty_result(conversation_id, public_type, public_line, locked)

        suggestions = [_item_from_chunk(chunk) for chunk in filtered]
        logger.info(
            "坐席知识推送已召回",
            conversation_id=conversation_id,
            count=len(suggestions),
        )
        return KnowledgeSuggestionPublic(
            conversation_id=conversation_id,
            ticket_type=public_type,
            business_line=public_line,
            business_line_locked=locked,
            suggestions=suggestions,
            empty_message=None,
        )
