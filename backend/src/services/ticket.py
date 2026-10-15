from __future__ import annotations

import asyncio
import json
import re
import unicodedata
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Protocol

from pycore.core import get_logger
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from src.db.models import Conversation, Message, Ticket
from src.db.session import AppSettings, ensure_config, get_session_maker
from src.integrations.adapters.logistics import (
    LogisticsAdapterError,
    failed_snapshot,
    get_logistics_adapter,
)
from src.integrations.adapters.order import OrderAdapterError, get_order_adapter
from src.integrations.bailian import BailianClient, BailianError
from src.models.ticket import (
    LogisticsSnapshotPublic,
    OrderMatchPublic,
    OrderOrValueCandidate,
    TicketField,
    TicketPublic,
    TicketUpdate,
)
from src.repositories.conversation_repository import ConversationRepository
from src.repositories.ticket_repository import (
    EXTRACT_FAILED_MESSAGE,
    OPTIONAL_FIELD_KEYS,
    QUERY_NOT_FOUND_MESSAGE,
    TYPE_FIELD_KEYS,
    TicketRepository,
    blank_field,
    join_stored,
    split_stored,
)
from src.services.handoff import ConversationNotFoundError, _sorted_messages
from src.services.ingest import has_llm_key

logger = get_logger()

_SRC_DIR = Path(__file__).resolve().parent.parent
_PROMPT_DIR = _SRC_DIR / "prompts" / "ticket"
_STATUS_HANDED_OFF = "handed_off"
_STATUS_DRAFT = "draft"
_CONFIRMED_STATUSES = frozenset(
    {"pending", "in_progress", "on_hold", "completed", "closed"}
)
_TICKET_TYPES = frozenset(key for key in TYPE_FIELD_KEYS if key is not None)
_BUSINESS_LINES = frozenset({"digital_3c", "apparel_beauty"})
_GROUNDED_KEYS = frozenset(
    {
        "amount",
        "tax_id",
        "phone",
        "original_address",
        "new_address",
        "claimed_amount",
        "platform_amount",
        "order_no",
        "tracking_no",
    }
)
_EXTRACT_SKIP_KEYS = frozenset({"responsible_party", "compensation_plan"})
_AMOUNT_KEYS = frozenset({"amount"})
_AMOUNT_UNIT_RE = re.compile(r"^(?:¥|￥|RMB|rmb)|(?:元|块钱|块|RMB|rmb)$")
_ENUM_VALUES = {
    "return_method": frozenset({"return_only", "exchange", "refund_only"}),
    "invoice_kind": frozenset({"plain", "vat_special"}),
    "need_escalate": frozenset({"true", "false"}),
    "dispute_type": frozenset({"price_protect", "shipping_fee", "refund_amount"}),
    "exception_type": frozenset(
        {"delay", "lost", "damaged", "wrong_or_missing", "refused", "address_exception"}
    ),
    "responsible_party": frozenset({"courier", "warehouse", "platform"}),
}
_TYPE_PROMPTS = {
    "return_exchange": "extract_return_exchange.md",
    "address_change": "extract_address_change.md",
    "invoice": "extract_invoice.md",
    "complaint": "extract_complaint.md",
    "fee_dispute": "extract_fee_dispute.md",
    "logistics_exception": "extract_logistics_exception.md",
}
_LINE_PROMPTS = {
    "digital_3c": "line_digital_3c.md",
    "apparel_beauty": "line_apparel_beauty.md",
}
_NOT_HANDED_OFF = "会话尚未转人工，不能填单"
_NEED_TYPE = "请先选择售后工单类型"
_NEED_LINE = "请先选择业务线"
_NEED_TAX = "专用发票需要纳税人识别号"
_NEED_EVIDENCE = "费用争议需要证据截图"
_TYPE_LOCKED = "工单已确认，不能更改工单类型"
_LOGISTICS_LOCKED = "物流轨迹暂未核实，不能填写责任方或补偿方案"
_SIGNED_STATUSES = frozenset({"signed", "已签收", "签收"})
_LOGISTICS_NOT_FOUND_NOTE = "物流轨迹暂时查不到，暂不能判断责任方和补偿方案。"
_LOST_BUT_SIGNED_NOTE = "用户称快递丢失；物流轨迹显示已签收。丢件尚未核实，不能据此判断责任方。"
_SIGNED_NOTE = "物流轨迹显示已签收。"
_INVALID = "工单字段无效"
_ROLE_EMPLOYEE = "employee"

_extract_llm_override: ExtractLlmClient | None = None
_extract_locks: dict[str, asyncio.Lock] = {}


