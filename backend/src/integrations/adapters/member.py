from __future__ import annotations

from typing import Any, Protocol

import httpx
from pycore.core import get_logger

from src.db.session import AppSettings

logger = get_logger()

_LOOKUP_PATH = "/lookup-member"


class MemberAdapterError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class MemberAdapter(Protocol):
    async def lookup_member(self, user_key: str) -> dict[str, Any] | None: ...


_member_override: MemberAdapter | None = None


def set_member_adapter_override(adapter: MemberAdapter | None) -> None:
    global _member_override
    _member_override = adapter


def _base_url(settings: AppSettings) -> str:
    value = getattr(settings, "member_base_url", None)
    if value is None:
        try:
            from pycore.core.config import get_config

            value = get_config().get("member_base_url", "")
        except Exception:
            value = ""
    return str(value or "").strip()


def _max_retries(settings: AppSettings) -> int:
    value = getattr(settings, "llm_max_retries", 2)
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 2


def _clean_member(raw: object) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    level = raw.get("level")
    if level is not None and not isinstance(level, str):
        level = str(level)
    if isinstance(level, str) and not level.strip():
        level = None
    payload = {
        "level": level.strip() if isinstance(level, str) else None,
        "history_spend": raw.get("history_spend"),
        "order_value": raw.get("order_value"),
        "complaint_count": raw.get("complaint_count"),
        "malicious_refund": raw.get("malicious_refund"),
    }
    if all(payload[key] in (None, "", 0, False) for key in ("level", "history_spend", "order_value")):
        if payload["complaint_count"] in (None, "", 0) and not payload["malicious_refund"]:
            return None
    return payload


class MockMemberAdapter:
    def __init__(self, payload: dict[str, Any] | None = None) -> None:
        self.payload = payload
        self.by_key: dict[str, dict[str, Any] | None] = {}
        self.calls: list[str] = []
        self.fail = False

    async def lookup_member(self, user_key: str) -> dict[str, Any] | None:
        self.calls.append(user_key)
        if self.fail:
            raise MemberAdapterError("会员中心暂时无法查询")
        raw = self.by_key[user_key] if user_key in self.by_key else self.payload
        logger.info("会员适配器走进程内 Mock", has_data=raw is not None)
        return _clean_member(raw) if raw is not None else None


class HttpMemberAdapter:
    def __init__(self, base_url: str, settings: AppSettings):
        self.base_url = base_url.rstrip("/")
        self.settings = settings

    async def lookup_member(self, user_key: str) -> dict[str, Any] | None:
        data = await _post_json(
            self.base_url + _LOOKUP_PATH,
            {"user_key": user_key},
            retries=_max_retries(self.settings),
            timeout_seconds=float(getattr(self.settings, "llm_timeout_seconds", 45)),
        )
        return _clean_member(data)


def get_member_adapter(settings: AppSettings) -> MemberAdapter:
    if _member_override is not None:
        return _member_override
    url = _base_url(settings)
    if url:
        return HttpMemberAdapter(url, settings)
    logger.info("member_base_url 为空，会员查询使用 Mock")
    return MockMemberAdapter()


async def _post_json(
    url: str, payload: dict[str, Any], *, retries: int, timeout_seconds: float
) -> Any:
    attempts = retries + 1
    last_error: MemberAdapterError | None = None
    for attempt in range(attempts):
        try:
            async with httpx.AsyncClient(
                trust_env=False, timeout=httpx.Timeout(timeout_seconds)
            ) as client:
                response = await client.post(url, json=payload)
        except httpx.TimeoutException as exc:
            last_error = MemberAdapterError("会员中心暂时无法查询")
            logger.warning("会员中心超时，将按配置重试", attempt=attempt + 1, attempts=attempts)
            if attempt + 1 >= attempts:
                raise last_error from exc
            continue
        except httpx.HTTPError as exc:
            logger.warning("会员中心网络错误", detail=str(exc))
            raise MemberAdapterError("会员中心暂时无法查询") from exc
        if response.status_code == 404:
            return None
        if response.status_code == 429:
            last_error = MemberAdapterError("会员中心暂时无法查询")
            logger.warning("会员中心返回 429，将按配置重试", attempt=attempt + 1)
            if attempt + 1 >= attempts:
                raise last_error
            continue
        if response.status_code >= 500:
            logger.warning("会员中心返回 5xx", status_code=response.status_code)
            raise MemberAdapterError("会员中心暂时无法查询")
        if response.status_code >= 400:
            logger.warning("会员中心请求失败", status_code=response.status_code)
            raise MemberAdapterError("会员中心暂时无法查询")
        try:
            return response.json()
        except ValueError as exc:
            raise MemberAdapterError("会员中心返回无法解析") from exc
    raise last_error or MemberAdapterError("会员中心暂时无法查询")
