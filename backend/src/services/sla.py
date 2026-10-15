from __future__ import annotations

import json
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from typing import Any

from pycore.core import get_logger
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import Conversation, Ticket
from src.db.session import AppSettings, ensure_config
from src.repositories.conversation_repository import ConversationRepository
from src.repositories.ticket_repository import TicketRepository, join_stored, split_stored

logger = get_logger()

# 时效档只转录 PRD REQ-010 / tech-spec「时效档」，禁止改数字。
SLA_RULES: dict[str, Any] = {
    "normal": {
        "address_change": {
            "due_hours": 2,
            "warn_before_hours": 0.5,
            "escalate_role": "supervisor",
            "close_after_warn_hours": 24,
        },
        "invoice": {
            "due_hours": 2,
            "warn_before_hours": 0.5,
            "escalate_role": "supervisor",
            "close_after_warn_hours": 24,
        },
        "return_exchange": {
            "due_hours": 24,
            "warn_before_hours": 4,
            "escalate_role": "after_sales_supervisor",
            "close_after_warn_hours": 48,
        },
        "fee_dispute": {
            "due_hours": 24,
            "warn_before_hours": 4,
            "escalate_role": "senior_after_sales",
            "close_after_warn_hours": 48,
        },
        "complaint": {
            "due_hours": 48,
            "warn_before_hours": 8,
            "escalate_role": "cs_lead",
            "close_after_warn_hours": 72,
        },
        "logistics_exception": {
            "delay": {
                "due_hours": 24,
                "warn_before_hours": 4,
                "escalate_role": "after_sales_specialist",
                "close_after_warn_hours": 24,
            },
            "wrong_or_missing": {
                "due_hours": 24,
                "warn_before_hours": 4,
                "escalate_role": "after_sales_specialist",
                "close_after_warn_hours": 24,
            },
            "refused": {
                "due_hours": 24,
                "warn_before_hours": 4,
                "escalate_role": "after_sales_specialist",
                "close_after_warn_hours": 24,
            },
            "lost": {
                "due_hours": 48,
                "warn_before_hours": 12,
                "escalate_role": "after_sales_specialist",
                "close_after_warn_hours": 48,
            },
            "damaged": {
                "due_hours": 48,
                "warn_before_hours": 12,
                "escalate_role": "after_sales_specialist",
                "close_after_warn_hours": 48,
            },
            "address_exception": {
                "due_hours": 12,
                "warn_before_hours": 2,
                "escalate_role": "after_sales_specialist",
                "close_after_warn_hours": 12,
            },
        },
    },
    "vip": {
        "address_change": {
            "due_hours": 0.5,
            "warn_before_hours": 10 / 60,
            "escalate_role": "supervisor",
            "close_after_warn_hours": None,
        },
        "invoice": {
            "due_hours": 0.5,
            "warn_before_hours": 10 / 60,
            "escalate_role": "supervisor",
            "close_after_warn_hours": None,
        },
        "return_exchange": {
            "due_hours": 4,
            "warn_before_hours": 1,
            "escalate_role": "after_sales_supervisor",
            "close_after_warn_hours": None,
        },
        "fee_dispute": {
            "due_hours": 2,
            "warn_before_hours": 0.5,
            "escalate_role": "senior_after_sales",
            "close_after_warn_hours": None,
        },
        "complaint": {
            "due_hours": 4,
            "warn_before_hours": 1,
            "escalate_role": "cs_lead",
            "close_after_warn_hours": None,
        },
        "logistics_exception": {
            "delay": {
                "due_hours": 12,
                "warn_before_hours": 3,
                "escalate_role": "logistics_after_sales",
                "l2_role": "cs_supervisor",
                "l2_wait_hours": 2,
                "close_after_warn_hours": None,
            },
            "wrong_or_missing": {
                "due_hours": 12,
                "warn_before_hours": 3,
                "escalate_role": "logistics_after_sales",
                "l2_role": "cs_supervisor",
                "l2_wait_hours": 2,
                "close_after_warn_hours": None,
            },
            "refused": {
                "due_hours": 12,
                "warn_before_hours": 3,
                "escalate_role": "logistics_after_sales",
                "l2_role": "cs_supervisor",
                "l2_wait_hours": 2,
                "close_after_warn_hours": None,
            },
            "lost": {
                "due_hours": 24,
                "warn_before_hours": 8,
                "escalate_role": "logistics_after_sales",
                "l2_role": "cs_supervisor",
                "l2_wait_hours": 2,
                "close_after_warn_hours": None,
            },
            "damaged": {
                "due_hours": 24,
                "warn_before_hours": 8,
                "escalate_role": "logistics_after_sales",
                "l2_role": "cs_supervisor",
                "l2_wait_hours": 2,
                "close_after_warn_hours": None,
            },
            "address_exception": {
                "due_hours": 6,
                "warn_before_hours": 1.5,
                "escalate_role": "logistics_after_sales",
                "l2_role": "cs_supervisor",
                "l2_wait_hours": 2,
                "close_after_warn_hours": None,
            },
        },
    },
}