class ExtractLlmClient(Protocol):
    async def chat_completions(
        self, messages: list[dict[str, str]], *, json_object: bool = False
    ) -> str: ...


class TicketConflictError(Exception):
    def __init__(self, message: str, confirm_blockers: list[str] | None = None):
        self.message = message
        self.confirm_blockers = confirm_blockers or []
        super().__init__(message)


class TicketValidationError(Exception):
    def __init__(self, message: str = _INVALID):
        self.message = message
        super().__init__(message)


def set_extract_llm_override(client: ExtractLlmClient | None) -> None:
    global _extract_llm_override
    _extract_llm_override = client


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _allowed_keys(ticket_type: str | None) -> tuple[str, ...]:
    return TYPE_FIELD_KEYS.get(ticket_type, TYPE_FIELD_KEYS[None])


def _normalize_field_item(item: object) -> dict:
    if not isinstance(item, dict):
        return blank_field()
    value = item.get("value")
    if value is not None and not isinstance(value, str):
        value = str(value)
    if isinstance(value, str) and not value.strip():
        value = None
    status = item.get("status")
    if status not in {"filled", "candidate", "missing", "conflict", "agent_edited"}:
        if status == "extracted":
            status = "filled"
        elif status == "incomplete":
            status = "missing"
        else:
            status = "missing"
    raw_candidates = item.get("candidates") or []
    candidates: list[dict] = []
    if isinstance(raw_candidates, list):
        for entry in raw_candidates:
            if isinstance(entry, dict):
                candidates.append(dict(entry))
            elif isinstance(entry, str) and entry.strip():
                candidates.append({"value": entry.strip()})
    conflict_value = item.get("conflict_value")
    if conflict_value is not None and not isinstance(conflict_value, str):
        conflict_value = str(conflict_value)
    if value is None and not candidates:
        status = "missing"
        conflict_value = None
    return {
        "value": value,
        "status": status,
        "candidates": candidates,
        "conflict_value": conflict_value,
    }


def _attachments(meta: dict) -> list[dict[str, Any]]:
    raw = meta.get("attachments")
    if not isinstance(raw, list):
        return []
    return [item for item in raw if isinstance(item, dict)]


def _required_keys(ticket: Ticket, stored: dict) -> tuple[str, ...]:
    keys = [key for key in _allowed_keys(ticket.ticket_type) if key not in OPTIONAL_FIELD_KEYS]
    kind = _field_value(stored.get("invoice_kind"))
    if ticket.ticket_type == "invoice" and kind != "vat_special":
        keys = [key for key in keys if key != "tax_id"]
    return tuple(keys)


def _confirm_blockers(ticket: Ticket) -> list[str]:
    stored, meta = split_stored(ticket.fields_json)
    blockers: list[str] = []
    if ticket.ticket_type not in _TICKET_TYPES:
        blockers.append("ticket_type")
    if ticket.business_line not in _BUSINESS_LINES:
        blockers.append("business_line")
    if ticket.status != _STATUS_DRAFT:
        return blockers
    for key in _required_keys(ticket, stored):
        item = _normalize_field_item(stored.get(key))
        if item["status"] in {"missing", "candidate", "conflict"}:
            blockers.append(key)
        elif item["status"] not in {"filled", "agent_edited"}:
            blockers.append(key)
    if ticket.ticket_type == "fee_dispute" and not _attachments(meta):
        blockers.append("attachments")
    return blockers


def _can_confirm(ticket: Ticket) -> bool:
    if ticket.status != _STATUS_DRAFT:
        return False
    return not _confirm_blockers(ticket)


def _field_value(item: object) -> str | None:
    normalized = _normalize_field_item(item)
    value = normalized["value"]
    if not isinstance(value, str) or not value.strip():
        return None
    return value


def _to_candidates(raw: object) -> list[OrderOrValueCandidate]:
    if not isinstance(raw, list):
        return []
    items: list[OrderOrValueCandidate] = []
    for entry in raw:
        if isinstance(entry, dict):
            items.append(OrderOrValueCandidate.model_validate(entry))
        elif isinstance(entry, str) and entry.strip():
            items.append(OrderOrValueCandidate(value=entry.strip()))
    return items


def _order_match_public(meta: dict) -> OrderMatchPublic | None:
    raw = meta.get("order_match")
    if not isinstance(raw, dict):
        return None
    status = raw.get("status")
    if status not in {"auto_filled", "candidates", "missing", "query_failed"}:
        return None
    keywords = raw.get("keywords") or []
    if not isinstance(keywords, list):
        keywords = []
    return OrderMatchPublic(
        status=status,
        query_message=(
            raw.get("query_message") if isinstance(raw.get("query_message"), str) else None
        ),
        time_range_text=(
            raw.get("time_range_text") if isinstance(raw.get("time_range_text"), str) else None
        ),
        keywords=[str(item) for item in keywords if item is not None and str(item).strip()],
        candidates=_to_candidates(raw.get("candidates")),
    )


