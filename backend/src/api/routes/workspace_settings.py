from fastapi import Depends
from pycore.api import APIRouter, success_response
from pycore.api.responses import APIResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import require_roles
from src.db.models import User
from src.db.session import get_db
from src.models.workspace import WorkspaceSettingsPublic, WorkspaceSettingsUpdate
from src.services.workspace_settings import WorkspaceSettingsService

router = APIRouter(prefix="/api/workspace-settings", tags=["workspace-settings"])


@router.get("", response_model=APIResponse[WorkspaceSettingsPublic])
async def get_workspace_settings(
    _user: User = Depends(require_roles("admin", "supervisor")),
    db: AsyncSession = Depends(get_db),
):
    public = await WorkspaceSettingsService(db).get()
    return success_response(data=public.model_dump(), message="ok")


@router.patch("", response_model=APIResponse[WorkspaceSettingsPublic])
async def patch_workspace_settings(
    body: WorkspaceSettingsUpdate,
    _user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    public = await WorkspaceSettingsService(db).update(body.high_risk_amount_threshold)
    return success_response(data=public.model_dump(), message="ok")