_VIP_LOGISTICS_L2_WAIT_HOURS = 2
_KIND_PROGRESS = "ticket_progress"
_ROLE_SYSTEM = "system"
_ROLE_EMPLOYEE = "employee"
_CLOSE_NOTICE_MARK = "关闭预告"
_IMMEDIATE_L2_MARKERS = ("威胁", "曝光", "消协", "不接受", "拒绝一级", "无法处理", "权限不够", "需要主管")
_CONFIRMED = frozenset({"pending", "in_progress", "on_hold", "completed"})


def _hours_delta(hours: float | int | None) -> timedelta | None:
    if hours is None:
        return None
    return timedelta(minutes=round(float(hours) * 60))


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _parse_dt(value: object) -> datetime | None:
    if isinstance(value, datetime):
        return _as_utc(value)
    if isinstance(value, str) and value.strip():
        text = value.strip().replace("Z", "+00:00")
        try:
            return _as_utc(datetime.fromisoformat(text))
        except ValueError:
            return None
    return None


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return _as_utc(value).isoformat()


def _field_value(item: object) -> str | None:
    if not isinstance(item, dict):
        return None
    value = item.get("value")
    if not isinstance(value, str) or not value.strip():
        return None
    return value.strip()


def _config_sla_rules() -> object:
    settings = ensure_config()
    raw = getattr(settings, "sla_rules", None)
    if raw in (None, "", {}, []):
        try:
            from pycore.core.config import get_config

            raw = get_config().get("sla_rules", {})
        except Exception:
            raw = {}
    if isinstance(raw, str) and raw.strip():
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            raw = {}
    return raw


def effective_sla_rules() -> dict[str, Any]:
    rules = deepcopy(SLA_RULES)
    overlay = _config_sla_rules()
    if isinstance(overlay, dict) and overlay:
        _deep_merge(rules, overlay)
    return rules


def _deep_merge(base: dict, overlay: dict) -> None:
    for key, value in overlay.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _deep_merge(base[key], value)
        else:
            base[key] = value


def lookup_rule(
    ticket_type: str | None,
    urgency: str | None,
    exception_type: str | None,
    *,
    customer_vip: bool = False,
) -> dict[str, Any] | None:
    band = "vip" if urgency == "vip" or customer_vip else "normal"
    rules = effective_sla_rules().get(band) or {}
    if ticket_type == "logistics_exception":
        group = rules.get("logistics_exception") or {}
        if not isinstance(group, dict):
            return None
        picked = group.get(exception_type or "")
        if isinstance(picked, dict):
            return picked
        return None
    picked = rules.get(ticket_type or "")
    return picked if isinstance(picked, dict) else None


def compute_sla_fields(
    *,
    ticket_type: str | None,
    urgency: str | None,
    exception_type: str | None,
    confirmed_at: datetime,
    customer_vip: bool = False,
) -> dict[str, Any]:
    confirmed_at = _as_utc(confirmed_at)
    rule = lookup_rule(ticket_type, urgency, exception_type, customer_vip=customer_vip)
    if rule is None:
        return {
            "due_at": None,
            "warn_at": None,
            "close_after": None,
            "level": 0,
            "warned": False,
            "escalated": False,
        }
    due_delta = _hours_delta(rule.get("due_hours"))
    warn_before = _hours_delta(rule.get("warn_before_hours"))
    close_after_warn = _hours_delta(rule.get("close_after_warn_hours"))
    due_at = confirmed_at + due_delta if due_delta is not None else None
    warn_at = due_at - warn_before if due_at is not None and warn_before is not None else None
    vip_like = band_is_vip(urgency, customer_vip)
    close_after = None if vip_like or close_after_warn is None or warn_at is None else warn_at + close_after_warn
    payload = {
        "due_at": _iso(due_at),
        "warn_at": _iso(warn_at),
        "close_after": _iso(close_after),
        "level": 0,
        "warned": False,
        "escalated": False,
        "escalate_role": rule.get("escalate_role"),
        "l2_role": rule.get("l2_role"),
        "l2_wait_hours": rule.get("l2_wait_hours", _VIP_LOGISTICS_L2_WAIT_HOURS),
    }
    return payload


