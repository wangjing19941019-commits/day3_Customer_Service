from datetime import UTC, datetime

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import User


class UserRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def ensure_columns(self) -> None:
        result = await self.db.execute(text("PRAGMA table_info(users)"))
        cols = {row[1] for row in result.fetchall()}
        if "role" not in cols:
            await self.db.execute(
                text("ALTER TABLE users ADD COLUMN role VARCHAR(64) NOT NULL DEFAULT 'employee'")
            )
        if "last_seen_at" not in cols:
            await self.db.execute(text("ALTER TABLE users ADD COLUMN last_seen_at DATETIME"))

    async def get_by_username(self, username: str) -> User | None:
        result = await self.db.execute(select(User).where(User.username == username))
        return result.scalar_one_or_none()

    async def create(
        self, username: str, hashed_password: str, role: str = "employee"
    ) -> User:
        user = User(username=username, hashed_password=hashed_password, role=role)
        self.db.add(user)
        try:
            await self.db.flush()
        except IntegrityError as exc:
            await self.db.rollback()
            raise ValueError("数据冲突") from exc
        await self.db.refresh(user)
        return user

    async def set_role(self, user: User, role: str) -> User:
        user.role = role
        await self.db.flush()
        await self.db.refresh(user)
        return user

    async def touch_last_seen(self, user: User) -> User:
        user.last_seen_at = datetime.now(UTC)
        await self.db.flush()
        await self.db.refresh(user)
        return user
