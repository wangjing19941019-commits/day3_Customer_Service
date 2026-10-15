from typing import NoReturn

from fastapi import Body, Depends, Query
from pycore.api import APIRouter, success_response
from pycore.api.responses import APIResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import ApiError, require_roles
from src.db.models import User
from src.db.session import get_db
from src.models.prompt_template import (
    PromptTemplateListItem,
    PromptTemplatePreviewPublic,
    PromptTemplatePreviewRequest,
    PromptTemplatePublic,
    PromptTemplateReleaseCreate,
    PromptTemplateReleasePublic,
    PromptTemplateRollback,
    PromptTemplateUpdate,
    PromptTemplateVersionPublic,
    PromptTemplateVersionsPublic,
    TemplateAlertsPublic,
    TemplateMetricsPublic,
)
from src.services.templates import (
    GrayBlockedError,
    TemplateAlertError,
    TemplateNotFoundError,
    TemplateService,
    TemplateValidationError,
)

router = APIRouter(tags=["prompt-templates"])


def _not_found(message: str = "模板不存在") -> NoReturn:
    raise ApiError(message, "NOT_FOUND", 404)


@router.get("/api/prompt-templates", response_model=APIResponse[list[PromptTemplateListItem]])
async def list_prompt_templates(
    _user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    items = await TemplateService(db).list_templates()
    return success_response(data=[item.model_dump(mode="json") for item in items], message="ok")


@router.get("/api/prompt-templates/{template_id}", response_model=APIResponse[PromptTemplatePublic])
async def get_prompt_template(
    template_id: str,
    _user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    try:
        item = await TemplateService(db).get_template(template_id)
    except TemplateNotFoundError as exc:
        _not_found(exc.message)
    return success_response(data=item.model_dump(mode="json"), message="ok")


@router.patch(
    "/api/prompt-templates/{template_id}",
    response_model=APIResponse[PromptTemplateVersionPublic],
)
async def save_prompt_template(
    template_id: str,
    body: PromptTemplateUpdate,
    user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    try:
        item = await TemplateService(db).save_version(
            template_id, body.body, body.change_summary, user.username
        )
    except TemplateNotFoundError as exc:
        _not_found(exc.message)
    await db.commit()
    return success_response(data=item.model_dump(mode="json"), message="ok")


@router.post(
    "/api/prompt-templates/{template_id}/preview",
    response_model=APIResponse[PromptTemplatePreviewPublic],
)
async def preview_prompt_template(
    template_id: str,
    body: PromptTemplatePreviewRequest,
    _user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    try:
        item = await TemplateService(db).preview(template_id, body.sample_utterance)
    except TemplateNotFoundError as exc:
        _not_found(exc.message)
    return success_response(data=item.model_dump(mode="json"), message="ok")


@router.get(
    "/api/prompt-templates/{template_id}/versions",
    response_model=APIResponse[PromptTemplateVersionsPublic],
)
async def list_prompt_template_versions(
    template_id: str,
    from_version: int | None = Query(default=None, alias="from"),
    to_version: int | None = Query(default=None, alias="to"),
    _user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    try:
        item = await TemplateService(db).list_versions(template_id, from_version, to_version)
    except TemplateNotFoundError as exc:
        _not_found(exc.message)
    except TemplateValidationError as exc:
        raise ApiError(exc.message, "VALIDATION_ERROR", 400) from None
    return success_response(data=item.model_dump(mode="json"), message="ok")


@router.post(
    "/api/prompt-templates/{template_id}/releases",
    response_model=APIResponse[PromptTemplateReleasePublic],
)
async def release_prompt_template(
    template_id: str,
    body: PromptTemplateReleaseCreate,
    _user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    try:
        item = await TemplateService(db).release(template_id, body.version, body.gray_percent)
    except TemplateNotFoundError as exc:
        _not_found(exc.message)
    except GrayBlockedError as exc:
        raise ApiError(exc.message, "CONFLICT", 409) from None
    await db.commit()
    return success_response(data=item.model_dump(mode="json"), message="ok")


@router.post(
    "/api/prompt-templates/{template_id}/rollback",
    response_model=APIResponse[PromptTemplateReleasePublic],
)
async def rollback_prompt_template(
    template_id: str,
    body: PromptTemplateRollback | None = Body(default=None),
    _user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    to_version = body.to_version if body is not None else None
    try:
        item = await TemplateService(db).rollback(template_id, to_version)
    except TemplateNotFoundError as exc:
        _not_found(exc.message)
    await db.commit()
    return success_response(data=item.model_dump(mode="json"), message="ok")


@router.get(
    "/api/prompt-templates/{template_id}/metrics",
    response_model=APIResponse[TemplateMetricsPublic],
)
async def get_prompt_template_metrics(
    template_id: str,
    _user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    try:
        item = await TemplateService(db).metrics(template_id)
    except TemplateNotFoundError as exc:
        _not_found(exc.message)
    return success_response(data=item.model_dump(mode="json"), message="ok")


@router.get("/api/prompt-template-alerts", response_model=APIResponse[TemplateAlertsPublic])
async def list_prompt_template_alerts(
    _user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
):
    try:
        item = await TemplateService(db).list_alerts()
    except TemplateAlertError as exc:
        raise ApiError(exc.message, "INTERNAL_ERROR", 500) from None
    return success_response(data=item.model_dump(mode="json"), message="ok")
