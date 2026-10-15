from __future__ import annotations

import csv
import difflib
import hashlib
import io
import json
import re
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from pycore.core.config import get_config
from pycore.core.logger import get_logger
from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    select,
    text,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from src.db.models import Base, Message, Ticket
from src.models.prompt_template import (
    ALERT_MESSAGE,
    ALERT_METRIC,
    EVAL_FILE_INVALID,
    GRAY_BLOCKED_MESSAGE,
    PLACEHOLDER_NOTES,
    TEMPLATE_NOT_FOUND,
    EvaluationSetCurrentPublic,
    EvaluationSetPublic,
    PromptTemplateListItem,
    PromptTemplatePreviewPublic,
    PromptTemplatePublic,
    PromptTemplateReleasePublic,
    PromptTemplateVersionPublic,
    PromptTemplateVersionRecord,
    PromptTemplateVersionsPublic,
    TemplateAlertPublic,
    TemplateAlertsPublic,
    TemplateMetricsPublic,
    TemplateMetricsSlice,
)
from src.repositories.ticket_repository import META_KEY, TYPE_FIELD_KEYS

logger = get_logger()

_SEED_BODY = "请结合用户情绪{{emotion}}、订单{{order}}与政策{{policy}}给出售后说明。"
_SEED_SUMMARY = "初始版本"
_HOURS_BASELINE = 24
_EMPTY_FEEDBACK = "暂无回流问题"
_FEEDBACK_RECENT = 3
_RATING_LABELS = {"useful": "有用", "useless": "无用"}
_TARGET_LABELS = {"extract": "填单", "knowledge": "知识推送", "polish": "润色"}
_OUTCOME_ADOPTED = "adopted"
_OUTCOME_MODIFIED = "modified"
_OUTCOME_DISCARDED = "discarded"
_MODIFIED_MIN_RATIO = 0.5
_CONFIRMED_STATUSES = frozenset({"pending", "in_progress", "on_hold", "completed", "closed"})
_COMPLAINT_RE = re.compile(r"投诉|消协|曝光|举报|12315")
_EVENT_COLUMNS = {
    "conversation_id": "VARCHAR(64)",
    "original_content": "TEXT",
    "polished_content": "TEXT",
    "outcome": "VARCHAR(16)",
}

_EMOTION_RULES: tuple[tuple[str, str], ...] = (
    (r"愤怒|火大|气死|怒", "愤怒"),
    (r"生气|气愤", "生气"),
    (r"着急|焦虑|担心", "着急"),
    (r"失望|不满", "失望"),
    (r"开心|满意", "开心"),
)
_ORDER_RE = re.compile(
    r"(?:订单号?|订单)\s*[:：#]?\s*([A-Za-z0-9_-]+)|(JD[A-Za-z0-9]+)",
    re.IGNORECASE,
)
_POLICY_RE = re.compile(r"七天无理由退货|七天无理由|运费险|全国联保|退换货政策|保修\d+年")
_PLACEHOLDER_MAP: dict[str, tuple[str, ...]] = {
    "emotion": ("{{emotion}}", "{{情绪}}", "{emotion}", "{情绪}"),
    "order": ("{{order}}", "{{订单}}", "{{订单信息}}", "{order}"),
    "policy": ("{{policy}}", "{{政策}}", "{{政策条款}}", "{policy}"),
}


class TemplateNotFoundError(Exception):
    def __init__(self, message: str = TEMPLATE_NOT_FOUND):
        self.message = message
        super().__init__(message)


class GrayBlockedError(Exception):
    def __init__(self, message: str = GRAY_BLOCKED_MESSAGE):
        self.message = message
        super().__init__(message)


class TemplateValidationError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class TemplateAlertError(Exception):
    def __init__(self, message: str = "告警计算失败"):
        self.message = message
        super().__init__(message)


