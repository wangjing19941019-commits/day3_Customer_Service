from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

TicketType = Literal[
    "return_exchange",
    "address_change",
    "invoice",
    "complaint",
    "fee_dispute",
    "logistics_exception",
]
BusinessLine = Literal["digital_3c", "apparel_beauty"]
TicketStatus = Literal["draft", "pending", "in_progress", "on_hold", "completed", "closed"]
ExtractStatus = Literal["idle", "extracting", "ready", "failed"]
FieldStatus = Literal["filled", "candidate", "missing", "conflict", "agent_edited"]
OrderMatchStatus = Literal["auto_filled", "candidates", "missing", "query_failed"]
LogisticsQueryStatus = Literal["ok", "empty", "failed"]

INVALID_TICKET_FIELDS = "工单字段无效"
_POLISH_CONTENT_MAX_CHARS = 4000


class OrderOrValueCandidate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    value: str | None = None
    order_no: str | None = None
    title: str | None = None
    ordered_at: str | None = None


class TicketField(BaseModel):
    value: str | None
    status: FieldStatus
    candidates: list[OrderOrValueCandidate] = Field(default_factory=list)
    conflict_value: str | None = None


class OrderMatchPublic(BaseModel):
    status: OrderMatchStatus
    query_message: str | None = None
    time_range_text: str | None = None
    keywords: list[str] = Field(default_factory=list)
    candidates: list[OrderOrValueCandidate] = Field(default_factory=list)


class LogisticsSnapshotPublic(BaseModel):
    events: list[dict[str, Any]] = Field(default_factory=list)
    sign_status: str | None = None
    query_status: LogisticsQueryStatus
    note: str | None = None


class TicketPublic(BaseModel):
    id: str
    ticket_no: str | None
    conversation_id: str
    status: TicketStatus
    ticket_type: TicketType | None
    business_line: BusinessLine | None
    urgency: str | None
    queue: str | None
    assigned_role: str | None
    assigned_user_id: int | None
    assigned_display: str | None
    upgrade_undelivered: bool
    hold_reason: Literal["wait_user", "wait_warehouse"] | None = None
    order_no: str | None = None
    user_name: str | None = None
    extract_status: ExtractStatus
    extract_error: str | None
    can_confirm: bool
    confirm_blockers: list[str]
    fields: dict[str, TicketField]
    order_match: OrderMatchPublic | None
    logistics_snapshot: LogisticsSnapshotPublic | None
    attachments: list[dict[str, Any]]
    progress: list[dict[str, Any]]
    sla: dict[str, Any] | None
    confirmed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class TicketUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ticket_type: TicketType | None = None
    business_line: BusinessLine | None = None
    fields: dict[str, str | None] | None = None

    @field_validator("ticket_type", "business_line", mode="before")
    @classmethod
    def empty_enum_as_null(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("fields", mode="before")
    @classmethod
    def normalize_field_values(cls, value: object) -> object:
        if value is None:
            return None
        if not isinstance(value, dict):
            raise ValueError(INVALID_TICKET_FIELDS)
        cleaned: dict[str, str | None] = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise ValueError(INVALID_TICKET_FIELDS)
            cleaned[key] = _normalize_field_value(item)
        return cleaned


class KnowledgeSuggestionItem(BaseModel):
    document_id: str
    filename: str
    heading_path: str
    content: str


class KnowledgeSuggestionPublic(BaseModel):
    conversation_id: str
    ticket_type: TicketType | None
    business_line: BusinessLine | None
    business_line_locked: bool
    suggestions: list[KnowledgeSuggestionItem]
    empty_message: str | None


class AgentPolishCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str = Field(..., max_length=_POLISH_CONTENT_MAX_CHARS)


class AgentPolishPublic(BaseModel):
    original_content: str
    polished_content: str


def _normalize_field_value(item: Any) -> str | None:
    if item is None:
        return None
    if isinstance(item, bool):
        return "true" if item else "false"
    if isinstance(item, int | float):
        if isinstance(item, float) and item.is_integer():
            return str(int(item))
        return str(item)
    if isinstance(item, str):
        stripped = item.strip()
        return stripped or None
    raise ValueError(INVALID_TICKET_FIELDS)
