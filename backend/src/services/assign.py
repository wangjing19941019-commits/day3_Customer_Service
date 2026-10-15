from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from pycore.core import get_logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import Conversation, Ticket, User
from src.db.session import AppSettings, ensure_config
from src.integrations.adapters.member import MemberAdapterError, get_member_adapter
from src.repositories.conversation_repository import ConversationRepository
from src.repositories.ticket_repository import TicketRepository, join_stored, split_stored
from src.services.sla import SlaService, compute_sla_fields
from src.services.workspace_settings import WorkspaceSettingsService

logger = get_logger()

ROLE_DISPLAY = {
    "after_sales_specialist": "售后专员",
    "senior_after_sales": "高级售后专员",
    "supervisor": "主管",
    "after_sales_supervisor": "售后主管",
    "cs_lead": "客服负责人",
    "logistics_after_sales": "物流售后专员",
    "cs_supervisor": "客服主管",
    "frontline_agent": "一线坐席",
    "employee": "员工",
    "admin": "管理员",
}

_QUEUE_NORMAL = "normal"
_QUEUE_VIP = "vip_priority"
_QUEUE_HIGH_RISK = "high_risk"
_URGENCY_NORMAL = "normal"
_URGENCY_VIP = "vip"
_URGENCY_HIGH_RISK = "high_risk"
_ROLE_SPECIALIST = "after_sales_specialist"
_ROLE_SENIOR = "senior_after_sales"
_ROLE_FRONTLINE = "frontline_agent"
_ROLE_EMPLOYEE = "employee"
_HIGH_RISK_MARKERS = ("消协", "媒体", "曝光", "愤怒", "威胁")
_VIP_LEVEL_MARKERS = ("vip", "svip", "gold", "diamond", "白金", "黄金", "钻石")
_QUEUE_RANK = {_QUEUE_VIP: 0, _QUEUE_HIGH_RISK: 1, _QUEUE_NORMAL: 2}
_STATUS_HANDLERS = frozenset(
    {
        "after_sales_specialist",
        "senior_after_sales",
        "supervisor",
        "after_sales_supervisor",
        "cs_lead",
        "logistics_after_sales",
        "cs_supervisor",
        "admin",
    }
)
_LIST_ROLES = _STATUS_HANDLERS | {_ROLE_FRONTLINE}
_KIND_PROGRESS = "ticket_progress"
_DEFAULT_ON_DUTY_SECONDS = 300


class TicketQueueError(Exception):
    def __init__(self, message: str, error_code: str, status_code: int):
        self.message = message
        self.error_code = error_code
        self.status_code = status_code
        super().__init__(message)


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _field_value(item: object) -> str | None:
    if not isinstance(item, dict):
        return None
    value = item.get("value")
    if not isinstance(value, str) or not value.strip():
        return None
    return value.strip()


def _parse_amount(raw: str | None) -> float | None:
    if not raw:
        return None
    try:
        return float(raw.replace(",", "").strip())
    except (TypeError, ValueError):
        return None


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


def _int_setting(settings: AppSettings, name: str, default: int) -> int:
    raw = getattr(settings, name, None)
    if raw is None:
        try:
            from pycore.core.config import get_config

            raw = get_config().get(name, default)
        except Exception:
            raw = default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def _corpus(conversation: Conversation | None) -> str:
    if conversation is None:
        return ""
    parts: list[str] = []
    for message in conversation.messages:
        parts.append(message.original_content or message.content or "")
    return "\n".join(parts)


def _member_is_vip(member: dict[str, Any] | None) -> bool:
    if not member:
        return False
    level = member.get("level")
    if isinstance(level, str) and level.strip():
        lowered = level.strip().lower()
        if any(marker in lowered for marker in _VIP_LEVEL_MARKERS):
            return True
    if member.get("is_vip") is True:
        return True
    return False


def _member_high_risk(member: dict[str, Any] | None) -> bool:
    if not member:
        return False
    if member.get("malicious_refund"):
        return True
    count = member.get("complaint_count")
    try:
        return int(count) >= 3
    except (TypeError, ValueError):
        return False


def _text_high_risk(corpus: str) -> bool:
    if any(marker in corpus for marker in _HIGH_RISK_MARKERS):
        return True
    return corpus.count("投诉") >= 3


def queue_for(urgency: str, customer_vip: bool) -> str:
    if urgency == _URGENCY_HIGH_RISK:
        return _QUEUE_HIGH_RISK
    if urgency == _URGENCY_VIP or customer_vip:
        return _QUEUE_VIP
    return _QUEUE_NORMAL


