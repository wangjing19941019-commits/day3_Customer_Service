from typing import NoReturn

from fastapi import BackgroundTasks, Depends, File, Query, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pycore.api import APIRouter, success_response
from pycore.api.responses import APIResponse, PaginatedResponse, paginated_response
from pycore.api.routes import Pagination
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import ApiError, get_current_user
from src.db.models import User
from src.db.session import get_db
from src.integrations.bailian import BailianError
from src.models.document import (
    INVALID_INGEST_STATUS_FILTER,
    DocumentListItem,
    DocumentPublic,
    DocumentUpdate,
    parse_ingest_status_query,
)
from src.repositories.document_repository import REUPLOAD_MESSAGE
from src.services.ingest import (
    DocumentNotFoundError,
    IngestConflictError,
    IngestService,
    IngestValidationError,
    fail_stale_ingesting_documents,
    run_ingest_job,
    to_list_item,
)

router = APIRouter(prefix="/api/documents", tags=["documents"])


def _not_found() -> NoReturn:
    raise ApiError("文档不存在", "NOT_FOUND", 404)


@router.post("", status_code=202, response_model=APIResponse[DocumentPublic])
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile | None = File(None),
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if file is None:
        raise ApiError(REUPLOAD_MESSAGE, "VALIDATION_ERROR", 400)
    raw = await file.read()
    service = IngestService(db)
    try:
        public = await service.accept_upload(file.filename, raw)
    except IngestValidationError:
        raise ApiError(REUPLOAD_MESSAGE, "VALIDATION_ERROR", 400) from None
    await db.commit()
    background_tasks.add_task(run_ingest_job, public.id)
    resp = success_response(data=public.model_dump(mode="json"), message="ok")
    return JSONResponse(status_code=202, content=jsonable_encoder(resp))


@router.get("", response_model=PaginatedResponse[DocumentListItem])
async def list_documents(
    pagination: Pagination = Depends(),
    ingest_status: str | None = Query(default=None),
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        status_filter = parse_ingest_status_query(ingest_status)
    except ValueError:
        raise ApiError(INVALID_INGEST_STATUS_FILTER, "VALIDATION_ERROR", 400) from None
    service = IngestService(db)
    await fail_stale_ingesting_documents(db)
    documents, total = await service.repo.list_page(
        pagination.offset,
        pagination.page_size,
        ingest_status=status_filter,
    )
    return paginated_response(
        data=[to_list_item(item).model_dump(mode="json") for item in documents],
        page=pagination.page,
        page_size=pagination.page_size,
        total_items=total,
    )


@router.get("/{document_id}", response_model=APIResponse[DocumentPublic])
async def get_document(
    document_id: str,
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        public = await IngestService(db).get_document(document_id)
    except DocumentNotFoundError:
        _not_found()
    return success_response(data=public.model_dump(mode="json"), message="ok")


@router.patch("/{document_id}", response_model=APIResponse[DocumentPublic])
async def update_document(
    document_id: str,
    body: DocumentUpdate,
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        public = await IngestService(db).update_document(document_id, body)
    except DocumentNotFoundError:
        _not_found()
    except IngestConflictError as exc:
        raise ApiError(exc.message, "CONFLICT", 409) from None
    except IngestValidationError as exc:
        raise ApiError(exc.message, "VALIDATION_ERROR", 400) from None
    except BailianError:
        raise ApiError("服务暂时不可用，请稍后重试。", "INTERNAL_ERROR", 502) from None
    return success_response(data=public.model_dump(mode="json"), message="ok")
