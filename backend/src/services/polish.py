from __future__ import annotations

import re
from pathlib import Path
from typing import Protocol

from pycore.core.logger import get_logger
from pydantic import BaseModel
from sqlalchemy import select

from src.db.models import Conversation, Message, Ticket
from src.db.session import AppSettings, ensure_config
from src.integrations.bailian import BailianClient, BailianError
from src.repositories.conversation_repository import ConversationRepository
from src.repositories.ticket_repository import META_KEY, TicketRepository
from src.services.handoff import ConversationNotFoundError, _sorted_messages
from src.services.ingest import has_llm_key
from src.services.templates import (
    PromptTemplateRow,
    PromptTemplateVersionRow,
    TemplateService,
    render_placeholders,
)

logger = get_logger()

_STATUS_HANDED_OFF = "handed_off"
_UNAVAILABLE = "服务暂时不可用，请稍后重试。"
_NOT_HANDED_OFF = "会话尚未转人工"
_EMPTY_CONTENT = "请输入回复内容"
_TOO_LONG = "回复内容不能超过 4000 字"
_CONTENT_MAX_CHARS = 4000
_UNLOCKED_LINE_HINT = "未锁定业务线，不要使用 3C 或服饰专属承诺"
_ROLE_LABELS = {"employee": "用户", "agent": "坐席（已发出）", "system": "系统"}
_POLISH_BOUNDARY = (
    "要求：只润色上面的坐席拟发送稿。会话中坐席已发出的回复不要复述或并入；"
    "原稿和会话都没有提到的政策名称、保修承诺和处理进度不要补充。"
)
_PRE_SALE_LABEL = "售前咨询（未建工单）"
_PRE_SALE_BOUNDARY = (
    "当前是售前咨询：只回答购买前的问题（尺码、规格、色号、是否适合等）；"
    "原稿没有提到的退换货、售后、退款规则不要补充。"
)
_TYPE_LABELS = {
    "return_exchange": "退换货",
    "address_change": "修改地址",
    "invoice": "发票",
    "complaint": "投诉维权",
    "fee_dispute": "费用争议",
    "logistics_exception": "物流异常",
}
_LINE_LABELS = {
    "digital_3c": "3C 数码",
    "apparel_beauty": "服饰美妆",
}
_LINE_PROMPTS = {
    "digital_3c": "line_digital_3c.md",
    "apparel_beauty": "line_apparel_beauty.md",
}
_HIGH_RISK_TYPES = frozenset({"fee_dispute", "logistics_exception", "complaint"})
_SIGNED_STATUSES = frozenset({"signed", "已签收", "签收"})
_PROMPT_DIR = Path(__file__).resolve().parent.parent / "prompts" / "ticket"
_DAY_RE = re.compile(r"(\d+)\s*天")
_AMOUNT_RE = re.compile(r"(?:¥|￥)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*元")
_PLEDGE_RE = re.compile(r"一定全额退|一定退款|一定退")
_PAYOUT_RE = re.compile(r"赔付|赔偿")
_PRICE_CHANGE_RE = re.compile(r"改价")
_POLICY_NAMES = ("七天无理由", "全国联保", "只换不修", "运费险")
_ANGER_RE = re.compile(r"愤怒|火大|气死|气愤|太过分|投诉你们|怒")
_CHEERFUL_RE = re.compile(r"哈哈|亲[，,]|么么哒|开心呢|嘻嘻")
_NEW_PAYOUT_REASON = "润色稿新增了会话中不存在的赔付金额"
_NEW_PLEDGE_REASON = "润色稿出现了原稿或会话未承诺的退款保证"
_CHANGED_DEADLINE_REASON = "润色稿改写了时效"
_DROPPED_AMOUNT_REASON = "润色稿删掉了原稿中的金额"
_CHANGED_POLICY_REASON = "润色稿改写了政策名称"
_PRICE_CHANGE_REASON = "润色稿新增了改价承诺"
_CHEERFUL_REASON = "用户表达愤怒时润色稿使用了轻快语气"

_llm_override: PolishLlmClient | None = None


class PolishLlmClient(Protocol):
    async def chat_completions(
        self, messages: list[dict[str, str]], *, json_object: bool = False
    ) -> str: ...


class PolishConflictError(Exception):
    def __init__(self, message: str = _NOT_HANDED_OFF):
        self.message = message
        super().__init__(message)


class PolishValidationError(Exception):
    def __init__(self, message: str = _EMPTY_CONTENT):
        self.message = message
        super().__init__(message)


class PolishUnavailableError(Exception):
    def __init__(self, message: str = _UNAVAILABLE):
        self.message = message
        super().__init__(message)