def _user_claims_lost(stored: dict) -> bool:
    if _field_value(stored.get("exception_type")) == "lost":
        return True
    for key in ("intent_summary", "user_request"):
        value = _field_value(stored.get(key))
        if value and "丢" in value:
            return True
    return False


def _logistics_note(
    query_status: str, sign_status: str | None, stored: dict, ticket_type: str | None
) -> str | None:
    if ticket_type != "logistics_exception":
        return None
    if query_status != "ok":
        return _LOGISTICS_NOT_FOUND_NOTE
    if sign_status is None or sign_status.strip() not in _SIGNED_STATUSES:
        return None
    if _user_claims_lost(stored):
        return _LOST_BUT_SIGNED_NOTE
    return _SIGNED_NOTE


def _logistics_public(
    meta: dict, stored: dict, ticket_type: str | None
) -> LogisticsSnapshotPublic | None:
    raw = meta.get("logistics_snapshot")
    if not isinstance(raw, dict):
        return None
    query_status = raw.get("query_status")
    if query_status not in {"ok", "empty", "failed"}:
        query_status = "failed"
    events = raw.get("events")
    if not isinstance(events, list):
        events = []
    sign_status = raw.get("sign_status")
    if sign_status is not None and not isinstance(sign_status, str):
        sign_status = str(sign_status)
    return LogisticsSnapshotPublic(
        events=[item for item in events if isinstance(item, dict)],
        sign_status=sign_status,
        query_status=query_status,
        note=_logistics_note(query_status, sign_status, stored, ticket_type),
    )


def to_ticket_public(ticket: Ticket) -> TicketPublic:
    stored, meta = split_stored(ticket.fields_json)
    visible: dict[str, TicketField] = {}
    for key in _allowed_keys(ticket.ticket_type):
        item = _normalize_field_item(stored.get(key))
        visible[key] = TicketField(
            value=item["value"],
            status=item["status"],  # type: ignore[arg-type]
            candidates=_to_candidates(item["candidates"]),
            conflict_value=item["conflict_value"],
        )
    assigned_user_id = meta.get("assigned_user_id")
    if assigned_user_id is not None and not isinstance(assigned_user_id, int):
        try:
            assigned_user_id = int(assigned_user_id)
        except (TypeError, ValueError):
            assigned_user_id = None
    sla = meta.get("sla")
    if sla is not None and not isinstance(sla, dict):
        sla = None
    progress = meta.get("progress")
    if not isinstance(progress, list):
        progress = []
    return TicketPublic(
        id=ticket.id,
        ticket_no=meta.get("ticket_no") if isinstance(meta.get("ticket_no"), str) else None,
        conversation_id=ticket.conversation_id,
        status=ticket.status,  # type: ignore[arg-type]
        ticket_type=ticket.ticket_type,  # type: ignore[arg-type]
        business_line=ticket.business_line,  # type: ignore[arg-type]
        urgency=meta.get("urgency") if isinstance(meta.get("urgency"), str) else None,
        queue=meta.get("queue") if isinstance(meta.get("queue"), str) else None,
        assigned_role=(
            meta.get("assigned_role") if isinstance(meta.get("assigned_role"), str) else None
        ),
        assigned_user_id=assigned_user_id,
        assigned_display=(
            meta.get("assigned_display")
            if isinstance(meta.get("assigned_display"), str)
            else None
        ),
        upgrade_undelivered=bool(meta.get("upgrade_undelivered")),
        hold_reason=(
            meta.get("hold_reason")
            if meta.get("hold_reason") in {"wait_user", "wait_warehouse"}
            else None
        ),
        order_no=_field_value(stored.get("order_no")),
        user_name=meta.get("user_name") if isinstance(meta.get("user_name"), str) else None,
        extract_status=ticket.extract_status,  # type: ignore[arg-type]
        extract_error=ticket.extract_error,
        can_confirm=_can_confirm(ticket),
        confirm_blockers=_confirm_blockers(ticket),
        fields=visible,
        order_match=_order_match_public(meta),
        logistics_snapshot=_logistics_public(meta, stored, ticket.ticket_type),
        attachments=_attachments(meta),
        progress=[item for item in progress if isinstance(item, dict)],
        sla=sla,
        confirmed_at=_as_utc(ticket.confirmed_at) if ticket.confirmed_at else None,
        created_at=_as_utc(ticket.created_at),
        updated_at=_as_utc(ticket.updated_at),
    )


