from collections.abc import Callable, Coroutine
from typing import Any

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import User
from src.db.session import get_db
from src.repositories.user_repository import UserRepository
from src.services.auth import decode_access_token

security = HTTPBearer(auto_error=False)


class ApiError(Exception):
    def __init__(self, error: str, error_code: str, status_code: int):
        self.error = error
        self.error_code = error_code
        self.status_code = status_code
        super().__init__(error)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    if credentials is None or not credentials.credentials:
        raise ApiError("请先登录", "UNAUTHORIZED", 401)
    username = decode_access_token(credentials.credentials)
    if username is None:
        raise ApiError("请先登录", "UNAUTHORIZED", 401)
    repo = UserRepository(db)
    user = await repo.get_by_username(username)
    if user is None:
        raise ApiError("请先登录", "UNAUTHORIZED", 401)
    return user


def require_roles(*roles: str) -> Callable[..., Coroutine[Any, Any, User]]:
    allowed = set(roles)

    async def _require(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed:
            raise ApiError("没有权限", "FORBIDDEN", 403)
        return user

    return _require