class AgentPolishPublic(BaseModel):
    original_content: str
    polished_content: str
    compliance_passed: bool
    can_adopt: bool
    risk_reasons: list[str]


def set_polish_llm_override(client: PolishLlmClient | None) -> None:
    global _llm_override
    _llm_override = client


def _normalize_content(content: str) -> str:
    stripped = content.strip()
    if not stripped:
        raise PolishValidationError(_EMPTY_CONTENT)
    if len(stripped) > _CONTENT_MAX_CHARS:
        raise PolishValidationError(_TOO_LONG)
    return stripped


def _message_text(message: Message) -> str:
    if message.role == "employee":
        text = message.original_content or message.content
    else:
        text = message.content
    return text or ""


def _conversation_prompt(conversation: Conversation, limit: int) -> str:
    lines: list[str] = []
    for message in _sorted_messages(conversation)[-limit:]:
        text = _message_text(message).strip()
        if text:
            lines.append(f"{_ROLE_LABELS.get(message.role, message.role)}: {text}")
    return "\n".join(lines) if lines else "（当前会话没有消息）"


def _conversation_plain(conversation: Conversation, limit: int) -> str:
    parts: list[str] = []
    for message in _sorted_messages(conversation)[-limit:]:
        text = _message_text(message).strip()
        if text:
            parts.append(text)
    return "\n".join(parts)


def _read_prompt(name: str) -> str:
    return (_PROMPT_DIR / name).read_text(encoding="utf-8")


def _amounts(text: str) -> set[str]:
    found: set[str] = set()
    for match in _AMOUNT_RE.finditer(text or ""):
        value = match.group(1) or match.group(2)
        if value:
            found.add(value)
    return found


def _days(text: str) -> set[str]:
    return {match.group(1) for match in _DAY_RE.finditer(text or "")}


def _policies(text: str) -> set[str]:
    return {name for name in _POLICY_NAMES if name in (text or "")}


def _sign_status(ticket: Ticket | None) -> str | None:
    if ticket is None or not isinstance(ticket.fields_json, dict):
        return None
    meta = ticket.fields_json.get(META_KEY)
    if not isinstance(meta, dict):
        return None
    snapshot = meta.get("logistics_snapshot")
    if not isinstance(snapshot, dict):
        return None
    status = snapshot.get("sign_status")
    if isinstance(status, str) and status.strip():
        return status.strip()
    return None


def _template_scene(ticket_type: str | None, ticket: Ticket | None) -> str:
    if ticket_type == "logistics_exception":
        status = _sign_status(ticket)
        if status in _SIGNED_STATUSES:
            return "after_sale"
        return "in_transit"
    if not ticket_type:
        return "pre_sale"
    return "after_sale"


def _is_high_risk(ticket_type: str | None, allowed_text: str) -> bool:
    if ticket_type in _HIGH_RISK_TYPES:
        return True
    return bool(re.search(r"消协|曝光|媒体|高风险", allowed_text))


def check_compliance(
    original: str,
    polished: str,
    conversation_text: str,
    *,
    ticket_type: str | None,
) -> tuple[bool, list[str]]:
    allowed = f"{original}\n{conversation_text}"
    reasons: list[str] = []
    new_amounts = _amounts(polished) - _amounts(allowed)
    high_risk = _is_high_risk(ticket_type, allowed)
    if new_amounts:
        reasons.append(_NEW_PAYOUT_REASON)
    elif high_risk and _PAYOUT_RE.search(polished) and not _PAYOUT_RE.search(allowed):
        reasons.append(_NEW_PAYOUT_REASON)
    if _amounts(original) - _amounts(polished):
        reasons.append(_DROPPED_AMOUNT_REASON)
    if _PLEDGE_RE.search(polished) and not _PLEDGE_RE.search(allowed):
        reasons.append(_NEW_PLEDGE_REASON)
    if _PRICE_CHANGE_RE.search(polished) and not _PRICE_CHANGE_RE.search(allowed):
        reasons.append(_PRICE_CHANGE_REASON)
    if _days(polished) - _days(allowed):
        reasons.append(_CHANGED_DEADLINE_REASON)
    if _policies(polished) - _policies(allowed):
        reasons.append(_CHANGED_POLICY_REASON)
    if _ANGER_RE.search(conversation_text) and _CHEERFUL_RE.search(polished):
        reasons.append(_CHEERFUL_REASON)
    unique = list(dict.fromkeys(reasons))
    return (not unique, unique)


def _system_prompt(business_line: str | None, template_body: str | None) -> str:
    parts = [_read_prompt("polish.md")]
    line_file = _LINE_PROMPTS.get(business_line or "")
    if line_file:
        parts.append(_read_prompt(line_file))
    if template_body:
        parts.append(template_body)
    return "\n\n".join(parts)