def _has_new_employee_messages(ticket: Ticket, conversation: Conversation) -> bool:
    employee_messages = [
        item for item in _sorted_messages(conversation) if item.role == _ROLE_EMPLOYEE
    ]
    if not employee_messages:
        return False
    return employee_messages[-1].id != ticket.last_extracted_message_id


def _message_text(message: Message) -> str:
    if message.role == "employee":
        text = message.original_content or message.content
    else:
        text = message.content
    return text or ""


def _conversation_corpus(conversation: Conversation, limit: int) -> str:
    messages = _sorted_messages(conversation)[-limit:]
    return "\n".join(_message_text(item) for item in messages)


def _conversation_prompt(conversation: Conversation, limit: int) -> str:
    lines: list[str] = []
    for message in _sorted_messages(conversation)[-limit:]:
        lines.append(f"{message.role}: {_message_text(message)}")
    return "\n".join(lines) if lines else "（当前会话没有消息）"


def _coerce_extract_value(raw: object) -> str | None:
    if raw is None:
        return None
    if isinstance(raw, dict) and "value" in raw:
        return _coerce_extract_value(raw.get("value"))
    if isinstance(raw, bool):
        return "true" if raw else "false"
    if isinstance(raw, int | float):
        if isinstance(raw, float) and raw.is_integer():
            return str(int(raw))
        return str(raw)
    if isinstance(raw, str):
        stripped = raw.strip()
        return stripped or None
    return None


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


def _validate_enum_value(key: str, value: str | None) -> str | None:
    allowed = _ENUM_VALUES.get(key)
    if allowed is None:
        return value
    if value is None or value not in allowed:
        return None
    return value


def _apply_grounding(key: str, value: str | None, corpus: str) -> str | None:
    if value is None:
        return None
    if key in _GROUNDED_KEYS and value not in corpus:
        return None
    return value


def _high_confidence_min(settings: AppSettings) -> float | None:
    value = getattr(settings, "extract_high_confidence_min", None)
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_confidence(raw: object, settings: AppSettings) -> str:
    if isinstance(raw, dict):
        confidence = raw.get("confidence")
        if confidence in {"high", "low"}:
            return confidence
        score = raw.get("score")
        minimum = _high_confidence_min(settings)
        if minimum is not None and isinstance(score, int | float):
            return "high" if float(score) >= minimum else "low"
    return "high"


def _comparable_value(key: str | None, value: str | None) -> str | None:
    if value is None:
        return None
    text = "".join(unicodedata.normalize("NFKC", value).split())
    if key in _AMOUNT_KEYS:
        text = _AMOUNT_UNIT_RE.sub("", text)
        try:
            return str(Decimal(text).normalize())
        except InvalidOperation:
            return text
    return text


def _same_value(key: str | None, left: str | None, right: str | None) -> bool:
    return _comparable_value(key, left) == _comparable_value(key, right)


def _merge_slot(
    current: dict, new_value: str | None, confidence: str, key: str | None = None
) -> dict:
    current = _normalize_field_item(current)
    if current["status"] == "agent_edited":
        if new_value and not _same_value(key, new_value, current["value"]):
            return {
                "value": current["value"],
                "status": "conflict",
                "candidates": current["candidates"],
                "conflict_value": new_value,
            }
        return current
    if not new_value:
        return current
    if confidence == "low":
        candidates = list(current["candidates"])
        if not any(_same_value(key, entry.get("value"), new_value) for entry in candidates):
            candidates.append({"value": new_value})
        if current["status"] in {"filled", "agent_edited"} and current["value"]:
            return {
                "value": current["value"],
                "status": current["status"],
                "candidates": candidates,
                "conflict_value": current["conflict_value"],
            }
        return {
            "value": None,
            "status": "candidate",
            "candidates": candidates,
            "conflict_value": None,
        }
    if current["status"] in {"filled", "agent_edited", "conflict"} and current["value"]:
        if not _same_value(key, current["value"], new_value):
            return {
                "value": current["value"],
                "status": "conflict",
                "candidates": current["candidates"],
                "conflict_value": new_value,
            }
        return {
            "value": current["value"],
            "status": "filled" if current["status"] != "agent_edited" else current["status"],
            "candidates": [],
            "conflict_value": None,
        }
    return {
        "value": new_value,
        "status": "filled",
        "candidates": [],
        "conflict_value": None,
    }


def _order_candidate(row: dict) -> dict:
    order_no = row.get("order_no")
    if order_no is not None:
        order_no = str(order_no)
    title = row.get("title")
    if title is not None:
        title = str(title)
    ordered_at = row.get("ordered_at")
    if ordered_at is not None:
        ordered_at = str(ordered_at)
    return {
        "order_no": order_no,
        "title": title,
        "ordered_at": ordered_at,
        "value": order_no,
    }


