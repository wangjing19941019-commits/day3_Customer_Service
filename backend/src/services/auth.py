from datetime import UTC, datetime, timedelta

import bcrypt
from jose import JWTError, jwt
from pycore.core.config import get_config
from pycore.core.logger import get_logger
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import User
from src.db.session import ensure_config, get_session_maker
from src.repositories.user_repository import UserRepository

logger = get_logger()

_JWT_ALGORITHM = "HS256"

SEED_USERS: tuple[tuple[str, str], ...] = (
    ("employee", "employee"),
    ("agent", "frontline_agent"),
    ("specialist", "after_sales_specialist"),
    ("senior", "senior_after_sales"),
    ("supervisor", "supervisor"),
    ("after_sales_supervisor", "after_sales_supervisor"),
    ("cs_lead", "cs_lead"),
    ("logistics_agent", "logistics_after_sales"),
    ("cs_supervisor", "cs_supervisor"),
    ("admin", "admin"),
)

SEED_USERNAMES = {username for username, _ in SEED_USERS}


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def _seed_password() -> str:
    raw = get_config().get("seed_password")
    if raw is None:
        return ""
    return str(raw).strip()


def create_access_token(username: str, role: str) -> str:
    settings = ensure_config()
    expire = datetime.now(UTC) + timedelta(minutes=settings.jwt_expire_minutes)
    return jwt.encode(
        {"sub": username, "role": role, "exp": expire},
        settings.secret_key,
        algorithm=_JWT_ALGORITHM,
    )


def decode_access_token(token: str) -> str | None:
    settings = ensure_config()
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[_JWT_ALGORITHM])
    except JWTError:
        logger.info("JWT 解码失败，视为未登录")
        return None
    username = payload.get("sub")
    if not isinstance(username, str) or not username:
        logger.info("JWT 缺少有效用户名，视为未登录")
        return None
    return username


async def authenticate(db: AsyncSession, username: str, password: str) -> User | None:
    repo = UserRepository(db)
    user = await repo.get_by_username(username)
    if user is None:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    return user


async def shared_account_uninitialized(db: AsyncSession) -> bool:
    settings = ensure_config()
    if settings.shared_password:
        return False
    repo = UserRepository(db)
    existing = await repo.get_by_username(settings.shared_username)
    return existing is None


async def seed_accounts_uninitialized(db: AsyncSession, username: str) -> bool:
    if username not in SEED_USERNAMES:
        return False
    if _seed_password():
        return False
    repo = UserRepository(db)
    existing = await repo.get_by_username(username)
    return existing is None


async def seed_users() -> None:
    settings = ensure_config()
    username = settings.shared_username
    shared_password = settings.shared_password or ""
    seed_password = _seed_password()
    async with get_session_maker()() as session:
        repo = UserRepository(session)
        await repo.ensure_columns()
        existing = await repo.get_by_username(username)
        if existing is None:
            if not shared_password:
                logger.warning("共享账号未初始化且配置缺密码，登录将不可用")
            else:
                await repo.create(username, hash_password(shared_password), role="employee")
                logger.info("已写入共享账号哈希")
        else:
            if existing.role != "employee":
                await repo.set_role(existing, "employee")
            logger.info("共享账号已存在，跳过写入哈希")
        created = 0
        if seed_password:
            hashed = hash_password(seed_password)
            for seed_username, role in SEED_USERS:
                seed_user = await repo.get_by_username(seed_username)
                if seed_user is None:
                    await repo.create(seed_username, hashed, role=role)
                    created += 1
                elif not seed_user.role:
                    await repo.set_role(seed_user, role)
            logger.info("角色种子账号处理完成", created=created)
        else:
            missing = False
            for seed_username, _role in SEED_USERS:
                if await repo.get_by_username(seed_username) is None:
                    missing = True
                    break
            if missing:
                logger.warning("角色种子未初始化且配置缺 seed_password")
        await session.commit()
