from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

INGEST_STATUS_FILTERS = ("ingesting", "ready", "failed")
INVALID_INGEST_STATUS_FILTER = "入库状态筛选无效"
VISIBILITY_VALUES = ("user_visible", "agent_only", "high_risk_human_only")
INVALID_VISIBILITY = "可见范围不合法"
INVALID_EFFECTIVE_RANGE = "结束时间不能早于开始时间"


def parse_ingest_status_query(value: str | None) -> str | None:
    if value is None:
        return None
    if value in INGEST_STATUS_FILTERS:
        return value
    raise ValueError(INVALID_INGEST_STATUS_FILTER)


class EntityTag(BaseModel):
    name: str = Field(..., min_length=1)
    type: Literal["product", "order", "spec"]

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("实体名称不能为空")
        return stripped


class FaqItem(BaseModel):
    id: str | None = None
    question: str = Field(..., min_length=1, max_length=500)
    answer: str = Field(..., min_length=1, max_length=4000)

    @field_validator("question", "answer")
    @classmethod
    def strip_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("FAQ 问法与答案不能为空")
        return stripped


class ChunkPreview(BaseModel):
    position: int
    heading_path: str
    content: str


class DocumentPublic(BaseModel):
    id: str
    filename: str
    ingest_status: str
    ingest_error: str | None
    object_types: list[str]
    request_types: list[str]
    entities: list[EntityTag]
    faqs: list[FaqItem]
    chunks: list[ChunkPreview]
    chunk_count: int
    visibility: str | None
    effective_from: datetime | None
    effective_to: datetime | None
    created_at: datetime
    updated_at: datetime


class DocumentListItem(BaseModel):
    id: str
    filename: str
    ingest_status: str
    ingest_error: str | None
    object_types: list[str]
    request_types: list[str]
    faq_count: int
    chunk_count: int
    visibility: str | None
    effective_from: datetime | None
    effective_to: datetime | None
    created_at: datetime
    updated_at: datetime


class DocumentUpdate(BaseModel):
    object_types: list[str] | None = None
    request_types: list[str] | None = None
    entities: list[EntityTag] | None = None
    faqs: list[FaqItem] | None = None
    visibility: str | None = None
    effective_from: datetime | None = None
    effective_to: datetime | None = None

    @field_validator("visibility", mode="before")
    @classmethod
    def empty_visibility_is_missing(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value
