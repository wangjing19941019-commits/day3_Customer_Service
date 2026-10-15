from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from pycore.core import get_logger
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import Conversation, Ticket
from src.db.session import AppSettings, ensure_config
from src.integrations.adapters.finance import FinanceAdapterError, get_finance_adapter
from src.integrations.adapters.warehouse import WarehouseAdapterError, get_warehouse_adapter
from src.repositories.conversation_repository import ConversationRepository
from src.repositories.ticket_repository import TicketRepository, join_stored, split_stored

logger = get_logger()

_KIND_PROGRESS = "ticket_progress"
_ROLE_SYSTEM = "system"
_TYPE_RETURN = "return_exchange"
_TYPE_INVOICE = "invoice"
_SUCCESS_RETURN = "已发起退货"
_SUCCESS_INVOICE = "已发起开票"
_FAIL_RETURN = "仓储暂时未能受理退货"
_FAIL_INVOICE = "财务暂时未能受理开票"
_FORBIDDEN_RETURN = "已生成退货单"
_FORBIDDEN_INVOICE = "已开票"
_EVENT_RETURN_OK = "return_created"
_EVENT_RETURN_FAIL = "return_failed"
_EVENT_INVOICE_OK = "invoice_created"
_EVENT_INVOICE_FAIL = "invoice_failed"


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _iso(value: datetime) -> str:
    return _as_utc(value).isoformat()


def _field_value(item: object) -> str | None:
    if not isinstance(item, dict):
        return None
    value = item.get("value")
    if not isinstance(value, str) or not value.strip():
        return None
    return value.strip()


def _ticket_payload(ticket: Ticket) -> dict[str, Any]:
    stored, meta = split_stored(ticket.fields_json)
    return {
        "ticket_id": ticket.id,
        "ticket_no": meta.get("ticket_no") if isinstance(meta.get("ticket_no"), str) else None,
        "ticket_type": ticket.ticket_type,
        "order_no": _field_value(stored.get("order_no")),
        "product_info": _field_value(stored.get("product_info")),
        "amount": _field_value(stored.get("amount")),
        "return_method": _field_value(stored.get("return_method")),
        "return_reason": _field_value(stored.get("return_reason")),
        "quantity": _field_value(stored.get("quantity")),
        "invoice_kind": _field_value(stored.get("invoice_kind")),
        "invoice_title": _field_value(stored.get("invoice_title")),
        "tax_id": _field_value(stored.get("tax_id")),
        "invoice_contact": _field_value(stored.get("invoice_contact")),
    }


def _visible_text(raw: str | None, fallback: str) -> str:
    text = (raw or "").strip() or fallback
    if _FORBIDDEN_RETURN in text or _FORBIDDEN_INVOICE in text:
        return fallback
    return text


def _has_event(progress: list, events: set[str]) -> bool:
    for item in progress:
        if isinstance(item, dict) and item.get("event") in events:
            return True
    return False


class FulfillmentService:
    def __init__(self, db: AsyncSession, settings: AppSettings | None = None):
        self.db = db
        self.settings = settings or ensure_config()
        self.tickets = TicketRepository(db)
        self.conversations = ConversationRepository(db)

    async def apply_after_confirm(self, ticket: Ticket, conversation: Conversation) -> Ticket:
        if ticket.ticket_type == _TYPE_RETURN:
            return await self._dispatch_return(ticket, conversation)
        if ticket.ticket_type == _TYPE_INVOICE:
            return await self._dispatch_invoice(ticket, conversation)
        logger.info(
            "工单类型本轮不发起仓储或财务",
            ticket_id=ticket.id,
            ticket_type=ticket.ticket_type,
        )
        return ticket

    async def _dispatch_return(self, ticket: Ticket, conversation: Conversation) -> Ticket:
        stored, meta = split_stored(ticket.fields_json)
        progress = meta.get("progress")
        if not isinstance(progress, list):
            progress = []
        if _has_event(progress, {_EVENT_RETURN_OK, _EVENT_RETURN_FAIL}):
            return ticket
        adapter = get_warehouse_adapter(self.settings)
        try:
            result = await adapter.create_return(_ticket_payload(ticket))
        except WarehouseAdapterError as exc:
            logger.warning("仓储发起退货失败", ticket_id=ticket.id, detail=str(exc))
            result = {"accepted": False, "external_ref": None, "error": _FAIL_RETURN}
        accepted = bool(result.get("accepted"))
        if accepted:
            detail = _SUCCESS_RETURN
            event = _EVENT_RETURN_OK
            external_ref = result.get("external_ref")
            error = None
        else:
            detail = _visible_text(
                result.get("error") if isinstance(result.get("error"), str) else None,
                _FAIL_RETURN,
            )
            event = _EVENT_RETURN_FAIL
            external_ref = None
            error = detail
        return await self._record(
            ticket,
            conversation,
            stored,
            meta,
            progress,
            event=event,
            detail=detail,
            external_ref=external_ref if isinstance(external_ref, str) else None,
            error=error,
            intent_key="warehouse_intent",
        )

    async def _dispatch_invoice(self, ticket: Ticket, conversation: Conversation) -> Ticket:
        stored, meta = split_stored(ticket.fields_json)
        progress = meta.get("progress")
        if not isinstance(progress, list):
            progress = []
        if _has_event(progress, {_EVENT_INVOICE_OK, _EVENT_INVOICE_FAIL}):
            return ticket
        adapter = get_finance_adapter(self.settings)
        try:
            result = await adapter.create_invoice(_ticket_payload(ticket))
        except FinanceAdapterError as exc:
            logger.warning("财务发起开票失败", ticket_id=ticket.id, detail=str(exc))
            result = {"accepted": False, "external_ref": None, "error": _FAIL_INVOICE}
        accepted = bool(result.get("accepted"))
        if accepted:
            detail = _SUCCESS_INVOICE
            event = _EVENT_INVOICE_OK
            external_ref = result.get("external_ref")
            error = None
        else:
            detail = _visible_text(
                result.get("error") if isinstance(result.get("error"), str) else None,
                _FAIL_INVOICE,
            )
            event = _EVENT_INVOICE_FAIL
            external_ref = None
            error = detail
        return await self._record(
            ticket,
            conversation,
            stored,
            meta,
            progress,
            event=event,
            detail=detail,
            external_ref=external_ref if isinstance(external_ref, str) else None,
            error=error,
            intent_key="finance_intent",
        )

    async def _record(
        self,
        ticket: Ticket,
        conversation: Conversation,
        stored: dict,
        meta: dict,
        progress: list,
        *,
        event: str,
        detail: str,
        external_ref: str | None,
        error: str | None,
        intent_key: str,
    ) -> Ticket:
        now = datetime.now(UTC)
        progress.append(
            {
                "event": event,
                "at": _iso(now),
                "detail": detail,
                "external_ref": external_ref,
                "error": error,
            }
        )
        meta["progress"] = progress
        meta[intent_key] = {
            "event": event,
            "external_ref": external_ref,
            "error": error,
        }
        ticket.fields_json = join_stored(stored, meta)
        ticket = await self.tickets.save(ticket)
        await self._write_progress(conversation, detail)
        logger.info("工单联动进度已回写", ticket_id=ticket.id, event=event)
        return ticket

    async def _write_progress(self, conversation: Conversation | None, content: str) -> None:
        if conversation is None:
            return
        await self.conversations.add_message(
            conversation,
            role=_ROLE_SYSTEM,
            kind=_KIND_PROGRESS,
            content=content,
        )
        loaded = await self.conversations.get_by_id(conversation.id)
        if loaded is not None:
            conversation.messages = loaded.messages
