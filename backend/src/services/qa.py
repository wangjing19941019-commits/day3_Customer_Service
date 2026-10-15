from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from pycore.core import get_logger

from src.db.models import Chunk, Conversation, Faq, Message, Ticket
from src.db.session import AppSettings, ensure_config
from src.integrations.bailian import BailianClient, BailianError
from src.models.message import EmployeeMessageResult
from src.repositories.conversation_repository import ConversationRepository
from src.repositories.ticket_repository import TicketRepository, split_stored
from src.services.handoff import (
    ConversationNotFoundError,
    _conversation_public,
    _message_public,
    _sorted_messages,
)
from src.services.retrieve import (
    AUDIENCE_USER,
    filter_chunks_for_issue,
    load_ready_chunks,
    load_ready_faqs,
    rank_retrieved_chunks,
)
from src.services.retrieve import rank_chunks as rank_chunks
from src.utils.text import cosine_similarity

logger = get_logger()

_SRC_DIR = Path(__file__).resolve().parent.parent
_TAXONOMY_PATH = _SRC_DIR / "resources" / "tag-taxonomy.json"
_REWRITE_PROMPT = _SRC_DIR / "prompts" / "rewrite_classify.md"
_SMALL_TALK_PROMPT = _SRC_DIR / "prompts" / "small_talk.md"
_ANSWER_PROMPT = _SRC_DIR / "prompts" / "answer.md"

_STATUS_HANDED_OFF = "handed_off"
_ROLE_EMPLOYEE = "employee"
_ROLE_SYSTEM = "system"
_KIND_EMPLOYEE = "employee_turn"
_KIND_WAITING = "waiting_for_agent"
_KIND_CLARIFICATION = "clarification"
_KIND_FAQ = "faq"
_KIND_SMALL_TALK = "small_talk"
_KIND_KNOWLEDGE = "knowledge"
_KIND_FALLBACK = "fallback"
_KIND_PROGRESS = "ticket_progress"
_WAITING_CONTENT = "已转交客服，请等待回复。"
_NO_TICKET_PROGRESS = "目前没有可查询的工单进度。"
_CONFIRMED_STATUSES = frozenset({"pending", "in_progress", "on_hold", "completed", "closed"})
_PROGRESS_MARKERS = (
    "退款到哪",
    "退款到哪儿",
    "退货到哪",
    "退货进度",
    "开票进度",
    "工单进度",
    "退款进度",
    "到账了吗",
    "到账了没",
    "退款了吗",
    "开票了吗",
)
_UNAVAILABLE = "服务暂时不可用，请稍后重试。"
_MESSAGE_TYPES = {"service_request", "small_talk"}
_PROCESSING = {
    "ready",
    "needs_clarification",
    "requires_live_data",
    "out_of_scope",
}
_ENTITY_TYPES = {"product", "order", "spec"}

_llm_override: LlmClient | None = None


class LlmClient(Protocol):
    async def chat_completions(
        self, messages: list[dict[str, str]], *, json_object: bool = False
    ) -> str: ...

    async def embeddings(self, inputs: list[str]) -> list[list[float]]: ...


class QaUnavailableError(Exception):
    def __init__(self, message: str = _UNAVAILABLE):
        self.message = message
        super().__init__(message)


def set_llm_override(client: LlmClient | None) -> None:
    global _llm_override
    _llm_override = client


@dataclass
class ClassifiedIssue:
    issue_id: str
    summary: str
    primary_object_type: str | None
    related_object_types: list[str]
    request_type: str | None
    entities: list[dict[str, str]]
    symptom: str | None
    error_message: str | None
    processing_status: str
    retrieval_query: str | None
    missing_information: list[str]
    clarification_question: str | None


@dataclass
class Classification:
    rewritten_query: str | None
    message_type: str
    issues: list[ClassifiedIssue] = field(default_factory=list)


@dataclass
class KnowledgeSegment:
    issue: ClassifiedIssue
    chunks: list[Chunk]


def _load_taxonomy() -> dict:
    return json.loads(_TAXONOMY_PATH.read_text(encoding="utf-8"))


def _taxonomy_codes() -> tuple[set[str], set[str]]:
    taxonomy = _load_taxonomy()
    object_codes = {item["code"] for item in taxonomy.get("object_types", [])}
    request_codes = {item["code"] for item in taxonomy.get("request_types", [])}
    return object_codes, request_codes


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