def role_for(urgency: str) -> str:
    if urgency == _URGENCY_HIGH_RISK:
        return _ROLE_SENIOR
    return _ROLE_SPECIALIST


class AssignService:
    def __init__(self, db: AsyncSession, settings: AppSettings | None = None):
        self.db = db
        self.settings = settings or ensure_config()
        self.tickets = TicketRepository(db)
        self.conversations = ConversationRepository(db)

    async def apply_after_confirm(self, ticket: Ticket, conversation: Conversation) -> Ticket:
        stored, meta = split_stored(ticket.fields_json)
        urgency, customer_vip = await self.compute_urgency(ticket, conversation, stored)
        queue = queue_for(urgency, customer_vip)
        role = role_for(urgency)
        user = await self.find_on_duty(role)
        display = ROLE_DISPLAY.get(role, role)
        meta["urgency"] = urgency
        meta["queue"] = queue
        meta["customer_vip"] = customer_vip
        meta["assigned_role"] = role
        meta["assigned_display"] = display
        meta["upgrade_undelivered"] = False
        if user is None:
            meta["assigned_user_id"] = None
            ticket.status = "pending"
        else:
            meta["assigned_user_id"] = user.id
            ticket.status = "in_progress"
        confirmed_at = ticket.confirmed_at or datetime.now(UTC)
        exception_type = _field_value(stored.get("exception_type"))
        meta["sla"] = compute_sla_fields(
            ticket_type=ticket.ticket_type,
            urgency=urgency,
            exception_type=exception_type,
            confirmed_at=confirmed_at,
            customer_vip=customer_vip,
        )
        ticket.fields_json = join_stored(stored, meta)
        ticket = await self.tickets.save(ticket)
        logger.info(
            "工单已入队分配",
            ticket_id=ticket.id,
            urgency=urgency,
            queue=queue,
            assigned_role=role,
            has_assignee=user is not None,
        )
        return ticket

    async def compute_urgency(
        self, ticket: Ticket, conversation: Conversation, stored: dict
    ) -> tuple[str, bool]:
        corpus = _corpus(conversation)
        user_key = (
            str(conversation.created_by_user_id)
            if conversation.created_by_user_id is not None
            else conversation.id
        )
        member = await self._lookup_member(user_key)
        high_risk = _text_high_risk(corpus) or _member_high_risk(member)
        if not high_risk:
            high_risk = await self._consecutive_complaints(conversation, ticket)
        customer_vip = _member_is_vip(member)
        amount = _parse_amount(_field_value(stored.get("amount")))
        amount_urgency = await WorkspaceSettingsService(self.db).urgency_from_order_amount(amount)
        if high_risk or amount_urgency == _URGENCY_HIGH_RISK:
            return _URGENCY_HIGH_RISK, customer_vip
        if customer_vip:
            return _URGENCY_VIP, True
        return _URGENCY_NORMAL, False

    async def _lookup_member(self, user_key: str) -> dict[str, Any] | None:
        adapter = get_member_adapter(self.settings)
        try:
            return await adapter.lookup_member(user_key)
        except MemberAdapterError:
            logger.warning("会员查询失败，不标 VIP")
            return None

    async def _consecutive_complaints(self, conversation: Conversation, current: Ticket) -> bool:
        user_id = conversation.created_by_user_id
        if user_id is None:
            return False
        count = 0
        for ticket in await self.tickets.list_all():
            if ticket.ticket_type != "complaint":
                continue
            if ticket.status == "draft" and ticket.id != current.id:
                continue
            other = await self.conversations.get_by_id(ticket.conversation_id)
            if other is None or other.created_by_user_id != user_id:
                continue
            count += 1
        return count >= 3

    async def find_on_duty(self, role: str) -> User | None:
        result = await self.db.execute(select(User).where(User.role == role))
        users = list(result.scalars().all())
        seconds = _int_setting(self.settings, "on_duty_seconds", _DEFAULT_ON_DUTY_SECONDS)
        cutoff = datetime.now(UTC) - timedelta(seconds=seconds)
        for user in users:
            seen = user.last_seen_at
            if seen is None:
                continue
            seen = _as_utc(seen)
            if seen >= cutoff:
                return user
        return None

    async def list_tickets(
        self,
        user: User,
        *,
        page: int,
        page_size: int,
        ticket_type: str | None = None,
        status: str | None = None,
        urgency: str | None = None,
        order_no: str | None = None,
        user_query: str | None = None,
        ticket_no: str | None = None,
        time_from: datetime | None = None,
        time_to: datetime | None = None,
        queue: str | None = None,
    ) -> tuple[list[Ticket], int]:
        if user.role == _ROLE_EMPLOYEE:
            raise TicketQueueError("没有权限", "FORBIDDEN", 403)
        if user.role not in _LIST_ROLES:
            raise TicketQueueError("没有权限", "FORBIDDEN", 403)
        await SlaService(self.db, self.settings).scan()
        items: list[Ticket] = []
        for ticket in await self.tickets.list_all():
            if ticket.status == "draft":
                continue
            stored, meta = split_stored(ticket.fields_json)
            if ticket_type and ticket.ticket_type != ticket_type:
                continue
            if status and ticket.status != status:
                continue
            if urgency and meta.get("urgency") != urgency:
                continue
            if queue and meta.get("queue") != queue:
                continue
            if ticket_no:
                current_no = meta.get("ticket_no")
                if not isinstance(current_no, str) or ticket_no not in current_no:
                    continue
            current_order = _field_value(stored.get("order_no")) or ""
            if order_no and order_no not in current_order:
                continue
            confirmed_at = ticket.confirmed_at
            if confirmed_at is not None:
                confirmed_at = _as_utc(confirmed_at)
            if time_from is not None and (confirmed_at is None or confirmed_at < _as_utc(time_from)):
                continue
            if time_to is not None and (confirmed_at is None or confirmed_at > _as_utc(time_to)):
                continue
            if user_query:
                haystack = " ".join(
                    part
                    for part in (
                        meta.get("ticket_no") if isinstance(meta.get("ticket_no"), str) else "",
                        current_order,
                        _field_value(stored.get("intent_summary")) or "",
                        _field_value(stored.get("product_info")) or "",
                    )
                    if part
                )
                conversation = await self.conversations.get_by_id(ticket.conversation_id)
                if conversation is not None and conversation.created_by_user_id is not None:
                    owner = await self.db.execute(
                        select(User).where(User.id == conversation.created_by_user_id)
                    )
                    owner_user = owner.scalar_one_or_none()
                    if owner_user is not None:
                        haystack += " " + owner_user.username
                if user_query not in haystack:
                    continue
            items.append(ticket)
        items.sort(key=self._list_sort_key)
        total = len(items)
        offset = (page - 1) * page_size
        return items[offset : offset + page_size], total

    async def get(self, ticket_id: str, user: User) -> Ticket:
        if user.role == _ROLE_EMPLOYEE:
            raise TicketQueueError("没有权限", "FORBIDDEN", 403)
        if user.role not in _LIST_ROLES:
            raise TicketQueueError("没有权限", "FORBIDDEN", 403)
        ticket = await self.tickets.get_by_id(ticket_id)
        if ticket is None or ticket.status == "draft":
            raise TicketQueueError("工单不存在", "NOT_FOUND", 404)
        return ticket

    def _list_sort_key(self, ticket: Ticket) -> tuple:
        _stored, meta = split_stored(ticket.fields_json)
        queue = meta.get("queue") if isinstance(meta.get("queue"), str) else _QUEUE_NORMAL
        rank = _QUEUE_RANK.get(queue, 9)
        vip_in_high = 0 if (queue == _QUEUE_HIGH_RISK and meta.get("customer_vip")) else 1
        confirmed = ticket.confirmed_at
        stamp = _as_utc(confirmed).timestamp() if confirmed is not None else 0.0
        return (rank, vip_in_high, -stamp)

    async def claim(self, ticket_id: str, user: User) -> Ticket:
        if user.role in {_ROLE_FRONTLINE, _ROLE_EMPLOYEE}:
            raise TicketQueueError("没有权限", "FORBIDDEN", 403)
        ticket = await self.tickets.get_by_id(ticket_id)
        if ticket is None or ticket.status == "draft":
            raise TicketQueueError("工单不存在", "NOT_FOUND", 404)
        await SlaService(self.db, self.settings).scan()
        ticket = await self.tickets.get_by_id(ticket_id)
        if ticket is None:
            raise TicketQueueError("工单不存在", "NOT_FOUND", 404)
        stored, meta = split_stored(ticket.fields_json)
        if meta.get("assigned_user_id"):
            raise TicketQueueError("工单已有处理人", "CONFLICT", 409)
        if ticket.status not in {"pending", "in_progress"}:
            raise TicketQueueError("工单已有处理人", "CONFLICT", 409)
        urgency = meta.get("urgency")
        queue = meta.get("queue")
        if user.role == _ROLE_SPECIALIST:
            if urgency == _URGENCY_HIGH_RISK or queue == _QUEUE_HIGH_RISK:
                raise TicketQueueError("售后专员不能认领高风险工单", "CONFLICT", 409)
            if queue == _QUEUE_VIP:
                meta["queue"] = _QUEUE_VIP
            elif queue != _QUEUE_NORMAL:
                raise TicketQueueError("不属于该队列", "CONFLICT", 409)
        elif user.role == _ROLE_SENIOR:
            if queue != _QUEUE_HIGH_RISK and urgency != _URGENCY_HIGH_RISK:
                raise TicketQueueError("不属于该队列", "CONFLICT", 409)
        elif user.role not in _STATUS_HANDLERS:
            raise TicketQueueError("没有权限", "FORBIDDEN", 403)
        meta["assigned_user_id"] = user.id
        meta["assigned_role"] = user.role
        meta["assigned_display"] = ROLE_DISPLAY.get(user.role, user.username)
        meta["upgrade_undelivered"] = False
        ticket.status = "in_progress"
        ticket.fields_json = join_stored(stored, meta)
        ticket = await self.tickets.save(ticket)
        logger.info("工单已认领", ticket_id=ticket.id, user_id=user.id)
        return ticket

    async def patch(
        self,
        ticket_id: str,
        user: User,
        *,
        status: str | None,
        hold_reason: str | None,
        urgency: str | None,
    ) -> Ticket:
        if user.role == _ROLE_EMPLOYEE:
            raise TicketQueueError("没有权限", "FORBIDDEN", 403)
        ticket = await self.tickets.get_by_id(ticket_id)
        if ticket is None or ticket.status == "draft":
            raise TicketQueueError("工单不存在", "NOT_FOUND", 404)
        stored, meta = split_stored(ticket.fields_json)
        current_urgency = meta.get("urgency")
        if urgency is not None:
            ticket = await self._apply_urgency(ticket, user, stored, meta, urgency)
            stored, meta = split_stored(ticket.fields_json)
            current_urgency = meta.get("urgency")
        if status is None:
            return ticket
        if user.role == _ROLE_FRONTLINE:
            raise TicketQueueError("没有权限", "FORBIDDEN", 403)
        if user.role not in _STATUS_HANDLERS:
            raise TicketQueueError("没有权限", "FORBIDDEN", 403)
        if ticket.status == "closed" and status != "closed":
            raise TicketQueueError("已关闭工单不能改回待处理", "CONFLICT", 409)
        if status == "pending":
            raise TicketQueueError("已关闭工单不能改回待处理", "CONFLICT", 409)
        if status == "on_hold" and hold_reason not in {"wait_user", "wait_warehouse"}:
            raise TicketQueueError("参数验证失败", "VALIDATION_ERROR", 400)
        if status == "closed" and (
            current_urgency == _URGENCY_VIP or meta.get("customer_vip")
        ):
            # 用户确认已解决允许关闭；自动关闭由 SLA 拦截。此处允许人工关闭。
            pass
        previous = ticket.status
        ticket.status = status
        if status == "on_hold":
            meta["hold_reason"] = hold_reason
            reason_label = {
                "wait_user": "等用户补充",
                "wait_warehouse": "等仓储确认",
            }.get(hold_reason or "", hold_reason or "")
            detail = f"状态由{previous}变为挂起（{reason_label}）"
        else:
            if hold_reason is None and status != "on_hold":
                meta.pop("hold_reason", None)
            detail = f"状态由{previous}变为{status}"
        progress = meta.get("progress")
        if not isinstance(progress, list):
            progress = []
        progress.append(
            {
                "event": "status",
                "at": datetime.now(UTC).isoformat(),
                "detail": detail,
                "hold_reason": hold_reason,
            }
        )
        meta["progress"] = progress
        ticket.fields_json = join_stored(stored, meta)
        ticket = await self.tickets.save(ticket)
        conversation = await self.conversations.get_by_id(ticket.conversation_id)
        if conversation is not None:
            await self.conversations.add_message(
                conversation,
                role="system",
                kind=_KIND_PROGRESS,
                content=detail,
            )
            loaded = await self.conversations.get_by_id(conversation.id)
            if loaded is None:
                raise TicketQueueError("会话不存在", "NOT_FOUND", 404)
        return ticket

    async def _apply_urgency(
        self,
        ticket: Ticket,
        user: User,
        stored: dict,
        meta: dict,
        urgency: str,
    ) -> Ticket:
        current = meta.get("urgency") or _URGENCY_NORMAL
        rank = {_URGENCY_NORMAL: 0, _URGENCY_VIP: 1, _URGENCY_HIGH_RISK: 2}
        if urgency not in rank:
            raise TicketQueueError("参数验证失败", "VALIDATION_ERROR", 400)
        if rank[urgency] < rank.get(current, 0):
            if current == _URGENCY_HIGH_RISK:
                raise TicketQueueError("下调高风险须主管同意", "CONFLICT", 409)
            raise TicketQueueError("下调高风险须主管同意", "CONFLICT", 409)
        if user.role == _ROLE_FRONTLINE and rank[urgency] <= rank.get(current, 0):
            raise TicketQueueError("下调高风险须主管同意", "CONFLICT", 409)
        meta["urgency"] = urgency
        customer_vip = bool(meta.get("customer_vip")) or urgency == _URGENCY_VIP
        meta["queue"] = queue_for(urgency, customer_vip)
        role = role_for(urgency)
        user_on_duty = await self.find_on_duty(role)
        meta["assigned_role"] = role
        meta["assigned_display"] = ROLE_DISPLAY.get(role, role)
        if user_on_duty is None:
            meta["assigned_user_id"] = None
            ticket.status = "pending"
        else:
            meta["assigned_user_id"] = user_on_duty.id
            ticket.status = "in_progress" if ticket.status != "on_hold" else ticket.status
        exception_type = _field_value(stored.get("exception_type"))
        confirmed_at = ticket.confirmed_at or datetime.now(UTC)
        meta["sla"] = compute_sla_fields(
            ticket_type=ticket.ticket_type,
            urgency=urgency,
            exception_type=exception_type,
            confirmed_at=confirmed_at,
            customer_vip=customer_vip,
        )
        ticket.fields_json = join_stored(stored, meta)
        return await self.tickets.save(ticket)

    async def approve_urgency(
        self, ticket_id: str, user: User, *, approved: bool, target_urgency: str
    ) -> Ticket:
        if user.role != "supervisor":
            raise TicketQueueError("没有权限", "FORBIDDEN", 403)
        if target_urgency not in {_URGENCY_NORMAL, _URGENCY_VIP}:
            raise TicketQueueError("参数验证失败", "VALIDATION_ERROR", 400)
        ticket = await self.tickets.get_by_id(ticket_id)
        if ticket is None or ticket.status == "draft":
            raise TicketQueueError("工单不存在", "NOT_FOUND", 404)
        stored, meta = split_stored(ticket.fields_json)
        if meta.get("urgency") != _URGENCY_HIGH_RISK:
            raise TicketQueueError("当前不是高风险", "CONFLICT", 409)
        if not approved:
            return ticket
        meta["urgency"] = target_urgency
        customer_vip = bool(meta.get("customer_vip")) or target_urgency == _URGENCY_VIP
        meta["customer_vip"] = customer_vip
        meta["queue"] = queue_for(target_urgency, customer_vip)
        role = role_for(target_urgency)
        on_duty = await self.find_on_duty(role)
        meta["assigned_role"] = role
        meta["assigned_display"] = ROLE_DISPLAY.get(role, role)
        if on_duty is None:
            meta["assigned_user_id"] = None
            ticket.status = "pending"
        else:
            meta["assigned_user_id"] = on_duty.id
            ticket.status = "in_progress"
        exception_type = _field_value(stored.get("exception_type"))
        confirmed_at = ticket.confirmed_at or datetime.now(UTC)
        meta["sla"] = compute_sla_fields(
            ticket_type=ticket.ticket_type,
            urgency=target_urgency,
            exception_type=exception_type,
            confirmed_at=confirmed_at,
            customer_vip=customer_vip,
        )
        ticket.fields_json = join_stored(stored, meta)
        ticket = await self.tickets.save(ticket)
        logger.info("高风险降级已审批", ticket_id=ticket.id, target=target_urgency)
        return ticket


def ticket_list_payload(ticket: Ticket) -> dict[str, Any]:
    stored, meta = split_stored(ticket.fields_json)
    sla = meta.get("sla") if isinstance(meta.get("sla"), dict) else {}
    return {
        "id": ticket.id,
        "ticket_no": meta.get("ticket_no") if isinstance(meta.get("ticket_no"), str) else None,
        "ticket_type": ticket.ticket_type,
        "status": ticket.status,
        "urgency": meta.get("urgency") if isinstance(meta.get("urgency"), str) else None,
        "queue": meta.get("queue") if isinstance(meta.get("queue"), str) else None,
        "order_no": _field_value(stored.get("order_no")),
        "assigned_display": (
            meta.get("assigned_display")
            if isinstance(meta.get("assigned_display"), str)
            else None
        ),
        "upgrade_undelivered": bool(meta.get("upgrade_undelivered")),
        "confirmed_at": _as_utc(ticket.confirmed_at) if ticket.confirmed_at else None,
        "sla_due_at": _parse_dt(sla.get("due_at")),
        "updated_at": _as_utc(ticket.updated_at) if ticket.updated_at else None,
    }