def _user_prompt(
    content: str,
    conversation: Conversation,
    *,
    ticket_type: str | None,
    business_line: str | None,
    limit: int,
) -> str:
    type_label = _TYPE_LABELS.get(ticket_type or "") or _PRE_SALE_LABEL
    if business_line in _LINE_LABELS:
        line_label = _LINE_LABELS[business_line]
    else:
        line_label = _UNLOCKED_LINE_HINT
    boundary = _POLISH_BOUNDARY if ticket_type else f"{_PRE_SALE_BOUNDARY}\n{_POLISH_BOUNDARY}"
    return (
        f"坐席拟发送稿：\n{content}\n\n"
        f"当前工单类型：{type_label}\n"
        f"当前业务线：{line_label}\n\n"
        f"当前会话（仅供理解背景）：\n{_conversation_prompt(conversation, limit)}\n\n"
        f"{boundary}"
    )


class PolishService:
    def __init__(
        self,
        repo: ConversationRepository,
        settings: AppSettings | None = None,
        llm: PolishLlmClient | None = None,
    ):
        self.repo = repo
        self.tickets = TicketRepository(repo.db)
        self.templates = TemplateService(repo.db)
        self.settings = settings or ensure_config()
        self.llm = llm if llm is not None else _llm_override or BailianClient(self.settings)

    async def polish(self, conversation_id: str, content: str) -> AgentPolishPublic:
        original = _normalize_content(content)
        conversation = await self.repo.get_by_id(conversation_id)
        if conversation is None:
            raise ConversationNotFoundError
        if conversation.status != _STATUS_HANDED_OFF:
            raise PolishConflictError(_NOT_HANDED_OFF)

        ticket = await self.tickets.get_by_conversation_id(conversation_id)
        ticket_type = ticket.ticket_type if ticket is not None else None
        business_line = ticket.business_line if ticket is not None else None
        template_body, template_ref = await self._published_template_body(
            conversation_id, ticket, ticket_type, business_line, original
        )
        messages = [
            {"role": "system", "content": _system_prompt(business_line, template_body)},
            {
                "role": "user",
                "content": _user_prompt(
                    original,
                    conversation,
                    ticket_type=ticket_type,
                    business_line=business_line,
                    limit=self.settings.context_message_limit,
                ),
            },
        ]
        if _llm_override is None and not has_llm_key(self.settings):
            raise PolishUnavailableError(_UNAVAILABLE)
        try:
            polished = await self.llm.chat_completions(messages, json_object=False)
        except BailianError as exc:
            logger.warning("话术润色失败", conversation_id=conversation_id, detail=str(exc))
            raise PolishUnavailableError(_UNAVAILABLE) from exc
        polished_text = polished.strip()
        if not polished_text:
            raise PolishUnavailableError(_UNAVAILABLE)
        conversation_text = _conversation_plain(conversation, self.settings.context_message_limit)
        passed, reasons = check_compliance(
            original,
            polished_text,
            conversation_text,
            ticket_type=ticket_type,
        )
        if template_ref is not None:
            await self.templates.record_polish_event(
                template_ref[0],
                template_ref[1],
                intercepted=not passed,
                conversation_id=conversation_id,
                original_content=original,
                polished_content=polished_text,
            )
        logger.info(
            "话术润色预览已生成",
            conversation_id=conversation_id,
            compliance_passed=passed,
        )
        return AgentPolishPublic(
            original_content=original,
            polished_content=polished_text,
            compliance_passed=passed,
            can_adopt=passed,
            risk_reasons=reasons,
        )

    async def _published_template_body(
        self,
        conversation_id: str,
        ticket: Ticket | None,
        ticket_type: str | None,
        business_line: str | None,
        original: str,
    ) -> tuple[str | None, tuple[str, int] | None]:
        if business_line not in _LINE_LABELS:
            return None, None
        scene = _template_scene(ticket_type, ticket)
        await self.templates.list_templates()
        stmt = select(PromptTemplateRow).where(
            PromptTemplateRow.business_line == business_line,
            PromptTemplateRow.scene == scene,
        )
        if ticket_type:
            stmt = stmt.where(PromptTemplateRow.ticket_type == ticket_type)
        row = (await self.repo.db.execute(stmt)).scalars().first()
        if row is None:
            return None, None
        version = await self.templates.resolve_conversation_version(row.id, conversation_id)
        version_row = (
            await self.repo.db.execute(
                select(PromptTemplateVersionRow).where(
                    PromptTemplateVersionRow.template_id == row.id,
                    PromptTemplateVersionRow.version == version,
                )
            )
        ).scalar_one_or_none()
        if version_row is None or not version_row.body.strip():
            return None, None
        rendered = render_placeholders(version_row.body, original)
        return rendered, (row.id, version)