def band_is_vip(urgency: str | None, customer_vip: bool) -> bool:
    return urgency == "vip" or customer_vip


def _append_progress(meta: dict, event: str, at: datetime, detail: str) -> None:
    progress = meta.get("progress")
    if not isinstance(progress, list):
        progress = []
    progress.append({"event": event, "at": _iso(at), "detail": detail})
    meta["progress"] = progress


class SlaService:
    def __init__(self, db: AsyncSession, settings: AppSettings | None = None):
        self.db = db
        self.settings = settings or ensure_config()
        self.tickets = TicketRepository(db)
        self.conversations = ConversationRepository(db)

    async def scan(self, now: datetime | None = None) -> int:
        now = _as_utc(now or datetime.now(UTC))
        changed = 0
        for ticket in await self.tickets.list_all():
            if ticket.status not in _CONFIRMED:
                continue
            if await self.apply_ticket(ticket, now):
                changed += 1
        if changed:
            logger.info("SLA 扫描已处理工单", count=changed)
        return changed

    async def apply_ticket(self, ticket: Ticket, now: datetime) -> bool:
        from src.services.assign import AssignService, ROLE_DISPLAY

        now = _as_utc(now)
        stored, meta = split_stored(ticket.fields_json)
        sla = meta.get("sla")
        if not isinstance(sla, dict) or not sla.get("due_at"):
            return False
        if ticket.status == "closed":
            return False
        urgency = meta.get("urgency") if isinstance(meta.get("urgency"), str) else None
        customer_vip = bool(meta.get("customer_vip")) or urgency == "vip"
        warn_at = _parse_dt(sla.get("warn_at"))
        due_at = _parse_dt(sla.get("due_at"))
        close_after = _parse_dt(sla.get("close_after"))
        changed = False
        conversation = await self.conversations.get_by_id(ticket.conversation_id)

        if warn_at is not None and now >= warn_at and not sla.get("warned"):
            sla["warned"] = True
            _append_progress(meta, "warned", now, "处理时限前预警")
            await self._write_progress(conversation, "工单即将到达处理时限，请尽快处理。")
            changed = True

        if due_at is not None and now >= due_at and not sla.get("escalated"):
            role = sla.get("escalate_role")
            if isinstance(role, str) and role:
                assigner = AssignService(self.db, self.settings)
                user = await assigner.find_on_duty(role)
                meta["assigned_role"] = role
                meta["assigned_display"] = ROLE_DISPLAY.get(role, role)
                if user is None:
                    meta["assigned_user_id"] = None
                    meta["upgrade_undelivered"] = True
                else:
                    meta["assigned_user_id"] = user.id
                    meta["upgrade_undelivered"] = False
                    meta["assigned_display"] = ROLE_DISPLAY.get(role, role)
                sla["escalated"] = True
                sla["level"] = max(int(sla.get("level") or 0), 1)
                sla["escalated_at"] = _iso(now)
                if ticket.status == "pending":
                    ticket.status = "in_progress" if user is not None else "pending"
                _append_progress(meta, "escalated", now, f"已升级至{ROLE_DISPLAY.get(role, role)}")
                await self._write_progress(
                    conversation, f"工单已升级至{ROLE_DISPLAY.get(role, role)}。"
                )
                changed = True
                if (
                    ticket.ticket_type == "logistics_exception"
                    and customer_vip
                    and self._has_compensation(stored)
                ):
                    await self._escalate_l2(ticket, meta, sla, assigner, now, conversation)
                    changed = True

        if (
            due_at is not None
            and now >= due_at
            and not customer_vip
            and not sla.get("close_notice_sent")
        ):
            sla["close_notice_sent"] = True
            _append_progress(meta, "close_notice", now, "已向用户发出关闭预告")
            await self._write_progress(
                conversation,
                "关闭预告：本单已过处理时限，若后续无新说明将按规则关闭。",
            )
            changed = True

        if (
            ticket.ticket_type == "logistics_exception"
            and customer_vip
            and sla.get("escalated")
            and int(sla.get("level") or 0) < 2
        ):
            assigner = AssignService(self.db, self.settings)
            if self._should_immediate_l2(conversation, sla, due_at, now) or self._has_compensation(
                stored
            ):
                await self._escalate_l2(ticket, meta, sla, assigner, now, conversation)
                changed = True
            elif self._l2_wait_elapsed(sla, now):
                await self._escalate_l2(ticket, meta, sla, assigner, now, conversation)
                changed = True

        if customer_vip:
            meta["sla"] = sla
            if changed:
                ticket.fields_json = join_stored(stored, meta)
                await self.tickets.save(ticket)
            return changed

        if (
            close_after is not None
            and now >= close_after
            and ticket.status not in {"closed", "completed"}
        ):
            if self._may_auto_close(conversation, meta, close_notice_after=warn_at):
                ticket.status = "closed"
                _append_progress(meta, "closed", now, "已到可关闭时间，自动关闭")
                await self._write_progress(conversation, "工单已关闭。")
                changed = True
            else:
                _append_progress(meta, "close_skipped", now, "未满足自动关闭条件")
                changed = True

        if changed:
            meta["sla"] = sla
            ticket.fields_json = join_stored(stored, meta)
            await self.tickets.save(ticket)
        return changed

    async def _escalate_l2(
        self,
        ticket: Ticket,
        meta: dict,
        sla: dict,
        assigner: Any,
        now: datetime,
        conversation: Conversation | None,
    ) -> None:
        from src.services.assign import ROLE_DISPLAY

        role = sla.get("l2_role") or "cs_supervisor"
        user = await assigner.find_on_duty(role)
        meta["assigned_role"] = role
        meta["assigned_display"] = ROLE_DISPLAY.get(role, role)
        if user is None:
            meta["assigned_user_id"] = None
            meta["upgrade_undelivered"] = True
        else:
            meta["assigned_user_id"] = user.id
            meta["upgrade_undelivered"] = False
        sla["level"] = 2
        sla["l2_at"] = _iso(now)
        _append_progress(meta, "escalated_l2", now, f"已升至{ROLE_DISPLAY.get(role, role)}")
        await self._write_progress(conversation, f"工单已升级至{ROLE_DISPLAY.get(role, role)}。")

    def _has_compensation(self, stored: dict) -> bool:
        plan = _field_value(stored.get("compensation_plan"))
        if not plan:
            return False
        if any(marker in plan for marker in ("不涉及", "无赔付", "暂无", "无补偿")):
            return False
        return True

    def _should_immediate_l2(
        self,
        conversation: Conversation | None,
        sla: dict,
        due_at: datetime | None,
        now: datetime,
    ) -> bool:
        # Only while still before due: less than l2_wait hours remaining.
        # Past-due VIP logistics without compensation stays on L1 until wait elapses.
        if due_at is not None:
            remaining = due_at - now
            wait = _hours_delta(_VIP_LOGISTICS_L2_WAIT_HOURS)
            if wait is not None and remaining > timedelta(0) and remaining <= wait:
                return True
        corpus = _conversation_text(conversation)
        return any(marker in corpus for marker in _IMMEDIATE_L2_MARKERS)

    def _l2_wait_elapsed(self, sla: dict, now: datetime) -> bool:
        started = _parse_dt(sla.get("escalated_at"))
        if started is None:
            return False
        wait = sla.get("l2_wait_hours", _VIP_LOGISTICS_L2_WAIT_HOURS)
        delta = _hours_delta(wait)
        return delta is not None and now >= started + delta

    def _may_auto_close(
        self,
        conversation: Conversation | None,
        meta: dict,
        close_notice_after: datetime | None,
    ) -> bool:
        if meta.get("hold_reason") == "wait_user":
            return False
        if conversation is None:
            return False
        messages = sorted(conversation.messages, key=lambda item: _as_utc(item.created_at))
        notice = None
        for message in messages:
            if message.kind == _KIND_PROGRESS and _CLOSE_NOTICE_MARK in (message.content or ""):
                notice = message
            elif _CLOSE_NOTICE_MARK in (message.content or ""):
                notice = message
        if notice is None:
            return False
        notice_at = _as_utc(notice.created_at)
        if close_notice_after is not None and notice_at < close_notice_after:
            pass
        for message in messages:
            if _as_utc(message.created_at) <= notice_at:
                continue
            if message.role == _ROLE_EMPLOYEE:
                return False
        return True

    async def _write_progress(self, conversation: Conversation | None, content: str) -> None:
        if conversation is None:
            return
        await self.conversations.add_message(
            conversation,
            role=_ROLE_SYSTEM,
            kind=_KIND_PROGRESS,
            content=content,
        )
        loaded = await self.conversations.get_by_id(conversation.id)
        if loaded is not None:
            conversation.messages = loaded.messages


def _conversation_text(conversation: Conversation | None) -> str:
    if conversation is None:
        return ""
    parts: list[str] = []
    for message in conversation.messages:
        text = message.original_content or message.content or ""
        parts.append(text)
    return "\n".join(parts)
