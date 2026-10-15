from __future__ import annotations

from typing import Any, Protocol

import httpx
from pycore.core import get_logger

from src.db.session import AppSettings

logger = get_logger()

_CREATE_PATH = "/create-return"
_DEFAULT_FAIL = "仓储暂时未能受理退货"


class WarehouseAdapterError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class WarehouseAdapter(Protocol):
    async def create_return(self, ticket: dict[str, Any]) -> dict[str, Any]: ...


_warehouse_override: WarehouseAdapter | None = None


def set_warehouse_adapter_override(adapter: WarehouseAdapter | None) -> None:
    global _warehouse_override
    _warehouse_override = adapter


def _base_url(settings: AppSettings) -> str:
    value = getattr(settings, "warehouse_base_url", None)
    if value is None:
        try:
            from pycore.core.config import get_config

            value = get_config().get("warehouse_base_url", "")
        except Exception:
            value = ""
    return str(value or "").strip()


def _max_retries(settings: AppSettings) -> int:
    value = getattr(settings, "llm_max_retries", 2)
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 2


def _normalize_result(raw: object, *, fallback_error: str) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise WarehouseAdapterError(fallback_error)
    accepted = bool(raw.get("accepted"))
    external_ref = raw.get("external_ref")
    if external_ref is not None and not isinstance(external_ref, str):
        external_ref = str(external_ref)
    if isinstance(external_ref, str) and not external_ref.strip():
        external_ref = None
    error = raw.get("error")
    if error is not None and not isinstance(error, str):
        error = str(error)
    if accepted:
        return {"accepted": True, "external_ref": external_ref, "error": None}
    text = (error or "").strip() or fallback_error
    return {"accepted": False, "external_ref": None, "error": text}


class MockWarehouseAdapter:
    def __init__(
        self,
        *,
        accepted: bool = True,
        external_ref: str | None = "WH-MOCK-1",
        error: str | None = None,
    ) -> None:
        self.accepted = accepted
        self.external_ref = external_ref
        self.error = error
        self.fail = False
        self.calls: list[dict[str, Any]] = []
        self._by_ticket: dict[str, dict[str, Any]] = {}

    async def create_return(self, ticket: dict[str, Any]) -> dict[str, Any]:
        payload = dict(ticket)
        self.calls.append(payload)
        ticket_id = str(payload.get("ticket_id") or "")
        if ticket_id and ticket_id in self._by_ticket:
            logger.info("仓储适配器按工单幂等返回 Mock 结果", ticket_id=ticket_id)
            return dict(self._by_ticket[ticket_id])
        if self.fail:
            raise WarehouseAdapterError(_DEFAULT_FAIL)
        result = _normalize_result(
            {
                "accepted": self.accepted,
                "external_ref": self.external_ref if self.accepted else None,
                "error": None if self.accepted else (self.error or _DEFAULT_FAIL),
            },
            fallback_error=_DEFAULT_FAIL,
        )
        if ticket_id:
            self._by_ticket[ticket_id] = result
        logger.info("仓储适配器走进程内 Mock", accepted=result["accepted"])
        return dict(result)


class HttpWarehouseAdapter:
    def __init__(self, base_url: str, settings: AppSettings):
        self.base_url = base_url.rstrip("/")
        self.settings = settings

    async def create_return(self, ticket: dict[str, Any]) -> dict[str, Any]:
        data = await _post_json(
            self.base_url + _CREATE_PATH,
            dict(ticket),
            retries=_max_retries(self.settings),
            timeout_seconds=float(getattr(self.settings, "llm_timeout_seconds", 45)),
        )
        return _normalize_result(data, fallback_error=_DEFAULT_FAIL)


def get_warehouse_adapter(settings: AppSettings) -> WarehouseAdapter:
    if _warehouse_override is not None:
        return _warehouse_override
    url = _base_url(settings)
    if url:
        return HttpWarehouseAdapter(url, settings)
    logger.info("warehouse_base_url 为空，退货使用 Mock")
    return MockWarehouseAdapter()


async def _post_json(
    url: str, payload: dict[str, Any], *, retries: int, timeout_seconds: float
) -> Any:
    attempts = retries + 1
    last_error: WarehouseAdapterError | None = None
    for attempt in range(attempts):
        try:
            async with httpx.AsyncClient(
                trust_env=False, timeout=httpx.Timeout(timeout_seconds)
            ) as client:
                response = await client.post(url, json=payload)
        except httpx.TimeoutException as exc:
            last_error = WarehouseAdapterError(_DEFAULT_FAIL)
            logger.warning("仓储适配器超时，将按配置重试", attempt=attempt + 1, attempts=attempts)
            if attempt + 1 >= attempts:
                raise last_error from exc
            continue
        except httpx.HTTPError as exc:
            logger.warning("仓储适配器网络错误", detail=str(exc))
            raise WarehouseAdapterError(_DEFAULT_FAIL) from exc
        if response.status_code == 429:
            last_error = WarehouseAdapterError(_DEFAULT_FAIL)
            logger.warning("仓储适配器返回 429，将按配置重试", attempt=attempt + 1)
            if attempt + 1 >= attempts:
                raise last_error
            continue
        if response.status_code >= 500:
            logger.warning("仓储适配器返回 5xx", status_code=response.status_code)
            raise WarehouseAdapterError(_DEFAULT_FAIL)
        if response.status_code >= 400:
            logger.warning("仓储适配器请求失败", status_code=response.status_code)
            raise WarehouseAdapterError(_DEFAULT_FAIL)
        try:
            return response.json()
        except ValueError as exc:
            raise WarehouseAdapterError("仓储适配器返回无法解析") from exc
    raise last_error or WarehouseAdapterError(_DEFAULT_FAIL)