def _apply_order_match(
    stored: dict, meta: dict, rows: list[dict] | None, failed: bool
) -> None:
    current = _normalize_field_item(stored.get("order_no"))
    previous = meta.get("order_match") if isinstance(meta.get("order_match"), dict) else {}
    keywords = previous.get("keywords")
    time_range_text = previous.get("time_range_text")
    match = {
        "status": "missing",
        "query_message": None,
        "time_range_text": time_range_text if isinstance(time_range_text, str) else None,
        "keywords": keywords if isinstance(keywords, list) else [],
        "candidates": [],
    }
    locked = current["status"] == "agent_edited" or (
        current["status"] in {"filled", "conflict"} and current["value"]
    )
    if failed:
        match["status"] = "query_failed"
        match["query_message"] = QUERY_NOT_FOUND_MESSAGE
        if not locked:
            stored["order_no"] = blank_field()
        meta["order_match"] = match
        return
    candidates = [_order_candidate(row) for row in (rows or []) if row.get("order_no")]
    match["candidates"] = candidates
    if not candidates:
        match["status"] = "missing"
        match["query_message"] = QUERY_NOT_FOUND_MESSAGE
        if not locked:
            stored["order_no"] = blank_field()
        meta["order_match"] = match
        return
    if len(candidates) == 1:
        match["status"] = "auto_filled"
        order_no = candidates[0].get("order_no")
        if not locked and isinstance(order_no, str):
            stored["order_no"] = {
                "value": order_no,
                "status": "filled",
                "candidates": [],
                "conflict_value": None,
            }
        meta["order_match"] = match
        return
    match["status"] = "candidates"
    if not locked:
        stored["order_no"] = {
            "value": None,
            "status": "candidate",
            "candidates": candidates,
            "conflict_value": None,
        }
    else:
        current["candidates"] = candidates
        stored["order_no"] = current
    meta["order_match"] = match


def _clear_unverified_logistics(stored: dict) -> None:
    for key in ("responsible_party", "compensation_plan"):
        current = _normalize_field_item(stored.get(key))
        if current["status"] != "agent_edited":
            stored[key] = blank_field()


def _logistics_query_ok(meta: dict) -> bool:
    snapshot = meta.get("logistics_snapshot")
    return isinstance(snapshot, dict) and snapshot.get("query_status") == "ok"


def _lock_for(ticket_id: str) -> asyncio.Lock:
    lock = _extract_locks.get(ticket_id)
    if lock is None:
        lock = asyncio.Lock()
        _extract_locks[ticket_id] = lock
    return lock


async def fail_stale_extracting_tickets(db: AsyncSession | None = None) -> None:
    settings = ensure_config()
    cutoff = datetime.now(UTC) - timedelta(seconds=settings.ingest_stale_seconds)

    async def _run(session: AsyncSession) -> None:
        repo = TicketRepository(session)
        changed = await repo.mark_stale_extracting(cutoff)
        if changed:
            logger.info("已将过期抽取中工单标为失败", count=changed)

    if db is not None:
        await _run(db)
        return
    async with get_session_maker()() as session:
        await _run(session)
        await session.commit()


