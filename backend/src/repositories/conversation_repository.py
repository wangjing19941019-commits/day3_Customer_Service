from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.db.models import Chunk, Conversation, Document, Faq, Message

_STATUS_BOT = "bot"
_STATUS_HANDED_OFF = "handed_off"


class ConversationRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, created_by_user_id: int | None) -> Conversation:
        now = datetime.now(UTC)
        conversation = Conversation(
            id=str(uuid4()),
            status=_STATUS_BOT,
            clarification_round=0,
            created_by_user_id=created_by_user_id,
            created_at=now,
            updated_at=now,
        )
        self.db.add(conversation)
        try:
            await self.db.flush()
        except IntegrityError as exc:
            await self.db.rollback()
            raise ValueError("数据冲突") from exc
        loaded = await self.get_by_id(conversation.id)
        if loaded is None:
            raise ValueError("会话写入后无法读取")
        return loaded

    async def get_by_id(self, conversation_id: str) -> Conversation | None:
        result = await self.db.execute(
            select(Conversation)
            .options(selectinload(Conversation.messages))
            .where(Conversation.id == conversation_id)
        )
        return result.scalar_one_or_none()

    async def list_handed_off(
        self, offset: int, limit: int
    ) -> tuple[list[Conversation], int]:
        filters = Conversation.status == _STATUS_HANDED_OFF
        total = (
            await self.db.execute(select(func.count()).select_from(Conversation).where(filters))
        ).scalar_one()
        result = await self.db.execute(
            select(Conversation)
            .options(selectinload(Conversation.messages))
            .where(filters)
            .order_by(Conversation.updated_at.desc())
            .offset(offset)
            .limit(limit)
        )
        return list(result.scalars().unique().all()), total

    async def mark_handed_off(self, conversation: Conversation) -> Conversation:
        if conversation.status != _STATUS_HANDED_OFF:
            conversation.status = _STATUS_HANDED_OFF
            conversation.updated_at = datetime.now(UTC)
            await self.db.flush()
        loaded = await self.get_by_id(conversation.id)
        if loaded is None:
            raise ValueError("会话转接后无法读取")
        return loaded

    async def add_message(
        self,
        conversation: Conversation,
        *,
        role: str,
        kind: str,
        content: str,
        original_content: str | None = None,
        rewritten_content: str | None = None,
    ) -> Message:
        now = datetime.now(UTC)
        message = Message(
            id=str(uuid4()),
            conversation_id=conversation.id,
            role=role,
            kind=kind,
            content=content,
            original_content=original_content,
            rewritten_content=rewritten_content,
            created_at=now,
        )
        conversation.updated_at = now
        self.db.add(message)
        try:
            await self.db.flush()
        except IntegrityError as exc:
            await self.db.rollback()
            raise ValueError("数据冲突") from exc
        await self.db.refresh(message)
        self.db.expire(conversation, ["messages", "updated_at"])
        return message

    async def set_clarification_round(
        self, conversation: Conversation, value: int
    ) -> None:
        conversation.clarification_round = value
        conversation.updated_at = datetime.now(UTC)
        await self.db.flush()

    async def update_rewritten(self, message: Message, rewritten: str) -> None:
        message.rewritten_content = rewritten
        await self.db.flush()

    async def list_ready_faqs(self) -> list[Faq]:
        result = await self.db.execute(
            select(Faq)
            .join(Document, Document.id == Faq.document_id)
            .where(Document.ingest_status == "ready")
            .order_by(Document.created_at.asc(), Faq.id.asc())
        )
        return list(result.scalars().all())

    async def list_ready_chunks(self) -> list[Chunk]:
        result = await self.db.execute(
            select(Chunk)
            .join(Document, Document.id == Chunk.document_id)
            .where(Document.ingest_status == "ready")
            .order_by(Document.created_at.asc(), Chunk.position.asc())
        )
        return list(result.scalars().all())
