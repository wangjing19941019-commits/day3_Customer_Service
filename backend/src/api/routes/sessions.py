from fastapi import Depends
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pycore.api import APIRouter, success_response
from pycore.api.responses import APIResponse, error_response
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user
from src.db.models import User
from src.db.session import get_db
from src.models.session import CurrentSessionPublic, SessionCreate, SessionPublic
from src.repositories.user_repository import UserRepository
from src.services.auth import (
    authenticate,
    create_access_token,
    seed_accounts_uninitialized,
    shared_account_uninitialized,
)

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


def _json_error(error: str, error_code: str, status_code: int) -> JSONResponse:
    resp, status = error_response(error=error, error_code=error_code, status_code=status_code)
    return JSONResponse(status_code=status, content=jsonable_encoder(resp))


@router.post("", response_model=APIResponse[SessionPublic])
async def login(body: SessionCreate, db: AsyncSession = Depends(get_db)):
    if await shared_account_uninitialized(db):
        return _json_error("服务暂时不可用", "INTERNAL_ERROR", 500)
    if await seed_accounts_uninitialized(db, body.username):
        return _json_error("服务暂时不可用", "INTERNAL_ERROR", 500)
    user = await authenticate(db, body.username, body.password)
    if user is None:
        return _json_error("用户名或密码错误", "UNAUTHORIZED", 401)
    token = create_access_token(user.username, user.role)
    return success_response(
        data=SessionPublic(
            access_token=token,
            token_type="bearer",
            username=user.username,
            role=user.role,
        ).model_dump(),
        message="ok",
    )


@router.get("/current", response_model=APIResponse[CurrentSessionPublic])
async def current_session(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    repo = UserRepository(db)
    user = await repo.touch_last_seen(user)
    return success_response(
        data=CurrentSessionPublic(username=user.username, role=user.role).model_dump(),
        message="ok",
    )