class TicketService:
    def __init__(self, db: AsyncSession, settings: AppSettings | None = None):
        self.db = db
        self.tickets = TicketRepository(db)
        self.conversations = ConversationRepository(db)
        self.settings = settings or ensure_config()

    async def _handed_off_conversation(self, conversation_id: str) -> Conversation:
        conversation = await self.conversations.get_by_id(conversation_id)
        if conversation is None:
            raise ConversationNotFoundError
        if conversation.status != _STATUS_HANDED_OFF:
            raise TicketConflictError(_NOT_HANDED_OFF)
        return conversation

    async def get_or_create(self, conversation_id: str) -> TicketPublic:
        await fail_stale_extracting_tickets(self.db)
        await self._handed_off_conversation(conversation_id)
        ticket = await self.tickets.ensure_empty_draft(conversation_id)
        return to_ticket_public(ticket)

    async def update(
        self, conversation_id: str, body: TicketUpdate
    ) -> tuple[TicketPublic, str | None, tuple[str, ...]]:
        await fail_stale_extracting_tickets(self.db)
        await self._handed_off_conversation(conversation_id)
        ticket = await self.tickets.ensure_empty_draft(conversation_id)
        stored, meta = split_stored(ticket.fields_json)
        type_in_request = "ticket_type" in body.model_fields_set
        if ticket.status != _STATUS_DRAFT and type_in_request:
            raise TicketConflictError(_TYPE_LOCKED)

        type_changed = False
        if type_in_request:
            new_type = body.ticket_type
            if new_type is not None and new_type not in _TICKET_TYPES:
                raise TicketValidationError
            type_changed = new_type != ticket.ticket_type
            ticket.ticket_type = new_type
            if new_type not in _TICKET_TYPES:
                ticket.extract_status = "idle"
                ticket.extract_error = None

        if "business_line" in body.model_fields_set:
            new_line = body.business_line
            if new_line is not None and new_line not in _BUSINESS_LINES:
                raise TicketValidationError
            ticket.business_line = new_line

        protected: set[str] = set()
        if body.fields is not None:
            allowed = set(_allowed_keys(ticket.ticket_type))
            logistics_locked = (
                ticket.ticket_type == "logistics_exception" and not _logistics_query_ok(meta)
            )
            for key, value in body.fields.items():
                if key not in allowed:
                    raise TicketValidationError
                if logistics_locked and key in _EXTRACT_SKIP_KEYS:
                    raise TicketConflictError(_LOGISTICS_LOCKED)
                checked = _validate_enum_value(key, value)
                if value is not None and key in _ENUM_VALUES and checked is None:
                    raise TicketValidationError
                if checked is None:
                    stored[key] = blank_field()
                else:
                    stored[key] = {
                        "value": checked,
                        "status": "agent_edited",
                        "candidates": [],
                        "conflict_value": None,
                    }
                protected.add(key)
            ticket.fields_json = join_stored(stored, meta)

        conversation = await self.conversations.get_by_id(conversation_id)
        should_extract = self._should_extract(ticket, conversation, type_changed)
        job_id: str | None = None
        if should_extract:
            ticket.extract_status = "extracting"
            ticket.extract_error = None
            job_id = ticket.id
        ticket.fields_json = join_stored(*split_stored(ticket.fields_json))
        ticket = await self.tickets.save(ticket)
        return to_ticket_public(ticket), job_id, tuple(protected)

    async def confirm(self, conversation_id: str) -> TicketPublic:
        await fail_stale_extracting_tickets(self.db)
        await self._handed_off_conversation(conversation_id)
        ticket = await self.tickets.ensure_empty_draft(conversation_id)
        if ticket.status in _CONFIRMED_STATUSES:
            return to_ticket_public(ticket)
        if ticket.ticket_type not in _TICKET_TYPES:
            raise TicketConflictError(_NEED_TYPE)
        if ticket.business_line not in _BUSINESS_LINES:
            raise TicketConflictError(_NEED_LINE)
        stored, meta = split_stored(ticket.fields_json)
        if ticket.ticket_type == "invoice":
            kind = _field_value(stored.get("invoice_kind"))
            tax_id = _field_value(stored.get("tax_id"))
            if kind == "vat_special" and not tax_id:
                raise TicketConflictError(_NEED_TAX)
        if ticket.ticket_type == "fee_dispute" and not _attachments(meta):
            raise TicketConflictError(_NEED_EVIDENCE)
        blockers = [
            key
            for key in _confirm_blockers(ticket)
            if key not in {"ticket_type", "business_line", "attachments"}
        ]
        if blockers:
            raise TicketConflictError(
                "以下字段不能确认：" + "、".join(blockers),
                confirm_blockers=blockers,
            )
        ticket.status = "pending"
        ticket.confirmed_at = datetime.now(UTC)
        ticket.extract_status = (
            "ready" if ticket.extract_status == "extracting" else ticket.extract_status
        )
        if not isinstance(meta.get("ticket_no"), str) or not meta["ticket_no"]:
            meta["ticket_no"] = await self.tickets.next_ticket_no()
        ticket.fields_json = join_stored(stored, meta)
        ticket = await self.tickets.save(ticket)
        conversation = await self.conversations.get_by_id(conversation_id)
        if conversation is not None:
            from src.services.assign import AssignService
            from src.services.fulfillment import FulfillmentService

            ticket = await AssignService(self.db, self.settings).apply_after_confirm(
                ticket, conversation
            )
            ticket = await FulfillmentService(self.db, self.settings).apply_after_confirm(
                ticket, conversation
            )
        logger.info("工单已确认", ticket_id=ticket.id, conversation_id=conversation_id)
        return to_ticket_public(ticket)

    async def begin_extract_for_new_messages(self, conversation_id: str) -> str | None:
        conversation = await self.conversations.get_by_id(conversation_id)
        if conversation is None or conversation.status != _STATUS_HANDED_OFF:
            return None
        ticket = await self.tickets.get_by_conversation_id(conversation_id)
        if ticket is None:
            ticket = await self.tickets.ensure_empty_draft(conversation_id)
        if not self._should_extract(ticket, conversation, type_changed=False):
            return None
        ticket.extract_status = "extracting"
        ticket.extract_error = None
        ticket = await self.tickets.save(ticket)
        return ticket.id

    def _should_extract(
        self, ticket: Ticket, conversation: Conversation | None, type_changed: bool
    ) -> bool:
        if ticket.status != _STATUS_DRAFT:
            return False
        if ticket.ticket_type not in _TICKET_TYPES:
            return False
        if type_changed:
            return True
        if conversation is None:
            return False
        return _has_new_employee_messages(ticket, conversation)


