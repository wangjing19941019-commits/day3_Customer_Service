from fastapi import Depends, File, UploadFile
from pycore.api import APIRouter, success_response
from pycore.api.responses import APIResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import ApiError, require_roles
from src.db.models import User
from src.db.session import get_db
from src.models.prompt_template import (
    EVAL_FILE_REQUIRED,
    EvaluationSetCurrentPublic,
    EvaluationSetPublic,
)
from src.services.templates import TemplateService, TemplateValidationError

router = APIRouter(prefix="/api/evaluation-sets", tags=["evaluation-sets"])


@router.get("/current", response_model=APIResponse[EvaluationSetCurrentPublic])
async def get_current_evaluation_set(
    _user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    item = await TemplateService(db).current_evaluation_set()
    return success_response(data=item.model_dump(mode="json"), message="ok")


@router.post("", response_model=APIResponse[EvaluationSetPublic])
async def import_evaluation_set(
    file: UploadFile | None = File(None),
    _user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    if file is None:
        raise ApiError(EVAL_FILE_REQUIRED, "VALIDATION_ERROR", 400)
    raw = await file.read()
    try:
        item = await TemplateService(db).import_evaluation_set(file.filename or "", raw)
    except TemplateValidationError as exc:
        raise ApiError(exc.message, "VALIDATION_ERROR", 400) from None
    await db.commit()
    return success_response(data=item.model_dump(mode="json"), message="ok")