def _optional_str(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    items: list[str] = []
    for item in value:
        if isinstance(item, str) and item.strip():
            items.append(item.strip())
    return items


def _parse_entities(value: object) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    entities: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        name = _optional_str(item.get("name"))
        type_name = _optional_str(item.get("type"))
        if name is None or type_name not in _ENTITY_TYPES:
            continue
        entities.append({"name": name, "type": type_name})
    return entities


def parse_classification(
    raw: str, object_codes: set[str], request_codes: set[str]
) -> Classification:
    payload = _loads_json_object(raw)
    rewritten = _optional_str(payload.get("rewritten_query"))
    output = payload.get("query_output")
    if not isinstance(output, dict):
        raise ValueError("分类结果缺少 query_output")
    message_type = _optional_str(output.get("message_type"))
    if message_type not in _MESSAGE_TYPES:
        raise ValueError("分类结果 message_type 无效")
    raw_issues = output.get("issues")
    if raw_issues is None:
        raw_issues = []
    if not isinstance(raw_issues, list):
        raise ValueError("分类结果 issues 无效")
    issues: list[ClassifiedIssue] = []
    for index, item in enumerate(raw_issues, start=1):
        if not isinstance(item, dict):
            continue
        status = _optional_str(item.get("processing_status"))
        if status not in _PROCESSING:
            continue
        primary = _optional_str(item.get("primary_object_type"))
        if primary is not None and primary not in object_codes:
            primary = None
        related = [
            code
            for code in _string_list(item.get("related_object_types"))
            if code in object_codes
        ]
        request_type = _optional_str(item.get("request_type"))
        if request_type is not None and request_type not in request_codes:
            request_type = None
        issue_id = _optional_str(item.get("issue_id")) or str(index)
        issues.append(
            ClassifiedIssue(
                issue_id=issue_id,
                summary=_optional_str(item.get("summary")) or "",
                primary_object_type=primary,
                related_object_types=related,
                request_type=request_type,
                entities=_parse_entities(item.get("entities")),
                symptom=_optional_str(item.get("symptom")),
                error_message=_optional_str(item.get("error_message")),
                processing_status=status,
                retrieval_query=_optional_str(item.get("retrieval_query")),
                missing_information=_string_list(item.get("missing_information")),
                clarification_question=_optional_str(item.get("clarification_question")),
            )
        )
    if message_type == "service_request" and not issues:
        raise ValueError("分类结果缺少可处理的 issues")
    return Classification(
        rewritten_query=rewritten, message_type=message_type, issues=issues
    )


def should_clarify(classification: Classification) -> bool:
    if not classification.issues:
        return False
    if all(item.processing_status == "needs_clarification" for item in classification.issues):
        return True
    if (
        classification.message_type != "small_talk"
        and len(classification.issues) == 1
        and classification.issues[0].processing_status == "needs_clarification"
    ):
        return True
    return False


def clarification_text(classification: Classification) -> str:
    for item in classification.issues:
        if item.clarification_question:
            return item.clarification_question
    for item in classification.issues:
        if item.missing_information:
            return item.missing_information[0]
    return ""


def object_tags_for_issue(issue: ClassifiedIssue) -> set[str]:
    tags: set[str] = set(issue.related_object_types)
    if issue.primary_object_type:
        tags.add(issue.primary_object_type)
    return tags


def asks_ticket_progress(content: str) -> bool:
    text = content.strip()
    return any(marker in text for marker in _PROGRESS_MARKERS)


def _latest_progress_text(ticket: Ticket | None) -> str | None:
    if ticket is None or ticket.status not in _CONFIRMED_STATUSES:
        return None
    _stored, meta = split_stored(ticket.fields_json)
    progress = meta.get("progress")
    if not isinstance(progress, list):
        return None
    for item in reversed(progress):
        if not isinstance(item, dict):
            continue
        detail = item.get("detail")
        if isinstance(detail, str) and detail.strip():
            return detail.strip()
    return None


def pick_faq(query_vec: list[float], faqs: list[Faq], threshold: float) -> Faq | None:
    best: Faq | None = None
    best_score = -1.0
    for faq in faqs:
        embedding = faq.embedding
        if not isinstance(embedding, list) or not embedding:
            continue
        score = cosine_similarity(query_vec, embedding)
        if score >= threshold and score > best_score:
            best = faq
            best_score = score
    return best


class QaService:
    def __init__(
        self,
        repo: ConversationRepository,
        settings: AppSettings | None = None,
        llm: LlmClient | None = None,
    ):
        self.repo = repo
        self.settings = settings or ensure_config()
        self.llm = llm if llm is not None else _llm_override or BailianClient(self.settings)

    async def post_message(self, conversation_id: str, content: str) -> EmployeeMessageResult:
        conversation = await self.repo.get_by_id(conversation_id)
        if conversation is None:
            raise ConversationNotFoundError
        if asks_ticket_progress(content):
            return await self._ticket_progress_turn(conversation, conversation_id, content)
        if conversation.status == _STATUS_HANDED_OFF:
            return await self._handed_off_turn(conversation, conversation_id, content)
        return await self._bot_turn(conversation, conversation_id, content)

    async def _ticket_progress_turn(
        self, conversation: Conversation, conversation_id: str, content: str
    ) -> EmployeeMessageResult:
        await self.repo.add_message(
            conversation,
            role=_ROLE_EMPLOYEE,
            kind=_KIND_EMPLOYEE,
            content=content,
            original_content=content,
            rewritten_content=None,
        )
        ticket = await TicketRepository(self.repo.db).get_by_conversation_id(conversation_id)
        text = _latest_progress_text(ticket) or _NO_TICKET_PROGRESS
        reply = await self._add_system(conversation, _KIND_PROGRESS, text)
        logger.info("已按工单进度回答", conversation_id=conversation_id)
        return await self._finish(conversation_id, reply)

    async def _handed_off_turn(
        self, conversation: Conversation, conversation_id: str, content: str
    ) -> EmployeeMessageResult:
        previous = _sorted_messages(conversation)
        last = previous[-1] if previous else None
        await self.repo.add_message(
            conversation,
            role=_ROLE_EMPLOYEE,
            kind=_KIND_EMPLOYEE,
            content=content,
            original_content=content,
            rewritten_content=None,
        )
        if last is not None and last.kind == _KIND_WAITING:
            reply = last
        else:
            reply = await self.repo.add_message(
                conversation,
                role=_ROLE_SYSTEM,
                kind=_KIND_WAITING,
                content=_WAITING_CONTENT,
                original_content=None,
                rewritten_content=None,
            )
        loaded = await self.repo.get_by_id(conversation_id)
        if loaded is None:
            raise ConversationNotFoundError
        logger.info("已转人工会话仅保存员工消息", conversation_id=conversation_id)
        return EmployeeMessageResult(
            conversation=_conversation_public(loaded),
            reply=_message_public(reply),
        )

    async def _bot_turn(
        self, conversation: Conversation, conversation_id: str, content: str
    ) -> EmployeeMessageResult:
        history = _sorted_messages(conversation)
        employee = await self.repo.add_message(
            conversation,
            role=_ROLE_EMPLOYEE,
            kind=_KIND_EMPLOYEE,
            content=content,
            original_content=content,
            rewritten_content=None,
        )
        await self.repo.db.commit()
        try:
            classification = await self._rewrite_classify(history, content)
        except (BailianError, ValueError) as exc:
            logger.warning("改写或分类失败", conversation_id=conversation_id, detail=str(exc))
            raise QaUnavailableError from exc

        rewritten = classification.rewritten_query or content
        if classification.rewritten_query is None:
            logger.warning("改写结果缺失，改用原问继续", conversation_id=conversation_id)
            rewritten = content
            classification.rewritten_query = content
        await self.repo.update_rewritten(employee, rewritten)
        await self.repo.db.commit()

        if should_clarify(classification):
            max_rounds = self.settings.clarification_max_rounds
            if conversation.clarification_round < max_rounds:
                await self.repo.set_clarification_round(
                    conversation, conversation.clarification_round + 1
                )
                reply = await self._add_system(
                    conversation,
                    _KIND_CLARIFICATION,
                    clarification_text(classification),
                )
                return await self._finish(conversation_id, reply)
            await self.repo.set_clarification_round(conversation, 0)
            reply = await self._add_system(
                conversation, _KIND_FALLBACK, self.settings.fallback_reply
            )
            return await self._finish(conversation_id, reply)

        await self.repo.set_clarification_round(conversation, 0)
        try:
            return await self._processable_turn(
                conversation, conversation_id, classification, rewritten
            )
        except BailianError as exc:
            logger.warning("问答生成或嵌入失败", conversation_id=conversation_id, detail=str(exc))
            raise QaUnavailableError from exc

    async def _processable_turn(
        self,
        conversation: Conversation,
        conversation_id: str,
        classification: Classification,
        rewritten: str,
    ) -> EmployeeMessageResult:
        faqs = await load_ready_faqs(self.repo.db, AUDIENCE_USER)
        if faqs:
            query_vecs = await self.llm.embeddings([rewritten])
            hit = pick_faq(query_vecs[0], faqs, self.settings.faq_hit_threshold)
            if hit is not None:
                reply = await self._add_system(conversation, _KIND_FAQ, hit.answer)
                return await self._finish(conversation_id, reply)

        if classification.message_type == "small_talk" and not classification.issues:
            text = await self._small_talk(rewritten)
            reply = await self._add_system(conversation, _KIND_SMALL_TALK, text)
            return await self._finish(conversation_id, reply)

        knowledge_segments: list[KnowledgeSegment] = []
        ready_issues = [
            item for item in classification.issues if item.processing_status == "ready"
        ]
        chunks = await load_ready_chunks(self.repo.db, AUDIENCE_USER) if ready_issues else []
        query_texts = [item.retrieval_query or rewritten for item in ready_issues]
        query_vecs = await self.llm.embeddings(query_texts) if query_texts else []

        ready_index = 0
        for issue in classification.issues:
            if issue.processing_status != "ready":
                continue
            query_vec = query_vecs[ready_index]
            query_text = query_texts[ready_index]
            ready_index += 1
            filtered = filter_chunks_for_issue(chunks, issue)
            ranked = rank_retrieved_chunks(
                query_vec,
                query_text,
                filtered,
                self.settings.retrieve_top_k,
                self.settings.retrieve_min_score,
                self.settings,
            )
            if ranked:
                knowledge_segments.append(KnowledgeSegment(issue=issue, chunks=ranked))

        if knowledge_segments:
            text = await self._answer_knowledge(rewritten, knowledge_segments)
            if not text.strip():
                reply = await self._add_system(
                    conversation, _KIND_FALLBACK, self.settings.fallback_reply
                )
                return await self._finish(conversation_id, reply)
            reply = await self._add_system(conversation, _KIND_KNOWLEDGE, text)
            return await self._finish(conversation_id, reply)

        reply = await self._add_system(
            conversation, _KIND_FALLBACK, self.settings.fallback_reply
        )
        return await self._finish(conversation_id, reply)

    async def _add_system(
        self, conversation: Conversation, kind: str, content: str
    ) -> Message:
        return await self.repo.add_message(
            conversation,
            role=_ROLE_SYSTEM,
            kind=kind,
            content=content,
            original_content=None,
            rewritten_content=None,
        )

    async def _finish(self, conversation_id: str, reply: Message) -> EmployeeMessageResult:
        loaded = await self.repo.get_by_id(conversation_id)
        if loaded is None:
            raise ConversationNotFoundError
        return EmployeeMessageResult(
            conversation=_conversation_public(loaded),
            reply=_message_public(reply),
        )

    async def _rewrite_classify(
        self, history: list[Message], original: str
    ) -> Classification:
        object_codes, request_codes = _taxonomy_codes()
        prompt = _REWRITE_PROMPT.read_text(encoding="utf-8")
        limit = self.settings.context_message_limit
        recent = history[-limit:] if limit > 0 else []
        lines = [f"{item.role}: {item.content}" for item in recent]
        user_content = (
            "可用 object_types code："
            + ", ".join(sorted(object_codes))
            + "\n可用 request_types code："
            + ", ".join(sorted(request_codes))
            + "\n\n当前会话最近消息：\n"
            + ("\n".join(lines) if lines else "（无）")
            + "\n\n本轮原问：\n"
            + original
        )
        messages = [
            {"role": "system", "content": prompt},
            {"role": "user", "content": user_content},
        ]
        raw = await self.llm.chat_completions(messages, json_object=True)
        try:
            return parse_classification(raw, object_codes, request_codes)
        except ValueError:
            raw = await self.llm.chat_completions(messages, json_object=True)
            return parse_classification(raw, object_codes, request_codes)

    async def _small_talk(self, rewritten: str) -> str:
        prompt = _SMALL_TALK_PROMPT.read_text(encoding="utf-8")
        messages = [
            {"role": "system", "content": prompt},
            {"role": "user", "content": rewritten},
        ]
        return await self.llm.chat_completions(messages, json_object=False)

    async def _answer_knowledge(
        self, rewritten: str, segments: list[KnowledgeSegment]
    ) -> str:
        prompt = _ANSWER_PROMPT.read_text(encoding="utf-8")
        parts: list[str] = [f"员工问法：{rewritten}"]
        for segment in segments:
            issue = segment.issue
            tags = ",".join(sorted(object_tags_for_issue(issue))) or "无"
            request = issue.request_type or "无"
            parts.append(
                f"\nissue {issue.issue_id}：{issue.summary or issue.retrieval_query or ''}"
                f"\n对象标签：{tags}；诉求：{request}"
                f"\n检索问法：{issue.retrieval_query or rewritten}"
            )
            for chunk in segment.chunks:
                parts.append(
                    f"- document_id={chunk.document_id} chunk_id={chunk.id} "
                    f"position={chunk.position}\n{chunk.content}"
                )
        messages = [
            {"role": "system", "content": prompt},
            {"role": "user", "content": "\n".join(parts)},
        ]
        return await self.llm.chat_completions(messages, json_object=False)
