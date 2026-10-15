from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from pycore.core.logger import get_logger
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from src.db.models import Base, Ticket, User
from src.db.session import AppSettings, ensure_config
from src.models.ticket import TicketPublic
from src.models.ticket_attachment import (
    ALLOWED_ATTACHMENT_SUFFIXES,
    REUPLOAD_MESSAGE,
    ResultFeedbackCreate,
    ResultFeedbackPublic,
)
from src.repositories.conversation_repository import ConversationRepository
from src.repositories.ticket_repository import TicketRepository, join_stored, split_stored
from src.services.handoff import ConversationNotFoundError
from src.services.ingest import resolve_upload_dir
from src.services.templates import PromptTemplateRow, TemplateService
from src.services.ticket import TicketConflictError, to_ticket_public
from src.utils.text import upload_suffix

logger = get_logger()

_STATUS_HANDED_OFF = "handed_off"
_NOT_HANDED_OFF = "会话尚未转人工，不能填单"
_ROLE_EMPLOYEE = "employee"
_TICKETS_SUBDIR = "tickets"
_SIGNED_STATUSES = frozenset({"signed", "已签收", "签收"})
_FORBIDDEN = "没有权限"


class AttachmentValidationError(Exception):
    def __init__(self, message: str = REUPLOAD_MESSAGE):
        self.message = message
        super().__init__(message)


class FeedbackForbiddenError(Exception):
    def __init__(self, message: str = _FORBIDDEN):
        self.message = message
        super().__init__(message)


class TicketAttachmentRow(Base):
    __tablename__ = "ticket_attachments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    ticket_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False
    )
    conversation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    stored_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ResultFeedbackRow(Base):
    __tablename__ = "result_feedbacks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    conversation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    template_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("prompt_templates.id", ondelete="CASCADE"), nullable=False
    )
    template_version: Mapped[int] = mapped_column(Integer, nullable=False)
    rating: Mapped[str] = mapped_column(String(32), nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    target: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _template_scene(ticket: Ticket | None) -> str:
    ticket_type = ticket.ticket_type if ticket is not None else None
    if ticket_type == "logistics_exception":
        _, meta = split_stored(ticket.fields_json) if ticket is not None else ({}, {})
        snapshot = meta.get("logistics_snapshot")
        sign = snapshot.get("sign_status") if isinstance(snapshot, dict) else None
        if isinstance(sign, str) and sign.strip() in _SIGNED_STATUSES:
            return "after_sale"
        return "in_transit"
    if not ticket_type:
        return "pre_sale"
    return "after_sale"


class TicketAttachmentService:
    def __init__(self, db: AsyncSession, settings: AppSettings | None = None):
        self.db = db
        self.settings = settings or ensure_config()
        self.conversations = ConversationRepository(db)
        self.tickets = TicketRepository(db)

    async def add(self, conversation_id: str, filename: str | None, raw: bytes) -> TicketPublic:
        suffix = upload_suffix(filename)
        if suffix not in ALLOWED_ATTACHMENT_SUFFIXES:
            raise AttachmentValidationError
        if not raw or len(raw) > self.settings.max_upload_bytes:
            raise AttachmentValidationError
        conversation = await self.conversations.get_by_id(conversation_id)
        if conversation is None:
            raise ConversationNotFoundError
        if conversation.status != _STATUS_HANDED_OFF:
            raise TicketConflictError(_NOT_HANDED_OFF)
        ticket = await self.tickets.ensure_empty_draft(conversation_id)
        attachment_id = str(uuid4())
        stored_name = f"{attachment_id}{suffix}"
        relative = f"{_TICKETS_SUBDIR}/{stored_name}"
        directory = resolve_upload_dir(self.settings) / _TICKETS_SUBDIR
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / stored_name
        path.write_bytes(raw)
        now = datetime.now(UTC)
        original_name = Path(filename or stored_name).name
        self.db.add(
            TicketAttachmentRow(
                id=attachment_id,
                ticket_id=ticket.id,
                conversation_id=conversation_id,
                filename=original_name,
                stored_path=relative,
                created_at=now,
            )
        )
        stored, meta = split_stored(ticket.fields_json)
        attachments = meta.get("attachments")
        if not isinstance(attachments, list):
            attachments = []
        attachments.append(
            {
                "id": attachment_id,
                "filename": original_name,
                "path": relative,
            }
        )
        meta["attachments"] = attachments
        ticket.fields_json = join_stored(stored, meta)
        ticket = await self.tickets.save(ticket)
        logger.info(
            "工单证据截图已保存",
            ticket_id=ticket.id,
            conversation_id=conversation_id,
            attachment_id=attachment_id,
        )
        return to_ticket_public(ticket)


class ResultFeedbackService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.conversations = ConversationRepository(db)
        self.tickets = TicketRepository(db)
        self.templates = TemplateService(db)

    async def create(
        self, conversation_id: str, body: ResultFeedbackCreate, user: User
    ) -> ResultFeedbackPublic:
        if user.role == _ROLE_EMPLOYEE:
            raise FeedbackForbiddenError
        conversation = await self.conversations.get_by_id(conversation_id)
        if conversation is None:
            raise ConversationNotFoundError
        template_id, template_version = await self._resolve_template(conversation_id)
        now = datetime.now(UTC)
        row = ResultFeedbackRow(
            id=str(uuid4()),
            conversation_id=conversation_id,
            template_id=template_id,
            template_version=template_version,
            rating=body.rating,
            comment=body.comment,
            target=body.target,
            created_at=now,
        )
        self.db.add(row)
        await self.db.flush()
        logger.info(
            "坐席当次反馈已记录",
            conversation_id=conversation_id,
            template_id=template_id,
            template_version=template_version,
            rating=body.rating,
        )
        return ResultFeedbackPublic(
            id=row.id,
            conversation_id=row.conversation_id,
            template_id=row.template_id,
            template_version=row.template_version,
            rating=row.rating,  # type: ignore[arg-type]
            comment=row.comment,
            created_at=_as_utc(row.created_at),
        )

    async def _resolve_template(self, conversation_id: str) -> tuple[str, int]:
        await self.templates.list_templates()
        ticket = await self.tickets.get_by_conversation_id(conversation_id)
        business_line = ticket.business_line if ticket is not None else None
        ticket_type = ticket.ticket_type if ticket is not None else None
        scene = _template_scene(ticket)
        stmt = select(PromptTemplateRow)
        if business_line:
            stmt = stmt.where(PromptTemplateRow.business_line == business_line)
        stmt = stmt.where(PromptTemplateRow.scene == scene)
        if ticket_type:
            stmt = stmt.where(PromptTemplateRow.ticket_type == ticket_type)
        row = (await self.db.execute(stmt)).scalars().first()
        if row is None:
            row = (
                await self.db.execute(select(PromptTemplateRow).order_by(PromptTemplateRow.id))
            ).scalars().first()
        if row is None:
            raise ConversationNotFoundError
        version = await self.templates.resolve_conversation_version(row.id, conversation_id)
        return row.id, version
