from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

REUPLOAD_MESSAGE = "请重新上传"
COMMENT_MAX_CHARS = 500
ALLOWED_ATTACHMENT_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".webp"})
FeedbackRating = Literal["useful", "useless"]
FeedbackTarget = Literal["extract", "knowledge", "polish"]


class ResultFeedbackCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rating: FeedbackRating
    comment: str | None = Field(default=None, max_length=COMMENT_MAX_CHARS)
    target: FeedbackTarget

    @field_validator("comment", mode="before")
    @classmethod
    def empty_comment_as_null(cls, value: object) -> object:
        if value is None:
            return None
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        return value


class ResultFeedbackPublic(BaseModel):
    id: str
    conversation_id: str
    template_id: str
    template_version: int
    rating: FeedbackRating
    comment: str | None
    created_at: datetime
