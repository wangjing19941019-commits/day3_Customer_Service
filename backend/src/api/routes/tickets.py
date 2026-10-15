from typing import NoReturn

from fastapi import BackgroundTasks, Depends, File, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pycore.api import APIRouter, success_response
from pycore.api.responses import APIResponse, error_response
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import ApiError, get_current_user
from src.db.models import User
from src.db.session import get_db
from src.models.ticket import TicketPublic, TicketUpdate
from src.models.ticket_attachment import REUPLOAD_MESSAGE
from src.services.handoff import ConversationNotFoundError
from src.services.ticket import (
    TicketConflictError,
    TicketService,
    TicketValidationError,
    run_extract_job,
)
from src.services.ticket_attachments import AttachmentValidationError, TicketAttachmentService

router = APIRouter(prefix="/api/conversations", tags=["tickets"])


def _not_found() -> NoReturn:
    raise ApiError("会话不存在", "NOT_FOUND", 404)


def _conflict_response(exc: TicketConflictError) -> JSONResponse:
    extra: dict[str, list[str]] = {}
    if exc.confirm_blockers:
        extra["confirm_blockers"] = exc.confirm_blockers
    resp, status = error_response(
        error=exc.message, error_code="CONFLICT", status_code=409, **extra
    )
    return JSONResponse(status_code=status, content=jsonable_encoder(resp))


@router.get("/{conversation_id}/ticket", response_model=APIResponse[TicketPublic])
async def get_ticket(
    conversation_id: str,
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        public = await TicketService(db).get_or_create(conversation_id)
    except ConversationNotFoundError:
        _not_found()
    except TicketConflictError as exc:
        return _conflict_response(exc)
    return success_response(data=public.model_dump(mode="json"), message="ok")


@router.patch("/{conversation_id}/ticket", response_model=APIResponse[TicketPublic])
async def update_ticket(
    conversation_id: str,
    body: TicketUpdate,
    background_tasks: BackgroundTasks,
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        public, job_id, protected = await TicketService(db).update(conversation_id, body)
    except ConversationNotFoundError:
        _not_found()
    except TicketConflictError as exc:
        return _conflict_response(exc)
    except TicketValidationError as exc:
        raise ApiError(exc.message, "VALIDATION_ERROR", 400) from None
    if job_id is not None:
        await db.commit()
        background_tasks.add_task(run_extract_job, job_id, protected)
    return success_response(data=public.model_dump(mode="json"), message="ok")


@router.post("/{conversation_id}/ticket/confirm", response_model=APIResponse[TicketPublic])
async def confirm_ticket(
    conversation_id: str,
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        public = await TicketService(db).confirm(conversation_id)
    except ConversationNotFoundError:
        _not_found()
    except TicketConflictError as exc:
        return _conflict_response(exc)
    return success_response(data=public.model_dump(mode="json"), message="ok")


@router.post(
    "/{conversation_id}/ticket/attachments",
    response_model=APIResponse[TicketPublic],
)
async def upload_ticket_attachment(
    conversation_id: str,
    file: UploadFile | None = File(None),
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if file is None:
        raise ApiError(REUPLOAD_MESSAGE, "VALIDATION_ERROR", 400)
    raw = await file.read()
    try:
        public = await TicketAttachmentService(db).add(conversation_id, file.filename, raw)
    except ConversationNotFoundError:
        _not_found()
    except TicketConflictError as exc:
        return _conflict_response(exc)
    except AttachmentValidationError:
        raise ApiError(REUPLOAD_MESSAGE, "VALIDATION_ERROR", 400) from None
    return success_response(data=public.model_dump(mode="json"), message="ok")
