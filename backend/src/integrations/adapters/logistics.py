from __future__ import annotations

from typing import Any, Protocol

import httpx
from pycore.core import get_logger

from src.db.session import AppSettings

logger = get_logger()

_TRACK_PATH = "/track"


class LogisticsAdapterError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class LogisticsAdapter(Protocol):
    async def track(
        self, tracking_no: str | None, order_no: str | None
    ) -> dict[str, Any]: ...


_logistics_override: LogisticsAdapter | None = None


def set_logistics_adapter_override(adapter: LogisticsAdapter | None) -> None:
    global _logistics_override
    _logistics_override = adapter


def _base_url(settings: AppSettings) -> str:
    value = getattr(settings, "logistics_base_url", "") or ""
    return str(value).strip()


def _max_retries(settings: AppSettings) -> int:
    value = getattr(settings, "llm_max_retries", 2)
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 2


def failed_snapshot() -> dict[str, Any]:
    return {"events": [], "sign_status": None, "query_status": "failed"}


class MockLogisticsAdapter:
    def __init__(self, snapshot: dict[str, Any] | None = None) -> None:
        self.snapshot = dict(snapshot or failed_snapshot())
        self.calls: list[dict[str, Any]] = []
        self.fail = False

    async def track(
        self, tracking_no: str | None, order_no: str | None
    ) -> dict[str, Any]:
        self.calls.append({"tracking_no": tracking_no, "order_no": order_no})
        if self.fail:
            raise LogisticsAdapterError("物流轨迹暂时无法查询")
        logger.info("物流轨迹走进程内 Mock", query_status=self.snapshot.get("query_status"))
        return dict(self.snapshot)


class HttpLogisticsAdapter:
    def __init__(self, base_url: str, settings: AppSettings):
        self.base_url = base_url.rstrip("/")
        self.settings = settings

    async def track(
        self, tracking_no: str | None, order_no: str | None
    ) -> dict[str, Any]:
        payload = {"tracking_no": tracking_no, "order_no": order_no}
        data = await _post_json(
            self.base_url + _TRACK_PATH,
            payload,
            retries=_max_retries(self.settings),
            timeout_seconds=float(getattr(self.settings, "llm_timeout_seconds", 45)),
        )
        if not isinstance(data, dict):
            raise LogisticsAdapterError("物流轨迹返回无法解析")
        query_status = data.get("query_status")
        if query_status not in {"ok", "empty", "failed"}:
            query_status = "failed"
        events = data.get("events")
        if not isinstance(events, list):
            events = []
        sign_status = data.get("sign_status")
        if sign_status is not None and not isinstance(sign_status, str):
            sign_status = str(sign_status)
        return {
            "events": events,
            "sign_status": sign_status,
            "query_status": query_status,
        }


def get_logistics_adapter(settings: AppSettings) -> LogisticsAdapter:
    if _logistics_override is not None:
        return _logistics_override
    url = _base_url(settings)
    if url:
        return HttpLogisticsAdapter(url, settings)
    return MockLogisticsAdapter()


async def _post_json(
    url: str, payload: dict[str, Any], *, retries: int, timeout_seconds: float
) -> Any:
    attempts = retries + 1
    last_error: LogisticsAdapterError | None = None
    for attempt in range(attempts):
        try:
            async with httpx.AsyncClient(
                trust_env=False, timeout=httpx.Timeout(timeout_seconds)
            ) as client:
                response = await client.post(url, json=payload)
        except httpx.TimeoutException as exc:
            last_error = LogisticsAdapterError("物流轨迹暂时无法查询")
            logger.warning("物流轨迹超时，将按配置重试", attempt=attempt + 1, attempts=attempts)
            if attempt + 1 >= attempts:
                raise last_error from exc
            continue
        except httpx.HTTPError as exc:
            logger.warning("物流轨迹网络错误", detail=str(exc))
            raise LogisticsAdapterError("物流轨迹暂时无法查询") from exc
        if response.status_code == 429:
            last_error = LogisticsAdapterError("物流轨迹暂时无法查询")
            logger.warning("物流轨迹返回 429，将按配置重试", attempt=attempt + 1)
            if attempt + 1 >= attempts:
                raise last_error
            continue
        if response.status_code >= 500:
            logger.warning("物流轨迹返回 5xx", status_code=response.status_code)
            raise LogisticsAdapterError("物流轨迹暂时无法查询")
        if response.status_code >= 400:
            logger.warning("物流轨迹请求失败", status_code=response.status_code)
            raise LogisticsAdapterError("物流轨迹暂时无法查询")
        try:
            return response.json()
        except ValueError as exc:
            raise LogisticsAdapterError("物流轨迹返回无法解析") from exc
    raise last_error or LogisticsAdapterError("物流轨迹暂时无法查询")
