from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from src.db.models import Ticket

COMMON_FIELD_KEYS = ("order_no", "product_info", "amount", "intent_summary")
TYPE_FIELD_KEYS: dict[str | None, tuple[str, ...]] = {
    None: COMMON_FIELD_KEYS,
    "return_exchange": COMMON_FIELD_KEYS
    + ("return_method", "return_reason", "quantity"),
    "address_change": COMMON_FIELD_KEYS
    + ("original_address", "new_address", "recipient_name", "phone"),
    "invoice": COMMON_FIELD_KEYS + ("invoice_kind", "invoice_title", "tax_id", "invoice_contact"),
    "complaint": COMMON_FIELD_KEYS
    + ("complaint_category", "incident_summary", "user_expectation", "need_escalate"),
    "fee_dispute": COMMON_FIELD_KEYS
    + ("dispute_type", "claimed_amount", "platform_amount", "diff_reason"),
    "logistics_exception": COMMON_FIELD_KEYS
    + ("tracking_no", "exception_type", "responsible_party", "user_request", "compensation_plan"),
}
ALL_FIELD_KEYS: tuple[str, ...] = tuple(
    dict.fromkeys(key for keys in TYPE_FIELD_KEYS.values() for key in keys)
)
OPTIONAL_FIELD_KEYS = frozenset({"original_address"})
EXTRACT_FAILED_MESSAGE = "抽取暂时失败，请稍后重试或手填"
QUERY_NOT_FOUND_MESSAGE = "暂未查到"
META_KEY = "_meta"


def blank_field() -> dict:
    return {"value": None, "status": "missing", "candidates": [], "conflict_value": None}


def blank_fields_json() -> dict:
    fields = {key: blank_field() for key in ALL_FIELD_KEYS}
    fields[META_KEY] = blank_meta()
    return fields


def blank_meta() -> dict:
    return {
        "ticket_no": None,
        "urgency": None,
        "queue": None,
        "assigned_role": None,
        "assigned_user_id": None,
        "assigned_display": None,
        "upgrade_undelivered": False,
        "order_match": None,
        "logistics_snapshot": None,
        "attachments": [],
        "progress": [],
        "sla": None,
    }


def split_stored(raw: object) -> tuple[dict, dict]:
    if not isinstance(raw, dict):
        return {}, blank_meta()
    meta = raw.get(META_KEY)
    if not isinstance(meta, dict):
        meta = blank_meta()
    else:
        merged = blank_meta()
        merged.update(meta)
        meta = merged
    fields = {key: value for key, value in raw.items() if key != META_KEY}
    return fields, meta


def join_stored(fields: dict, meta: dict) -> dict:
    stored = dict(fields)
    stored[META_KEY] = meta
    return stored


class TicketRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_id(self, ticket_id: str) -> Ticket | None:
        result = await self.db.execute(select(Ticket).where(Ticket.id == ticket_id))
        return result.scalar_one_or_none()

    async def get_by_conversation_id(self, conversation_id: str) -> Ticket | None:
        result = await self.db.execute(
            select(Ticket).where(Ticket.conversation_id == conversation_id)
        )
        return result.scalar_one_or_none()

    async def list_all(self) -> list[Ticket]:
        result = await self.db.execute(select(Ticket))
        return list(result.scalars().all())

    async def ensure_empty_draft(self, conversation_id: str) -> Ticket:
        existing = await self.get_by_conversation_id(conversation_id)
        if existing is not None:
            return existing
        now = datetime.now(UTC)
        ticket = Ticket(
            id=str(uuid4()),
            conversation_id=conversation_id,
            status="draft",
            ticket_type=None,
            business_line=None,
            extract_status="idle",
            extract_error=None,
            fields_json=blank_fields_json(),
            confirmed_at=None,
            last_extracted_message_id=None,
            created_at=now,
            updated_at=now,
        )
        try:
            async with self.db.begin_nested():
                self.db.add(ticket)
                await self.db.flush()
        except IntegrityError:
            existing = await self.get_by_conversation_id(conversation_id)
            if existing is None:
                raise ValueError("工单写入后无法读取") from None
            return existing
        loaded = await self.get_by_id(ticket.id)
        if loaded is None:
            raise ValueError("工单写入后无法读取")
        return loaded

    async def save(self, ticket: Ticket) -> Ticket:
        ticket.updated_at = datetime.now(UTC)
        flag_modified(ticket, "fields_json")
        await self.db.flush()
        loaded = await self.get_by_id(ticket.id)
        if loaded is None:
            raise ValueError("工单写入后无法读取")
        return loaded

    async def next_ticket_no(self, now: datetime | None = None) -> str:
        stamp = now or datetime.now(UTC)
        prefix = f"TKT-{stamp.strftime('%Y%m%d')}-"
        latest = 0
        for ticket in await self.list_all():
            _, meta = split_stored(ticket.fields_json)
            ticket_no = meta.get("ticket_no")
            if not isinstance(ticket_no, str) or not ticket_no.startswith(prefix):
                continue
            suffix = ticket_no[len(prefix) :]
            if suffix.isdigit():
                latest = max(latest, int(suffix))
        return f"{prefix}{latest + 1:04d}"

    async def mark_stale_extracting(self, cutoff: datetime) -> int:
        cutoff_naive = cutoff.astimezone(UTC).replace(tzinfo=None) if cutoff.tzinfo else cutoff
        result = await self.db.execute(
            select(Ticket).where(Ticket.extract_status == "extracting")
        )
        tickets = list(result.scalars().all())
        changed = 0
        now = datetime.now(UTC)
        for ticket in tickets:
            updated = ticket.updated_at
            if updated.tzinfo is not None:
                updated = updated.astimezone(UTC).replace(tzinfo=None)
            if updated >= cutoff_naive:
                continue
            ticket.extract_status = "failed"
            ticket.extract_error = EXTRACT_FAILED_MESSAGE
            ticket.updated_at = now
            changed += 1
        if changed:
            await self.db.flush()
        return changed
