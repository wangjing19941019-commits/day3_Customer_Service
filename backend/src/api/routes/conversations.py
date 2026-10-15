from typing import NoReturn

from fastapi import BackgroundTasks, Depends, Query
from pycore.api import APIRouter, success_response
from pycore.api.responses import APIResponse, PaginatedResponse, paginated_response
from pycore.api.routes import Pagination
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import ApiError, get_current_user
from src.db.models import User
from src.db.session import get_db
from src.models.conversation import (
    AgentReplyCreate,
    AgentReplyResult,
    ConversationListItem,
    ConversationPublic,
)
from src.models.message import EmployeeMessageResult, MessageCreate
from src.models.ticket import AgentPolishCreate
from src.models.ticket_attachment import ResultFeedbackCreate, ResultFeedbackPublic
from src.repositories.conversation_repository import ConversationRepository
from src.services.agent_knowledge import (
    AgentKnowledgeService,
    KnowledgeConflictError,
    KnowledgeSuggestionPublic,
    KnowledgeUnavailableError,
)
from src.services.handoff import (
    ConversationNotFoundError,
    HandoffService,
    NotHandedOffError,
)
from src.services.polish import (
    AgentPolishPublic,
    PolishConflictError,
    PolishService,
    PolishUnavailableError,
    PolishValidationError,
)
from src.services.qa import QaService, QaUnavailableError
from src.services.ticket import TicketService, run_extract_job
from src.services.ticket_attachments import FeedbackForbiddenError, ResultFeedbackService

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


def _service(db: AsyncSession) -> HandoffService:
    return HandoffService(ConversationRepository(db))


def _qa_service(db: AsyncSession) -> QaService:
    return QaService(ConversationRepository(db))


def _knowledge_service(db: AsyncSession) -> AgentKnowledgeService:
    return AgentKnowledgeService(ConversationRepository(db))


def _polish_service(db: AsyncSession) -> PolishService:
    return PolishService(ConversationRepository(db))


def _not_found() -> NoReturn:
    raise ApiError("会话不存在", "NOT_FOUND", 404)


@router.post("", response_model=APIResponse[ConversationPublic])
async def create_conversation(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    public = await _service(db).create_conversation(user)
    return success_response(data=public.model_dump(mode="json"), message="ok")


@router.get("", response_model=PaginatedResponse[ConversationListItem])
async def list_handed_off_conversations(
    pagination: Pagination = Depends(),
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    items, total = await _service(db).list_handed_off(pagination.offset, pagination.limit)
    return paginated_response(
        data=[item.model_dump(mode="json") for item in items],
        page=pagination.page,
        page_size=pagination.page_size,
        total_items=total,
    )


@router.get("/{conversation_id}", response_model=APIResponse[ConversationPublic])
async def get_conversation(
    conversation_id: str,
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        public = await _service(db).get_conversation(conversation_id)
    except ConversationNotFoundError:
        _not_found()
    return success_response(data=public.model_dump(mode="json"), message="ok")


@router.post(
    "/{conversation_id}/messages",
    response_model=APIResponse[EmployeeMessageResult],
)
async def create_employee_message(
    conversation_id: str,
    body: MessageCreate,
    background_tasks: BackgroundTasks,
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await _qa_service(db).post_message(conversation_id, body.content)
    except ConversationNotFoundError:
        _not_found()
    except QaUnavailableError:
        raise ApiError("服务暂时不可用，请稍后重试。", "INTERNAL_ERROR", 502) from None
    if result.conversation.status == "handed_off":
        job_id = await TicketService(db).begin_extract_for_new_messages(conversation_id)
        if job_id is not None:
            await db.commit()
            background_tasks.add_task(run_extract_job, job_id, ())
    return success_response(data=result.model_dump(mode="json"), message="ok")


@router.post("/{conversation_id}/transfer", response_model=APIResponse[ConversationPublic])
async def transfer_conversation(
    conversation_id: str,
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        public = await _service(db).transfer(conversation_id)
    except ConversationNotFoundError:
        _not_found()
    return success_response(data=public.model_dump(mode="json"), message="ok")


@router.post("/{conversation_id}/replies", response_model=APIResponse[AgentReplyResult])
async def create_agent_reply(
    conversation_id: str,
    body: AgentReplyCreate,
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await _service(db).agent_reply(conversation_id, body.content)
    except ConversationNotFoundError:
        _not_found()
    except NotHandedOffError:
        raise ApiError("会话尚未转人工，无法以客服身份回复", "CONFLICT", 409) from None
    return success_response(data=result.model_dump(mode="json"), message="ok")


@router.get(
    "/{conversation_id}/knowledge-suggestions",
    response_model=APIResponse[KnowledgeSuggestionPublic],
)
async def get_knowledge_suggestions(
    conversation_id: str,
    q: str | None = Query(default=None),
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        public = await _knowledge_service(db).suggest(conversation_id, q)
    except ConversationNotFoundError:
        _not_found()
    except KnowledgeConflictError as exc:
        raise ApiError(exc.message, "CONFLICT", 409) from None
    except KnowledgeUnavailableError as exc:
        raise ApiError(exc.message, "INTERNAL_ERROR", 502) from None
    return success_response(data=public.model_dump(mode="json"), message="ok")


@router.post(
    "/{conversation_id}/replies/polish",
    response_model=APIResponse[AgentPolishPublic],
)
async def polish_agent_reply(
    conversation_id: str,
    body: AgentPolishCreate,
    _user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        public = await _polish_service(db).polish(conversation_id, body.content)
    except PolishValidationError as exc:
        raise ApiError(exc.message, "VALIDATION_ERROR", 400) from None
    except ConversationNotFoundError:
        _not_found()
    except PolishConflictError as exc:
        raise ApiError(exc.message, "CONFLICT", 409) from None
    except PolishUnavailableError as exc:
        raise ApiError(exc.message, "INTERNAL_ERROR", 502) from None
    return success_response(data=public.model_dump(mode="json"), message="ok")


@router.post(
    "/{conversation_id}/result-feedbacks",
    response_model=APIResponse[ResultFeedbackPublic],
)
async def create_result_feedback(
    conversation_id: str,
    body: ResultFeedbackCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        public = await ResultFeedbackService(db).create(conversation_id, body, user)
    except ConversationNotFoundError:
        _not_found()
    except FeedbackForbiddenError as exc:
        raise ApiError(exc.message, "FORBIDDEN", 403) from None
    return success_response(data=public.model_dump(mode="json"), message="ok")
