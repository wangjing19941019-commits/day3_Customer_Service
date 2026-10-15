from __future__ import annotations

from typing import Any, Protocol

import httpx
from pycore.core import get_logger

from src.db.session import AppSettings

logger = get_logger()

_MATCH_PATH = "/match-orders"


class OrderAdapterError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class OrderAdapter(Protocol):
    async def match_orders(
        self, user_key: str, time_range: str | None, keywords: list[str]
    ) -> list[dict[str, Any]]: ...


_order_override: OrderAdapter | None = None


def set_order_adapter_override(adapter: OrderAdapter | None) -> None:
    global _order_override
    _order_override = adapter


def _base_url(settings: AppSettings) -> str:
    value = getattr(settings, "order_center_base_url", "") or ""
    return str(value).strip()


def _max_retries(settings: AppSettings) -> int:
    value = getattr(settings, "llm_max_retries", 2)
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 2


class MockOrderAdapter:
    def __init__(self, rows: list[dict[str, Any]] | None = None) -> None:
        self.rows = list(rows or [])
        self.calls: list[dict[str, Any]] = []
        self.fail = False

    async def match_orders(
        self, user_key: str, time_range: str | None, keywords: list[str]
    ) -> list[dict[str, Any]]:
        self.calls.append(
            {"user_key": user_key, "time_range": time_range, "keywords": list(keywords)}
        )
        if self.fail:
            raise OrderAdapterError("订单中心暂时无法查询")
        logger.info("订单中心走进程内 Mock", hit_count=len(self.rows))
        return [dict(row) for row in self.rows]


class HttpOrderAdapter:
    def __init__(self, base_url: str, settings: AppSettings):
        self.base_url = base_url.rstrip("/")
        self.settings = settings

    async def match_orders(
        self, user_key: str, time_range: str | None, keywords: list[str]
    ) -> list[dict[str, Any]]:
        payload = {
            "user_key": user_key,
            "time_range": time_range,
            "keywords": keywords,
        }
        data = await _post_json(
            self.base_url + _MATCH_PATH,
            payload,
            retries=_max_retries(self.settings),
            timeout_seconds=float(getattr(self.settings, "llm_timeout_seconds", 45)),
        )
        rows = data.get("candidates", data) if isinstance(data, dict) else data
        if not isinstance(rows, list):
            raise OrderAdapterError("订单中心返回无法解析")
        cleaned: list[dict[str, Any]] = []
        for item in rows:
            if isinstance(item, dict):
                cleaned.append(item)
        return cleaned


def get_order_adapter(settings: AppSettings) -> OrderAdapter:
    if _order_override is not None:
        return _order_override
    url = _base_url(settings)
    if url:
        return HttpOrderAdapter(url, settings)
    return MockOrderAdapter()


async def _post_json(
    url: str, payload: dict[str, Any], *, retries: int, timeout_seconds: float
) -> Any:
    attempts = retries + 1
    last_error: OrderAdapterError | None = None
    for attempt in range(attempts):
        try:
            async with httpx.AsyncClient(
                trust_env=False, timeout=httpx.Timeout(timeout_seconds)
            ) as client:
                response = await client.post(url, json=payload)
        except httpx.TimeoutException as exc:
            last_error = OrderAdapterError("订单中心暂时无法查询")
            logger.warning("订单中心超时，将按配置重试", attempt=attempt + 1, attempts=attempts)
            if attempt + 1 >= attempts:
                raise last_error from exc
            continue
        except httpx.HTTPError as exc:
            logger.warning("订单中心网络错误", detail=str(exc))
            raise OrderAdapterError("订单中心暂时无法查询") from exc
        if response.status_code == 429:
            last_error = OrderAdapterError("订单中心暂时无法查询")
            logger.warning("订单中心返回 429，将按配置重试", attempt=attempt + 1)
            if attempt + 1 >= attempts:
                raise last_error
            continue
        if response.status_code >= 500:
            logger.warning("订单中心返回 5xx", status_code=response.status_code)
            raise OrderAdapterError("订单中心暂时无法查询")
        if response.status_code >= 400:
            logger.warning("订单中心请求失败", status_code=response.status_code)
            raise OrderAdapterError("订单中心暂时无法查询")
        try:
            return response.json()
        except ValueError as exc:
            raise OrderAdapterError("订单中心返回无法解析") from exc
    raise last_error or OrderAdapterError("订单中心暂时无法查询")
