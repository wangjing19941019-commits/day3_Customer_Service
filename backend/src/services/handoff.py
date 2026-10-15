from datetime import UTC, datetime

from pycore.core import get_logger

from src.db.models import Conversation, Message, User
from src.models.conversation import (
    AgentReplyResult,
    ConversationListItem,
    ConversationPublic,
    MessagePublic,
)
from src.repositories.conversation_repository import ConversationRepository
from src.repositories.ticket_repository import TicketRepository
from src.services.templates import TemplateService

logger = get_logger()

_STATUS_HANDED_OFF = "handed_off"
_KIND_WAITING = "waiting_for_agent"
_ROLE_AGENT = "agent"
_KIND_AGENT = "agent"


class ConversationNotFoundError(Exception):
    pass


class NotHandedOffError(Exception):
    pass


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _sorted_messages(conversation: Conversation) -> list[Message]:
    return sorted(conversation.messages, key=lambda item: _as_utc(item.created_at))


def _waiting_for_agent(conversation: Conversation) -> bool:
    if conversation.status != _STATUS_HANDED_OFF:
        return False
    messages = _sorted_messages(conversation)
    if not messages:
        return True
    return messages[-1].role != _ROLE_AGENT


def _preview(conversation: Conversation) -> str:
    visible = [item for item in _sorted_messages(conversation) if item.kind != _KIND_WAITING]
    if not visible:
        return ""
    return visible[-1].content


def _message_public(message: Message) -> MessagePublic:
    return MessagePublic(
        id=message.id,
        role=message.role,  # type: ignore[arg-type]
        kind=message.kind,  # type: ignore[arg-type]
        content=message.content,
        original_content=message.original_content,
        rewritten_content=message.rewritten_content,
        created_at=_as_utc(message.created_at),
    )


def _conversation_public(conversation: Conversation) -> ConversationPublic:
    return ConversationPublic(
        id=conversation.id,
        status=conversation.status,  # type: ignore[arg-type]
        clarification_round=conversation.clarification_round,
        waiting_for_agent=_waiting_for_agent(conversation),
        messages=[_message_public(item) for item in _sorted_messages(conversation)],
        created_at=_as_utc(conversation.created_at),
        updated_at=_as_utc(conversation.updated_at),
    )


def _list_item(conversation: Conversation) -> ConversationListItem:
    return ConversationListItem(
        id=conversation.id,
        status=conversation.status,  # type: ignore[arg-type]
        updated_at=_as_utc(conversation.updated_at),
        preview=_preview(conversation),
        waiting_for_agent=_waiting_for_agent(conversation),
    )


class HandoffService:
    def __init__(self, repo: ConversationRepository):
        self.repo = repo

    async def create_conversation(self, user: User) -> ConversationPublic:
        conversation = await self.repo.create(user.id)
        logger.info("已创建员工会话", conversation_id=conversation.id, status=conversation.status)
        return _conversation_public(conversation)

    async def list_handed_off(
        self, offset: int, limit: int
    ) -> tuple[list[ConversationListItem], int]:
        conversations, total = await self.repo.list_handed_off(offset, limit)
        return [_list_item(item) for item in conversations], total

    async def get_conversation(self, conversation_id: str) -> ConversationPublic:
        conversation = await self.repo.get_by_id(conversation_id)
        if conversation is None:
            raise ConversationNotFoundError
        return _conversation_public(conversation)

    async def transfer(self, conversation_id: str) -> ConversationPublic:
        conversation = await self.repo.get_by_id(conversation_id)
        if conversation is None:
            raise ConversationNotFoundError
        conversation = await self.repo.mark_handed_off(conversation)
        await TicketRepository(self.repo.db).ensure_empty_draft(conversation.id)
        loaded = await self.repo.get_by_id(conversation.id)
        if loaded is None:
            raise ConversationNotFoundError
        logger.info("会话已转人工", conversation_id=loaded.id, status=loaded.status)
        return _conversation_public(loaded)

    async def agent_reply(self, conversation_id: str, content: str) -> AgentReplyResult:
        conversation = await self.repo.get_by_id(conversation_id)
        if conversation is None:
            raise ConversationNotFoundError
        if conversation.status != _STATUS_HANDED_OFF:
            raise NotHandedOffError
        reply = await self.repo.add_message(
            conversation,
            role=_ROLE_AGENT,
            kind=_KIND_AGENT,
            content=content,
            original_content=None,
            rewritten_content=None,
        )
        await TemplateService(self.repo.db).record_reply_outcome(conversation_id, content)
        loaded = await self.repo.get_by_id(conversation_id)
        if loaded is None:
            raise ConversationNotFoundError
        logger.info("客服回复已写入", conversation_id=loaded.id, message_id=reply.id)
        return AgentReplyResult(
            conversation=_conversation_public(loaded),
            reply=_message_public(reply),
        )
