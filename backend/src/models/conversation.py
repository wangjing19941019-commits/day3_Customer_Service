from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

MessageRole = Literal["employee", "system", "agent"]
MessageKind = Literal[
    "employee_turn",
    "clarification",
    "faq",
    "small_talk",
    "knowledge",
    "fallback",
    "waiting_for_agent",
    "ticket_progress",
    "agent",
]
ConversationStatus = Literal["bot", "handed_off"]

_CONTENT_MAX_CHARS = 4000


class AgentReplyCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=_CONTENT_MAX_CHARS)

    @field_validator("content")
    @classmethod
    def not_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("请输入回复内容")
        if len(stripped) > _CONTENT_MAX_CHARS:
            raise ValueError("回复内容不能超过 4000 字")
        return stripped


class MessagePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    role: MessageRole
    kind: MessageKind
    content: str
    original_content: str | None
    rewritten_content: str | None
    created_at: datetime


class ConversationPublic(BaseModel):
    id: str
    status: ConversationStatus
    clarification_round: int
    waiting_for_agent: bool
    messages: list[MessagePublic]
    created_at: datetime
    updated_at: datetime


class ConversationListItem(BaseModel):
    id: str
    status: ConversationStatus
    updated_at: datetime
    preview: str
    waiting_for_agent: bool


class AgentReplyResult(BaseModel):
    conversation: ConversationPublic
    reply: MessagePublic