async def run_extract_job(ticket_id: str, protected_keys: tuple[str, ...] = ()) -> None:
    async with _lock_for(ticket_id):
        await _run_extract_job(ticket_id, set(protected_keys))


async def _run_extract_job(ticket_id: str, protected: set[str]) -> None:
    snapshot = await _load_extract_snapshot(ticket_id)
    if snapshot is None:
        return
    (
        ticket_type,
        business_line,
        user_content,
        corpus,
        last_message_id,
        user_key,
    ) = snapshot
    settings = ensure_config()
    try:
        extracted, extras = await _extract_fields_from_text(
            settings, ticket_type, business_line, user_content, corpus
        )
    except (BailianError, ValueError) as exc:
        logger.warning("工单抽取失败", ticket_id=ticket_id, detail=str(exc))
        await _mark_extract_failed(ticket_id)
        return
    except Exception:
        logger.exception("工单抽取异常", ticket_id=ticket_id)
        await _mark_extract_failed(ticket_id)
        return

    order_rows, order_failed = await _match_orders(
        settings, user_key, extras.get("time_range_text"), extras.get("keywords") or []
    )
    logistics = None
    if ticket_type == "logistics_exception":
        logistics = await _track_logistics(
            settings,
            extracted.get("tracking_no", (None, "high"))[0],
            extracted.get("order_no", (None, "high"))[0],
        )

    async with get_session_maker()() as session:
        tickets = TicketRepository(session)
        ticket = await tickets.get_by_id(ticket_id)
        if ticket is None:
            return
        if ticket.status != _STATUS_DRAFT or ticket.ticket_type not in _TICKET_TYPES:
            if ticket.extract_status == "extracting" and ticket.status == _STATUS_DRAFT:
                ticket.extract_status = "idle"
                await tickets.save(ticket)
                await session.commit()
            return
        stored, meta = split_stored(ticket.fields_json)
        for key, (value, confidence) in extracted.items():
            if key in protected or key in _EXTRACT_SKIP_KEYS:
                continue
            stored[key] = _merge_slot(stored.get(key), value, confidence, key)
        match_meta = meta.get("order_match") if isinstance(meta.get("order_match"), dict) else {}
        match_meta = dict(match_meta)
        match_meta["time_range_text"] = extras.get("time_range_text")
        match_meta["keywords"] = extras.get("keywords") or []
        meta["order_match"] = match_meta
        _apply_order_match(stored, meta, order_rows, order_failed)
        if ticket.ticket_type == "logistics_exception":
            snapshot_data = logistics or failed_snapshot()
            meta["logistics_snapshot"] = snapshot_data
            if snapshot_data.get("query_status") != "ok":
                _clear_unverified_logistics(stored)
        ticket.fields_json = join_stored(stored, meta)
        flag_modified(ticket, "fields_json")
        ticket.extract_status = "ready"
        ticket.extract_error = None
        if last_message_id is not None:
            ticket.last_extracted_message_id = last_message_id
        await tickets.save(ticket)
        await session.commit()
        logger.info("工单抽取完成", ticket_id=ticket.id, conversation_id=ticket.conversation_id)


async def _match_orders(
    settings: AppSettings,
    user_key: str,
    time_range: str | None,
    keywords: list[str],
) -> tuple[list[dict] | None, bool]:
    adapter = get_order_adapter(settings)
    try:
        rows = await adapter.match_orders(user_key, time_range, keywords)
        logger.info("订单中心匹配完成", hit_count=len(rows))
        return rows, False
    except OrderAdapterError:
        logger.warning("订单中心匹配失败，订单号保持缺失")
        return None, True


