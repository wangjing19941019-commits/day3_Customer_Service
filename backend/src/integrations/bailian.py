from __future__ import annotations

from typing import Any

import httpx
from pycore.core.logger import get_logger

from src.db.session import AppSettings

logger = get_logger()


class BailianError(Exception):
    def __init__(self, message: str, status_code: int | None = None):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


class BailianClient:
    def __init__(self, settings: AppSettings):
        self.settings = settings

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.settings.llm_api_key}",
            "Content-Type": "application/json",
        }

    def _timeout(self) -> httpx.Timeout:
        return httpx.Timeout(self.settings.llm_timeout_seconds)

    async def _post(self, url: str, payload: dict[str, Any]) -> dict[str, Any]:
        attempts = self.settings.llm_max_retries + 1
        last_error: BailianError | None = None
        for attempt in range(attempts):
            try:
                async with httpx.AsyncClient(
                    trust_env=False, timeout=self._timeout()
                ) as client:
                    response = await client.post(
                        url, headers=self._headers(), json=payload
                    )
            except httpx.TimeoutException as exc:
                last_error = BailianError("调用超时")
                logger.warning(
                    "百炼请求超时，将按配置重试",
                    attempt=attempt + 1,
                    attempts=attempts,
                )
                if attempt + 1 >= attempts:
                    raise last_error from exc
                continue
            except httpx.HTTPError as exc:
                logger.warning("百炼网络错误", detail=str(exc))
                raise BailianError("服务暂时不可用，请稍后重试。") from exc

            if response.status_code == 429:
                last_error = BailianError(_extract_error(response), 429)
                logger.warning(
                    "百炼返回 429，将按配置重试",
                    attempt=attempt + 1,
                    attempts=attempts,
                )
                if attempt + 1 >= attempts:
                    raise last_error
                continue
            if response.status_code >= 400:
                message = _extract_error(response)
                logger.warning(
                    "百炼请求失败",
                    status_code=response.status_code,
                    detail=message,
                )
                raise BailianError(message, response.status_code)
            try:
                data = response.json()
            except ValueError as exc:
                logger.warning("百炼响应不是 JSON")
                raise BailianError("模型返回无法解析") from exc
            if not isinstance(data, dict):
                raise BailianError("模型返回无法解析")
            logger.info("调用百炼接口成功", path=url, status_code=response.status_code)
            return data
        raise last_error or BailianError("服务暂时不可用，请稍后重试。")

    async def chat_completions(
        self, messages: list[dict[str, str]], *, json_object: bool = False
    ) -> str:
        payload: dict[str, Any] = {
            "model": self.settings.llm_model,
            "messages": messages,
            "temperature": self.settings.llm_temperature,
        }
        if json_object:
            payload["response_format"] = {"type": "json_object"}
        url = f"{self.settings.llm_base_url.rstrip('/')}/chat/completions"
        data = await self._post(url, payload)
        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise BailianError("模型返回缺少 choices 内容") from exc
        if not isinstance(content, str) or not content.strip():
            raise BailianError("模型返回缺少 choices 内容")
        return content

    async def embeddings(self, inputs: list[str]) -> list[list[float]]:
        if not inputs:
            return []
        url = f"{self.settings.llm_base_url.rstrip('/')}/embeddings"
        vectors: list[list[float] | None] = [None] * len(inputs)
        batch_size = self.settings.embedding_batch_size
        for start in range(0, len(inputs), batch_size):
            batch = inputs[start : start + batch_size]
            payload = {
                "model": self.settings.embedding_model,
                "input": batch,
                "dimensions": self.settings.embedding_dimensions,
                "encoding_format": "float",
            }
            data = await self._post(url, payload)
            rows = data.get("data")
            if not isinstance(rows, list) or len(rows) != len(batch):
                raise BailianError("嵌入结果数量与输入不一致")
            for row in rows:
                if not isinstance(row, dict):
                    raise BailianError("嵌入结果缺少向量")
                index = row.get("index")
                embedding = row.get("embedding")
                if not isinstance(index, int) or not isinstance(embedding, list):
                    raise BailianError("嵌入结果缺少向量")
                if index < 0 or index >= len(batch):
                    raise BailianError("嵌入结果下标无效")
                vectors[start + index] = [float(value) for value in embedding]
        if any(item is None for item in vectors):
            raise BailianError("嵌入结果不完整")
        return [item for item in vectors if item is not None]


def _extract_error(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return f"HTTP {response.status_code}"
    error = payload.get("error") if isinstance(payload, dict) else None
    if isinstance(error, dict):
        message = error.get("message") or error.get("code")
        if isinstance(message, str) and message.strip():
            return message
    if isinstance(error, str) and error.strip():
        return error
    return f"HTTP {response.status_code}"