class PromptTemplateRow(Base):
    __tablename__ = "prompt_templates"
    __table_args__ = (
        UniqueConstraint("business_line", "ticket_type", "scene", name="uq_prompt_template_key"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    business_line: Mapped[str] = mapped_column(String(32), nullable=False)
    ticket_type: Mapped[str] = mapped_column(String(32), nullable=False)
    scene: Mapped[str] = mapped_column(String(32), nullable=False)
    stable_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    gray_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    gray_percent: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    previous_stable_version: Mapped[int | None] = mapped_column(Integer, nullable=True)


class PromptTemplateVersionRow(Base):
    __tablename__ = "prompt_template_versions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    template_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("prompt_templates.id", ondelete="CASCADE"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    editor: Mapped[str] = mapped_column(String(128), nullable=False)
    edited_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    change_summary: Mapped[str] = mapped_column(Text, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)


class PromptTemplateReleaseRow(Base):
    __tablename__ = "prompt_template_releases"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    template_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("prompt_templates.id", ondelete="CASCADE"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    gray_percent: Mapped[int] = mapped_column(Integer, nullable=False)
    released_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class EvaluationSetRow(Base):
    __tablename__ = "evaluation_sets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    item_count: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class EvaluationItemRow(Base):
    __tablename__ = "evaluation_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    set_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("evaluation_sets.id", ondelete="CASCADE"), nullable=False
    )
    scene: Mapped[str] = mapped_column(String(64), nullable=False)
    input_text: Mapped[str] = mapped_column(Text, nullable=False)
    expected_json: Mapped[str] = mapped_column(Text, nullable=False)


class TemplateAlertRow(Base):
    __tablename__ = "template_alerts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    template_id: Mapped[str] = mapped_column(String(36), nullable=False)
    metric: Mapped[str] = mapped_column(String(64), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class TemplateSessionBindingRow(Base):
    __tablename__ = "template_session_bindings"
    __table_args__ = (
        UniqueConstraint("conversation_id", "template_id", name="uq_template_session_binding"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    conversation_id: Mapped[str] = mapped_column(String(64), nullable=False)
    template_id: Mapped[str] = mapped_column(String(36), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    bound_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class TemplatePolishEventRow(Base):
    __tablename__ = "template_polish_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    template_id: Mapped[str] = mapped_column(String(36), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    intercepted: Mapped[bool] = mapped_column(Boolean, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    conversation_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    original_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    polished_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    outcome: Mapped[str | None] = mapped_column(String(16), nullable=True)


def _int_cfg(key: str, default: int) -> int:
    raw = get_config().get(key, default)
    return int(raw)


def _float_cfg(key: str, default: float) -> float:
    raw = get_config().get(key, default)
    return float(raw)


def gray_bucket(conversation_id: str) -> int:
    digest = hashlib.md5(conversation_id.encode("utf-8")).hexdigest()
    return int(digest, 16) % 100


def extract_placeholders(sample_utterance: str) -> dict[str, str]:
    text = sample_utterance.strip()
    emotion = "未识别情绪"
    for pattern, label in _EMOTION_RULES:
        if re.search(pattern, text):
            emotion = label
            break
    order = "未识别订单"
    order_match = _ORDER_RE.search(text)
    if order_match:
        order = next(part for part in order_match.groups() if part)
    policy = "未识别政策"
    policy_match = _POLICY_RE.search(text)
    if policy_match:
        policy = policy_match.group(0)
    return {"emotion": emotion, "order": order, "policy": policy}


def render_placeholders(body: str, sample_utterance: str) -> str:
    values = extract_placeholders(sample_utterance)
    rendered = body
    for key, tokens in _PLACEHOLDER_MAP.items():
        replacement = values[key]
        for token in tokens:
            rendered = rendered.replace(token, replacement)
    return rendered


def _rate(total: int, hit: int) -> float:
    if total <= 0:
        return 0.0
    return hit / total


def _rate_or_none(total: int, hit: int) -> float | None:
    if total <= 0:
        return None
    return hit / total


def _reply_outcome(event: TemplatePolishEventRow, reply: str) -> str:
    sent = reply.strip()
    polished = (event.polished_content or "").strip()
    original = (event.original_content or "").strip()
    if polished and sent == polished:
        return _OUTCOME_ADOPTED
    if sent == original or not polished:
        return _OUTCOME_DISCARDED
    ratio = difflib.SequenceMatcher(None, sent, polished).ratio()
    return _OUTCOME_MODIFIED if ratio >= _MODIFIED_MIN_RATIO else _OUTCOME_DISCARDED


def _ticket_field_counts(ticket: Ticket) -> tuple[int, int]:
    """Return (fields with a value, of which auto-filled and untouched by the agent)."""
    fields = ticket.fields_json if isinstance(ticket.fields_json, dict) else {}
    keys = TYPE_FIELD_KEYS.get(ticket.ticket_type, ())
    valued = 0
    untouched = 0
    for key in keys:
        if key == META_KEY:
            continue
        item = fields.get(key)
        if not isinstance(item, dict) or item.get("value") in (None, ""):
            continue
        valued += 1
        if item.get("status") == "filled":
            untouched += 1
    return valued, untouched


def _as_dt(value: datetime | str) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed


class TemplateService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_templates(self) -> list[PromptTemplateListItem]:
        await self._ensure_seed()
        rows = (
            (
                await self.db.execute(
                    select(PromptTemplateRow).order_by(PromptTemplateRow.business_line)
                )
            )
            .scalars()
            .all()
        )
        return [self._to_list_item(row) for row in rows]

    async def get_template(self, template_id: str) -> PromptTemplatePublic:
        await self._ensure_seed()
        row = await self._get_template_row(template_id)
        latest = await self._latest_version(template_id)
        return PromptTemplatePublic(
            id=row.id,
            business_line=row.business_line,
            ticket_type=row.ticket_type,
            scene=row.scene,
            body=latest.body if latest else "",
            placeholder_notes=PLACEHOLDER_NOTES,
            stable_version=row.stable_version,
            gray_version=row.gray_version,
            gray_percent=row.gray_percent,
            latest_version=latest.version if latest else row.stable_version,
        )

    async def save_version(
        self, template_id: str, body: str, change_summary: str, editor: str
    ) -> PromptTemplateVersionPublic:
        await self._ensure_seed()
        await self._get_template_row(template_id)
        current = await self._max_version(template_id)
        version_no = current + 1
        now = datetime.now(UTC)
        row = PromptTemplateVersionRow(
            id=str(uuid4()),
            template_id=template_id,
            version=version_no,
            editor=editor,
            edited_at=now,
            change_summary=change_summary.strip(),
            body=body,
        )
        self.db.add(row)
        await self.db.flush()
        return PromptTemplateVersionPublic(
            version=row.version,
            editor=row.editor,
            edited_at=row.edited_at,
            change_summary=row.change_summary,
        )

    async def preview(self, template_id: str, sample_utterance: str) -> PromptTemplatePreviewPublic:
        await self._ensure_seed()
        latest = await self._latest_version(template_id)
        if latest is None:
            raise TemplateNotFoundError
        rendered = render_placeholders(latest.body, sample_utterance)
        logger.info("模板预览已本地替换占位", template_id=template_id)
        return PromptTemplatePreviewPublic(rendered_body=rendered)

    async def list_versions(
        self, template_id: str, from_version: int | None, to_version: int | None
    ) -> PromptTemplateVersionsPublic:
        await self._ensure_seed()
        await self._get_template_row(template_id)
        rows = (
            (
                await self.db.execute(
                    select(PromptTemplateVersionRow)
                    .where(PromptTemplateVersionRow.template_id == template_id)
                    .order_by(PromptTemplateVersionRow.version.asc())
                )
            )
            .scalars()
            .all()
        )
        versions = [
            PromptTemplateVersionRecord(
                version=item.version,
                editor=item.editor,
                edited_at=_as_dt(item.edited_at),
                change_summary=item.change_summary,
                body=item.body,
            )
            for item in rows
        ]
        diff = None
        if from_version is not None and to_version is not None:
            left = next((item for item in rows if item.version == from_version), None)
            right = next((item for item in rows if item.version == to_version), None)
            if left is None or right is None:
                raise TemplateValidationError("对比版本不存在")
            diff = "\n".join(
                difflib.unified_diff(
                    left.body.splitlines(),
                    right.body.splitlines(),
                    fromfile=f"v{from_version}",
                    tofile=f"v{to_version}",
                    lineterm="",
                )
            )
        return PromptTemplateVersionsPublic(versions=versions, diff=diff)

    async def release(
        self, template_id: str, version: int, gray_percent: int | None
    ) -> PromptTemplateReleasePublic:
        await self._ensure_seed()
        row = await self._get_template_row(template_id)
        target = await self._get_version(template_id, version)
        if await self._current_eval_items() < _int_cfg("eval_min_items", 5000):
            raise GrayBlockedError
        percent = gray_percent if gray_percent is not None else _int_cfg("template_gray_percent", 5)
        row.previous_stable_version = row.stable_version
        row.gray_version = target.version
        row.gray_percent = percent
        self.db.add(
            PromptTemplateReleaseRow(
                id=str(uuid4()),
                template_id=template_id,
                version=target.version,
                gray_percent=percent,
                released_at=datetime.now(UTC),
            )
        )
        await self.db.flush()
        return PromptTemplateReleasePublic(
            template_id=row.id,
            gray_version=row.gray_version,
            stable_version=row.stable_version,
            gray_percent=row.gray_percent,
        )

    async def rollback(
        self, template_id: str, to_version: int | None
    ) -> PromptTemplateReleasePublic:
        await self._ensure_seed()
        row = await self._get_template_row(template_id)
        if to_version is None:
            to_version = row.previous_stable_version or row.stable_version
        target = await self._get_version(template_id, to_version)
        row.stable_version = target.version
        row.gray_version = None
        row.gray_percent = 0
        await self.db.flush()
        return PromptTemplateReleasePublic(
            template_id=row.id,
            gray_version=row.gray_version,
            stable_version=row.stable_version,
            gray_percent=row.gray_percent,
        )

    async def metrics(self, template_id: str) -> TemplateMetricsPublic:
        await self._ensure_seed()
        row = await self._get_template_row(template_id)
        overall = await self._metrics_slice(template_id, version=None)
        stable = await self._metrics_slice(template_id, version=row.stable_version)
        gray = None
        if row.gray_version is not None:
            gray = await self._metrics_slice(template_id, version=row.gray_version)
        return TemplateMetricsPublic(
            extraction_accuracy=overall.extraction_accuracy,
            adoption_rate=overall.adoption_rate,
            compliance_intercept_rate=overall.compliance_intercept_rate,
            modification_rate=overall.modification_rate,
            complaint_rate=overall.complaint_rate,
            feedback_summary=await self._feedback_summary(template_id),
            stable_version=row.stable_version,
            gray_version=row.gray_version,
            stable=stable,
            gray=gray,
        )

    async def current_evaluation_set(self) -> EvaluationSetCurrentPublic:
        row = (
            (
                await self.db.execute(
                    select(EvaluationSetRow).order_by(EvaluationSetRow.created_at.desc())
                )
            )
            .scalars()
            .first()
        )
        if row is None:
            return EvaluationSetCurrentPublic(id=None, item_count=0)
        return EvaluationSetCurrentPublic(id=row.id, item_count=row.item_count)

    async def _feedback_summary(self, template_id: str) -> str:
        # ticket_attachments imports this module; import lazily to avoid a cycle.
        from src.services.ticket_attachments import ResultFeedbackRow

        rows = (
            (
                await self.db.execute(
                    select(ResultFeedbackRow)
                    .where(ResultFeedbackRow.template_id == template_id)
                    .order_by(ResultFeedbackRow.created_at.desc())
                )
            )
            .scalars()
            .all()
        )
        if not rows:
            return _EMPTY_FEEDBACK
        useless = sum(1 for row in rows if row.rating == "useless")
        recent = []
        for row in rows[:_FEEDBACK_RECENT]:
            text = _TARGET_LABELS.get(row.target, row.target) + _RATING_LABELS.get(
                row.rating, row.rating
            )
            if row.comment:
                text += f"「{row.comment}」"
            recent.append(f"{text}（v{row.template_version}）")
        return f"坐席反馈 {len(rows)} 条，其中无用 {useless} 条。最近：" + "；".join(recent)

    async def import_evaluation_set(self, filename: str, raw: bytes) -> EvaluationSetPublic:
        items = _parse_evaluation_file(filename, raw)
        if not items:
            raise TemplateValidationError(EVAL_FILE_INVALID)
        now = datetime.now(UTC)
        set_id = str(uuid4())
        self.db.add(EvaluationSetRow(id=set_id, item_count=len(items), created_at=now))
        for scene, input_text, expected in items:
            self.db.add(
                EvaluationItemRow(
                    id=str(uuid4()),
                    set_id=set_id,
                    scene=scene,
                    input_text=input_text,
                    expected_json=json.dumps(expected, ensure_ascii=False),
                )
            )
        await self.db.flush()
        return EvaluationSetPublic(id=set_id, item_count=len(items))

    async def list_alerts(self) -> TemplateAlertsPublic:
        await self._ensure_seed()
        try:
            templates = (await self.db.execute(select(PromptTemplateRow))).scalars().all()
            alerts: list[TemplateAlertPublic] = []
            for template in templates:
                if await self._should_alert(template.id):
                    alerts.append(await self._ensure_alert(template.id))
            return TemplateAlertsPublic(alerts=alerts)
        except TemplateAlertError:
            raise
        except Exception as exc:
            logger.exception("模板告警计算失败")
            raise TemplateAlertError from exc

    async def resolve_conversation_version(self, template_id: str, conversation_id: str) -> int:
        await self._ensure_seed()
        row = await self._get_template_row(template_id)
        existing = (
            await self.db.execute(
                select(TemplateSessionBindingRow).where(
                    TemplateSessionBindingRow.conversation_id == conversation_id,
                    TemplateSessionBindingRow.template_id == template_id,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            return existing.version
        if row.gray_version is not None and gray_bucket(conversation_id) < row.gray_percent:
            version = row.gray_version
        else:
            version = row.stable_version
        self.db.add(
            TemplateSessionBindingRow(
                id=str(uuid4()),
                conversation_id=conversation_id,
                template_id=template_id,
                version=version,
                bound_at=datetime.now(UTC),
            )
        )
        await self.db.flush()
        return version

    async def record_polish_event(
        self,
        template_id: str,
        version: int,
        intercepted: bool,
        created_at: datetime | None = None,
        *,
        conversation_id: str | None = None,
        original_content: str | None = None,
        polished_content: str | None = None,
    ) -> None:
        await self._ensure_seed()
        await self._get_template_row(template_id)
        if conversation_id:
            for pending in await self._pending_events(conversation_id):
                pending.outcome = _OUTCOME_DISCARDED
        self.db.add(
            TemplatePolishEventRow(
                id=str(uuid4()),
                template_id=template_id,
                version=version,
                intercepted=intercepted,
                created_at=created_at or datetime.now(UTC),
                conversation_id=conversation_id,
                original_content=original_content,
                polished_content=None if intercepted else polished_content,
                outcome=_OUTCOME_DISCARDED if intercepted else None,
            )
        )
        await self.db.flush()

    async def record_reply_outcome(self, conversation_id: str, reply: str) -> None:
        await self._ensure_seed()
        pending = await self._pending_events(conversation_id)
        if not pending:
            return
        latest = pending[-1]
        latest.outcome = _reply_outcome(latest, reply)
        for older in pending[:-1]:
            older.outcome = _OUTCOME_DISCARDED
        await self.db.flush()
        logger.info(
            "润色结果去向已记录",
            conversation_id=conversation_id,
            template_id=latest.template_id,
            outcome=latest.outcome,
        )

    async def _pending_events(self, conversation_id: str) -> list[TemplatePolishEventRow]:
        return list(
            (
                await self.db.execute(
                    select(TemplatePolishEventRow)
                    .where(
                        TemplatePolishEventRow.conversation_id == conversation_id,
                        TemplatePolishEventRow.outcome.is_(None),
                    )
                    .order_by(TemplatePolishEventRow.created_at.asc())
                )
            )
            .scalars()
            .all()
        )

    async def _ensure_event_columns(self) -> None:
        result = await self.db.execute(text("PRAGMA table_info(template_polish_events)"))
        cols = {row[1] for row in result.fetchall()}
        if not cols:
            return
        for name, sql_type in _EVENT_COLUMNS.items():
            if name not in cols:
                await self.db.execute(
                    text(f"ALTER TABLE template_polish_events ADD COLUMN {name} {sql_type}")
                )

    async def _ensure_seed(self) -> None:
        await self._ensure_event_columns()
        count = (
            await self.db.execute(select(func.count()).select_from(PromptTemplateRow))
        ).scalar_one()
        if count:
            return
        now = datetime.now(UTC)
        seeds = (
            ("digital_3c", "return_exchange", "after_sale"),
            ("apparel_beauty", "return_exchange", "after_sale"),
        )
        for business_line, ticket_type, scene in seeds:
            template_id = str(uuid4())
            self.db.add(
                PromptTemplateRow(
                    id=template_id,
                    business_line=business_line,
                    ticket_type=ticket_type,
                    scene=scene,
                    stable_version=1,
                    gray_version=None,
                    gray_percent=0,
                    previous_stable_version=None,
                )
            )
            self.db.add(
                PromptTemplateVersionRow(
                    id=str(uuid4()),
                    template_id=template_id,
                    version=1,
                    editor="system",
                    edited_at=now,
                    change_summary=_SEED_SUMMARY,
                    body=_SEED_BODY,
                )
            )
        await self.db.flush()

    async def _get_template_row(self, template_id: str) -> PromptTemplateRow:
        row = (
            await self.db.execute(
                select(PromptTemplateRow).where(PromptTemplateRow.id == template_id)
            )
        ).scalar_one_or_none()
        if row is None:
            raise TemplateNotFoundError
        return row

    async def _latest_version(self, template_id: str) -> PromptTemplateVersionRow | None:
        return (
            (
                await self.db.execute(
                    select(PromptTemplateVersionRow)
                    .where(PromptTemplateVersionRow.template_id == template_id)
                    .order_by(PromptTemplateVersionRow.version.desc())
                )
            )
            .scalars()
            .first()
        )

    async def _max_version(self, template_id: str) -> int:
        value = (
            await self.db.execute(
                select(func.max(PromptTemplateVersionRow.version)).where(
                    PromptTemplateVersionRow.template_id == template_id
                )
            )
        ).scalar_one()
        return int(value or 0)

    async def _get_version(self, template_id: str, version: int) -> PromptTemplateVersionRow:
        row = (
            await self.db.execute(
                select(PromptTemplateVersionRow).where(
                    PromptTemplateVersionRow.template_id == template_id,
                    PromptTemplateVersionRow.version == version,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            raise TemplateNotFoundError("版本不存在")
        return row

    async def _current_eval_items(self) -> int:
        return (await self.current_evaluation_set()).item_count

    async def _metrics_slice(self, template_id: str, version: int | None) -> TemplateMetricsSlice:
        stmt = select(TemplatePolishEventRow).where(
            TemplatePolishEventRow.template_id == template_id
        )
        if version is not None:
            stmt = stmt.where(TemplatePolishEventRow.version == version)
        events = (await self.db.execute(stmt)).scalars().all()
        intercepted = sum(1 for item in events if item.intercepted)
        resolved = [item for item in events if item.outcome is not None]
        adopted = sum(1 for item in resolved if item.outcome == _OUTCOME_ADOPTED)
        modified = sum(1 for item in resolved if item.outcome == _OUTCOME_MODIFIED)

        binding_stmt = select(TemplateSessionBindingRow).where(
            TemplateSessionBindingRow.template_id == template_id
        )
        if version is not None:
            binding_stmt = binding_stmt.where(TemplateSessionBindingRow.version == version)
        bindings = (await self.db.execute(binding_stmt)).scalars().all()
        conversation_ids = [item.conversation_id for item in bindings]
        valued = untouched = 0
        complained = 0
        if conversation_ids:
            tickets = (
                await self.db.execute(
                    select(Ticket).where(Ticket.conversation_id.in_(conversation_ids))
                )
            ).scalars().all()
            for ticket in tickets:
                if ticket.status in _CONFIRMED_STATUSES:
                    ticket_valued, ticket_untouched = _ticket_field_counts(ticket)
                    valued += ticket_valued
                    untouched += ticket_untouched
            bound_at = {item.conversation_id: _as_dt(item.bound_at) for item in bindings}
            messages = (
                await self.db.execute(
                    select(Message).where(
                        Message.conversation_id.in_(conversation_ids),
                        Message.role == "employee",
                    )
                )
            ).scalars().all()
            complained = len(
                {
                    message.conversation_id
                    for message in messages
                    if _as_dt(message.created_at) >= bound_at[message.conversation_id]
                    and _COMPLAINT_RE.search(message.original_content or message.content or "")
                }
            )
        return TemplateMetricsSlice(
            extraction_accuracy=_rate_or_none(valued, untouched),
            adoption_rate=_rate_or_none(len(resolved), adopted),
            compliance_intercept_rate=_rate_or_none(len(events), intercepted),
            modification_rate=_rate_or_none(len(resolved), modified),
            complaint_rate=_rate_or_none(len(set(conversation_ids)), complained),
        )

    async def _should_alert(self, template_id: str) -> bool:
        now = datetime.now(UTC)
        window = timedelta(minutes=_int_cfg("alert_window_minutes", 30))
        recent_start = now - window
        baseline_start = recent_start - timedelta(hours=_HOURS_BASELINE)
        events = (
            (
                await self.db.execute(
                    select(TemplatePolishEventRow).where(
                        TemplatePolishEventRow.template_id == template_id
                    )
                )
            )
            .scalars()
            .all()
        )
        recent = [item for item in events if _as_dt(item.created_at) >= recent_start]
        baseline = [
            item for item in events if baseline_start <= _as_dt(item.created_at) < recent_start
        ]
        if len(recent) < _int_cfg("alert_intercept_min_n", 10):
            return False
        recent_rate = _rate(len(recent), sum(1 for item in recent if item.intercepted))
        baseline_rate = _rate(len(baseline), sum(1 for item in baseline if item.intercepted))
        return (recent_rate - baseline_rate) >= _float_cfg("alert_intercept_delta", 0.20)

    async def _ensure_alert(self, template_id: str) -> TemplateAlertPublic:
        existing = (
            await self.db.execute(
                select(TemplateAlertRow).where(
                    TemplateAlertRow.template_id == template_id,
                    TemplateAlertRow.metric == ALERT_METRIC,
                )
            )
        ).scalar_one_or_none()
        if existing is None:
            existing = TemplateAlertRow(
                id=str(uuid4()),
                template_id=template_id,
                metric=ALERT_METRIC,
                message=ALERT_MESSAGE,
                created_at=datetime.now(UTC),
            )
            self.db.add(existing)
            await self.db.flush()
        return TemplateAlertPublic(
            template_id=existing.template_id,
            metric="compliance_intercept_rate",
            message=existing.message,
            created_at=_as_dt(existing.created_at),
        )

    @staticmethod
    def _to_list_item(row: PromptTemplateRow) -> PromptTemplateListItem:
        return PromptTemplateListItem(
            id=row.id,
            business_line=row.business_line,
            ticket_type=row.ticket_type,
            scene=row.scene,
            stable_version=row.stable_version,
            gray_version=row.gray_version,
            gray_percent=row.gray_percent,
        )


def _parse_evaluation_file(filename: str, raw: bytes) -> list[tuple[str, str, object]]:
    name = (filename or "").lower()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise TemplateValidationError(EVAL_FILE_INVALID) from exc
    if name.endswith(".csv"):
        return _parse_evaluation_csv(text)
    if name.endswith(".jsonl") or name.endswith(".json"):
        return _parse_evaluation_jsonl(text)
    if text.lstrip().startswith("{") or text.lstrip().startswith("["):
        return _parse_evaluation_jsonl(text)
    return _parse_evaluation_csv(text)


def _parse_evaluation_jsonl(text: str) -> list[tuple[str, str, object]]:
    items: list[tuple[str, str, object]] = []
    stripped = text.strip()
    if stripped.startswith("["):
        try:
            payload = json.loads(stripped)
        except json.JSONDecodeError as exc:
            raise TemplateValidationError(EVAL_FILE_INVALID) from exc
        if not isinstance(payload, list):
            raise TemplateValidationError(EVAL_FILE_INVALID)
        for row in payload:
            parsed = _parse_eval_mapping(row)
            if parsed is not None:
                items.append(parsed)
        return items
    for line in text.splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        parsed = _parse_eval_mapping(row)
        if parsed is not None:
            items.append(parsed)
    return items


def _parse_evaluation_csv(text: str) -> list[tuple[str, str, object]]:
    items: list[tuple[str, str, object]] = []
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        parsed = _parse_eval_mapping(row)
        if parsed is not None:
            items.append(parsed)
    return items


def _parse_eval_mapping(row: object) -> tuple[str, str, object] | None:
    if not isinstance(row, dict):
        return None
    scene = str(row.get("scene") or row.get("场景") or "").strip()
    input_text = str(row.get("input") or row.get("输入") or "").strip()
    expected = (
        row.get("expected_slots") or row.get("expected") or row.get("labels") or row.get("标签")
    )
    if not scene or not input_text or expected in (None, ""):
        return None
    return scene, input_text, expected