async def _track_logistics(
    settings: AppSettings, tracking_no: str | None, order_no: str | None
) -> dict[str, Any]:
    adapter = get_logistics_adapter(settings)
    try:
        snapshot = await adapter.track(tracking_no, order_no)
        query_status = snapshot.get("query_status")
        if query_status not in {"ok", "empty", "failed"}:
            snapshot = failed_snapshot()
        logger.info("物流轨迹查询完成", query_status=snapshot.get("query_status"))
        return snapshot
    except LogisticsAdapterError:
        logger.warning("物流轨迹查询失败，责任方与补偿保持缺失")
        return failed_snapshot()


async def _load_extract_snapshot(
    ticket_id: str,
) -> tuple[str, str | None, str, str, str | None, str] | None:
    async with get_session_maker()() as session:
        tickets = TicketRepository(session)
        conversations = ConversationRepository(session)
        ticket = await tickets.get_by_id(ticket_id)
        if ticket is None:
            return None
        if ticket.status != _STATUS_DRAFT or ticket.ticket_type not in _TICKET_TYPES:
            if ticket.extract_status == "extracting":
                ticket.extract_status = (
                    "idle" if ticket.ticket_type not in _TICKET_TYPES else ticket.extract_status
                )
                await tickets.save(ticket)
                await session.commit()
            return None
        conversation = await conversations.get_by_id(ticket.conversation_id)
        if conversation is None:
            return None
        limit = ensure_config().context_message_limit
        messages = _sorted_messages(conversation)
        employee_messages = [item for item in messages if item.role == _ROLE_EMPLOYEE]
        last_message_id = employee_messages[-1].id if employee_messages else (
            messages[-1].id if messages else None
        )
        user_key = (
            str(conversation.created_by_user_id)
            if conversation.created_by_user_id is not None
            else conversation.id
        )
        return (
            ticket.ticket_type,
            ticket.business_line,
            _conversation_prompt(conversation, limit),
            _conversation_corpus(conversation, limit),
            last_message_id,
            user_key,
        )


async def _mark_extract_failed(ticket_id: str) -> None:
    async with get_session_maker()() as session:
        tickets = TicketRepository(session)
        ticket = await tickets.get_by_id(ticket_id)
        if ticket is None or ticket.status != _STATUS_DRAFT:
            return
        ticket.extract_status = "failed"
        ticket.extract_error = EXTRACT_FAILED_MESSAGE
        await tickets.save(ticket)
        await session.commit()


async def _extract_fields_from_text(
    settings: AppSettings,
    ticket_type: str,
    business_line: str | None,
    user_conversation: str,
    corpus: str,
) -> tuple[dict[str, tuple[str | None, str]], dict[str, Any]]:
    if not has_llm_key(settings) and _extract_llm_override is None:
        raise BailianError("未配置模型密钥")
    if ticket_type not in _TYPE_PROMPTS:
        raise ValueError("工单类型不能抽取")
    system_prompt = _build_extract_prompt(ticket_type, business_line)
    messages = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": "只根据下列会话摘录字段，缺省用 null。\n" + user_conversation,
        },
    ]
    llm: ExtractLlmClient = _extract_llm_override or BailianClient(settings)
    raw = await llm.chat_completions(messages, json_object=True)
    try:
        payload = _loads_json_object(raw)
    except ValueError:
        raw = await llm.chat_completions(messages, json_object=True)
        payload = _loads_json_object(raw)
    nested = payload.get("fields")
    source = nested if isinstance(nested, dict) else payload
    allowed = _allowed_keys(ticket_type)
    extracted: dict[str, tuple[str | None, str]] = {}
    for key in allowed:
        raw_slot = source.get(key)
        confidence = _parse_confidence(raw_slot, settings)
        value = _validate_enum_value(key, _coerce_extract_value(raw_slot))
        value = _apply_grounding(key, value, corpus)
        extracted[key] = (value, confidence)
    time_range = payload.get("time_range_text")
    if not isinstance(time_range, str) or not time_range.strip() or time_range not in corpus:
        time_range = None
    else:
        time_range = time_range.strip()
    keywords_raw = payload.get("keywords")
    keywords: list[str] = []
    if isinstance(keywords_raw, list):
        for item in keywords_raw:
            text = str(item).strip() if item is not None else ""
            if text and text in corpus and text not in keywords:
                keywords.append(text)
    return extracted, {"time_range_text": time_range, "keywords": keywords}


def _build_extract_prompt(ticket_type: str, business_line: str | None) -> str:
    parts = [
        (_PROMPT_DIR / "extract_common.md").read_text(encoding="utf-8"),
        (_PROMPT_DIR / _TYPE_PROMPTS[ticket_type]).read_text(encoding="utf-8"),
    ]
    if business_line in _LINE_PROMPTS:
        parts.append((_PROMPT_DIR / _LINE_PROMPTS[business_line]).read_text(encoding="utf-8"))
    return "\n\n".join(parts)
