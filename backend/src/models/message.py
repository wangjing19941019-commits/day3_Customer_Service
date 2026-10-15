from pydantic import BaseModel, Field, field_validator

from src.models.conversation import ConversationPublic, MessagePublic

_CONTENT_MAX_CHARS = 4000


class MessageCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=_CONTENT_MAX_CHARS)

    @field_validator("content")
    @classmethod
    def not_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("请输入消息内容")
        if len(stripped) > _CONTENT_MAX_CHARS:
            raise ValueError("消息内容不能超过 4000 字")
        return stripped


class EmployeeMessageResult(BaseModel):
    conversation: ConversationPublic
    reply: MessagePublic
