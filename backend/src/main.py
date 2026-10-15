from pathlib import Path

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pycore.api import APIConfig, APIServer
from pycore.api.middleware import ErrorHandlerMiddleware, RequestContextMiddleware
from pycore.api.responses import error_response
from pycore.core import Logger, LoggerConfig, LogLevel, get_logger

from src.api.deps import ApiError
from src.api.routes import conversations_router, documents_router, sessions_router, tickets_router
from src.api.routes.evaluation_sets import router as evaluation_sets_router
from src.api.routes.prompt_templates import router as prompt_templates_router
from src.api.routes.ticket_queue import router as ticket_queue_router
from src.api.routes.workspace_settings import router as workspace_settings_router
from src.db.session import close_db, ensure_config, init_db
from src.services.auth import seed_users
from src.services.ticket import fail_stale_extracting_tickets

_BACKEND_DIR = Path(__file__).resolve().parent.parent
_LOG_DIR = _BACKEND_DIR / "logs"

settings = ensure_config()

Logger.configure(
    LoggerConfig(
        level=LogLevel.DEBUG if settings.debug else LogLevel.INFO,
        app_name="Customer_Service",
        json_format=False,
        log_dir=_LOG_DIR,
        file_enabled=True,
        console_enabled=True,
    )
)
logger = get_logger()


async def on_startup() -> None:
    await init_db()
    await seed_users()
    await fail_stale_extracting_tickets()
    logger.info("后端启动完成")


server = APIServer(
    APIConfig(
        title="Customer Service API",
        version="1.0.0",
        host=settings.host,
        port=settings.port,
        debug=settings.debug,
        cors_origins=list(settings.cors_origins),
    )
)
server.on_startup(on_startup)
server.on_shutdown(close_db)
server.include_router(sessions_router)
server.include_router(documents_router)
server.include_router(conversations_router)
server.include_router(tickets_router)
server.include_router(ticket_queue_router)
server.include_router(prompt_templates_router)
server.include_router(evaluation_sets_router)
server.include_router(workspace_settings_router)
server.add_middleware(RequestContextMiddleware)
server.add_middleware(ErrorHandlerMiddleware, debug=settings.debug)

app = server.app


@app.exception_handler(ApiError)
async def api_error_handler(_request: Request, exc: ApiError) -> JSONResponse:
    resp, status = error_response(
        error=exc.error, error_code=exc.error_code, status_code=exc.status_code
    )
    return JSONResponse(status_code=status, content=jsonable_encoder(resp))


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, _exc: RequestValidationError) -> JSONResponse:
    path = request.url.path.rstrip("/")
    if request.method == "POST" and path == "/api/sessions":
        message = "请输入用户名和密码"
    elif request.method == "PATCH" and path.endswith("/ticket"):
        message = "工单字段无效"
    else:
        message = "参数验证失败"
    resp, status = error_response(error=message, error_code="VALIDATION_ERROR", status_code=400)
    return JSONResponse(status_code=status, content=jsonable_encoder(resp))
