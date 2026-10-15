from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

PLACEHOLDER_NOTES = (
    "可使用 {{emotion}} / {{情绪}}（用户情绪）、{{order}} / {{订单}}（订单信息）、"
    "{{policy}} / {{政策}}（政策条款）。预览用测试说法本地替换占位，"
    "不调用发出坐席回复的模型路径。"
)
GRAY_BLOCKED_MESSAGE = "没有不少于 5000 条的评测集，不能开始灰度"
TEMPLATE_NOT_FOUND = "模板不存在"
EVAL_FILE_REQUIRED = "请上传评测集文件"
EVAL_FILE_INVALID = "评测集格式无效"
ALERT_METRIC = "compliance_intercept_rate"
ALERT_MESSAGE = "合规拦截率突然升高"


class PromptTemplateListItem(BaseModel):
    id: str
    business_line: str
    ticket_type: str
    scene: str
    stable_version: int
    gray_version: int | None
    gray_percent: int


class PromptTemplatePublic(BaseModel):
    id: str
    business_line: str
    ticket_type: str
    scene: str
    body: str
    placeholder_notes: str
    stable_version: int
    gray_version: int | None
    gray_percent: int
    latest_version: int


class PromptTemplateUpdate(BaseModel):
    body: str = Field(..., min_length=1)
    change_summary: str = Field(..., min_length=1)


class PromptTemplateVersionPublic(BaseModel):
    version: int
    editor: str
    edited_at: datetime
    change_summary: str


class PromptTemplatePreviewRequest(BaseModel):
    sample_utterance: str = Field(..., min_length=1)


class PromptTemplatePreviewPublic(BaseModel):
    rendered_body: str


class PromptTemplateVersionRecord(BaseModel):
    version: int
    editor: str
    edited_at: datetime
    change_summary: str
    body: str


class PromptTemplateVersionsPublic(BaseModel):
    versions: list[PromptTemplateVersionRecord]
    diff: str | None


class PromptTemplateReleaseCreate(BaseModel):
    version: int = Field(..., ge=1)
    gray_percent: int | None = Field(default=None, ge=0, le=100)


class PromptTemplateReleasePublic(BaseModel):
    template_id: str
    gray_version: int | None
    stable_version: int
    gray_percent: int


class PromptTemplateRollback(BaseModel):
    to_version: int | None = Field(default=None, ge=1)


class TemplateMetricsSlice(BaseModel):
    """None means no samples yet; clients show it as no data rather than 0%."""

    extraction_accuracy: float | None
    adoption_rate: float | None
    compliance_intercept_rate: float | None
    modification_rate: float | None
    complaint_rate: float | None


class TemplateMetricsPublic(TemplateMetricsSlice):
    feedback_summary: str
    stable_version: int
    gray_version: int | None = None
    stable: TemplateMetricsSlice | None = None
    gray: TemplateMetricsSlice | None = None


class EvaluationSetPublic(BaseModel):
    id: str
    item_count: int


class EvaluationSetCurrentPublic(BaseModel):
    id: str | None
    item_count: int


class TemplateAlertPublic(BaseModel):
    template_id: str
    metric: Literal["compliance_intercept_rate"]
    message: str
    created_at: datetime


class TemplateAlertsPublic(BaseModel):
    alerts: list[TemplateAlertPublic]
