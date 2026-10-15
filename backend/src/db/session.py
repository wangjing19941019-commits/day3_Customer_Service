from collections.abc import AsyncGenerator
from pathlib import Path

from pycore.core.config import BaseSettings, get_config
from pycore.core.exceptions import ConfigurationError
from pycore.core.logger import get_logger
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from src.db.models import Base

logger = get_logger()

_engine: AsyncEngine | None = None
_session_maker: async_sessionmaker[AsyncSession] | None = None

_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent


class AppSettings(BaseSettings):
    debug: bool = True
    secret_key: str
    host: str = "127.0.0.1"
    port: int = 8099
    cors_origins: list[str] = [
        "http://localhost:5199",
        "http://127.0.0.1:5199",
        "http://localhost:5175",
        "http://127.0.0.1:5175",
    ]
    database_path: str = "data/Customer_Service.db"
    upload_dir: str = "data/uploads"
    shared_username: str = "it-help"
    shared_password: str
    jwt_expire_minutes: int = 720
    llm_api_key: str
    llm_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    llm_model: str = "qwen-plus"
    llm_temperature: float = 0.2
    llm_timeout_seconds: float = 45
    llm_max_retries: int = 2
    embedding_model: str = "text-embedding-v4"
    embedding_dimensions: int = 1024
    embedding_batch_size: int = 10
    max_upload_bytes: int = 5242880
    chunk_max_chars: int = 800
    chunk_overlap_chars: int = 160
    ingest_max_chars: int = 24000
    context_message_limit: int = 20
    faq_hit_threshold: float = 0.82
    retrieve_top_k: int = 5
    retrieve_min_score: float = 0.55
    retrieve_cosine_weight: float = 0.7
    retrieve_keyword_weight: float = 0.3
    poll_interval_ms: int = 3000
    ingest_stale_seconds: int = 300
    fallback_reply: str = (
        "抱歉，这个问题我暂时无法根据现有知识准确回答。你可以换个说法再问，或点击转人工。"
    )
    clarification_max_rounds: int = 5
    agent_knowledge_top_k: int = 3


def ensure_config() -> AppSettings:
    manager = get_config()
    try:
        settings = manager.settings
    except ConfigurationError:
        env_path = _BACKEND_DIR / ".env"
        if not env_path.is_file():
            env_path = _BACKEND_DIR / ".env.example"
        manager.load(AppSettings, env_path, use_env=False)
        settings = manager.settings
    if not isinstance(settings, AppSettings):
        raise ConfigurationError("配置类型不是 AppSettings")
    return settings


def _sqlite_url(database_path: str) -> str:
    path = Path(database_path)
    if not path.is_absolute():
        path = (_BACKEND_DIR / path).resolve()
    else:
        path = path.resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return "sqlite+aiosqlite:///" + path.as_posix()


def reset_engine() -> None:
    global _engine, _session_maker
    if _engine is not None:
        _engine.sync_engine.dispose()
    _engine = None
    _session_maker = None


def get_engine() -> AsyncEngine:
    global _engine, _session_maker
    if _engine is None:
        settings = ensure_config()
        _engine = create_async_engine(
            _sqlite_url(settings.database_path), echo=False, future=True
        )
        _session_maker = async_sessionmaker(
            _engine,
            class_=AsyncSession,
            expire_on_commit=False,
            autoflush=False,
        )
        logger.info("数据库引擎已创建")
    return _engine


def get_session_maker() -> async_sessionmaker[AsyncSession]:
    get_engine()
    if _session_maker is None:
        raise RuntimeError("数据库会话工厂未初始化")
    return _session_maker


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with get_session_maker()() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_db() -> None:
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("数据库表创建完成")


async def close_db() -> None:
    global _engine, _session_maker
    if _engine is not None:
        await _engine.dispose()
        logger.info("数据库连接已关闭")
    _engine = None
    _session_maker = None
