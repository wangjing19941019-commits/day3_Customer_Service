from datetime import datetime
from typing import Literal, NoReturn

from fastapi import Depends, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from pycore.api import APIRouter, success_response
from pycore.api.responses import APIResponse, PaginatedResponse, error_response, paginated_response
from pycore.api.routes import Pagination
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import ApiError, get_current_user
from src.db.models import User
from src.db.session import get_db
from src.models.ticket import TicketPublic
from src.services.assign import AssignService, TicketQueueError, ticket_list_payload
from src.services.ticket import to_ticket_public

router = APIRouter(prefix="/api/tickets", tags=["ticket-queue"])


class TicketListItem(BaseModel):
    id: str
    ticket_no: str | None
    ticket_type: str | None
    status: str
    urgency: str | None
    queue: str | None
    order_no: str | None
    assigned_display: str | None
    upgrade_undelivered: bool
    confirmed_at: datetime | None
    sla_due_at: datetime | None
    updated_at: datetime | None


class TicketQueueUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["on_hold", "completed", "closed"] | None = None
    hold_reason: Literal["wait_user", "wait_warehouse"] | None = None
    urgency: Literal["normal", "vip", "high_risk"] | None = None


class UrgencyApprovalCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    approved: bool
    target_urgency: Literal["normal", "vip"]


def _queue_error(exc: TicketQueueError) -> JSONResponse:
    resp, status = error_response(
        error=exc.message, error_code=exc.error_code, status_code=exc.status_code
    )
    return JSONResponse(status_code=status, content=jsonable_encoder(resp))


def _not_found() -> NoReturn:
    raise ApiError("工单不存在", "NOT_FOUND", 404)


@router.get("", response_model=PaginatedResponse[TicketListItem])
async def list_tickets(
    pagination: Pagination = Depends(),
    ticket_type: str | None = Query(default=None),
    status: str | None = Query(default=None),
    urgency: str | None = Query(default=None),
    order_no: str | None = Query(default=None),
    user_query: str | None = Query(default=None),
    ticket_no: str | None = Query(default=None),
    time_from: datetime | None = Query(default=None),
    time_to: datetime | None = Query(default=None),
    queue: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        items, total = await AssignService(db).list_tickets(
            user,
            page=pagination.page,
            page_size=pagination.page_size,
            ticket_type=ticket_type,
            status=status,
            urgency=urgency,
            order_no=order_no,
            user_query=user_query,
            ticket_no=ticket_no,
            time_from=time_from,
            time_to=time_to,
            queue=queue,
        )
    except TicketQueueError as exc:
        return _queue_error(exc)
    return paginated_response(
        data=[TicketListItem.model_validate(ticket_list_payload(item)).model_dump(mode="json") for item in items],
        page=pagination.page,
        page_size=pagination.page_size,
        total_items=total,
    )


@router.get("/{ticket_id}", response_model=APIResponse[TicketPublic])
async def get_ticket(
    ticket_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        ticket = await AssignService(db).get(ticket_id, user)
    except TicketQueueError as exc:
        if exc.status_code == 404:
            _not_found()
        return _queue_error(exc)
    return success_response(data=to_ticket_public(ticket).model_dump(mode="json"), message="ok")


@router.post("/{ticket_id}/claim", response_model=APIResponse[TicketPublic])
async def claim_ticket(
    ticket_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        ticket = await AssignService(db).claim(ticket_id, user)
    except TicketQueueError as exc:
        if exc.status_code == 404:
            _not_found()
        return _queue_error(exc)
    return success_response(data=to_ticket_public(ticket).model_dump(mode="json"), message="ok")


@router.patch("/{ticket_id}", response_model=APIResponse[TicketPublic])
async def patch_ticket(
    ticket_id: str,
    body: TicketQueueUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        ticket = await AssignService(db).patch(
            ticket_id,
            user,
            status=body.status,
            hold_reason=body.hold_reason,
            urgency=body.urgency,
        )
    except TicketQueueError as exc:
        if exc.status_code == 404:
            _not_found()
        return _queue_error(exc)
    return success_response(data=to_ticket_public(ticket).model_dump(mode="json"), message="ok")


@router.post("/{ticket_id}/urgency-approvals", response_model=APIResponse[TicketPublic])
async def approve_urgency(
    ticket_id: str,
    body: UrgencyApprovalCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        ticket = await AssignService(db).approve_urgency(
            ticket_id, user, approved=body.approved, target_urgency=body.target_urgency
        )
    except TicketQueueError as exc:
        if exc.status_code == 404:
            _not_found()
        return _queue_error(exc)
    return success_response(data=to_ticket_public(ticket).model_dump(mode="json"), message="ok")
