from pycore.core import get_logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from src.db.models import Base
from src.models.workspace import WorkspaceSettingsPublic

logger = get_logger()

_SINGLETON_ID = 1
_URGENCY_HIGH_RISK = "high_risk"


class WorkspaceSettings(Base):
    __tablename__ = "workspace_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    high_risk_amount_threshold: Mapped[float | None] = mapped_column(nullable=True)


def urgency_elevated_by_amount(
    amount: float | None,
    high_risk_amount_threshold: float | None,
) -> str | None:
    if high_risk_amount_threshold is None or amount is None:
        return None
    if amount >= high_risk_amount_threshold:
        return _URGENCY_HIGH_RISK
    return None


class WorkspaceSettingsService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get(self) -> WorkspaceSettingsPublic:
        row = await self._get_row()
        threshold = None if row is None else row.high_risk_amount_threshold
        logger.info("已读取工作区金额线", configured=threshold is not None)
        return WorkspaceSettingsPublic(high_risk_amount_threshold=threshold)

    async def update(self, high_risk_amount_threshold: float | None) -> WorkspaceSettingsPublic:
        row = await self._get_row()
        if row is None:
            row = WorkspaceSettings(
                id=_SINGLETON_ID,
                high_risk_amount_threshold=high_risk_amount_threshold,
            )
            self.db.add(row)
        else:
            row.high_risk_amount_threshold = high_risk_amount_threshold
        await self.db.flush()
        logger.info("已更新工作区金额线", configured=high_risk_amount_threshold is not None)
        return WorkspaceSettingsPublic(high_risk_amount_threshold=row.high_risk_amount_threshold)

    async def urgency_from_order_amount(self, amount: float | None) -> str | None:
        settings = await self.get()
        return urgency_elevated_by_amount(amount, settings.high_risk_amount_threshold)

    async def _get_row(self) -> WorkspaceSettings | None:
        result = await self.db.execute(
            select(WorkspaceSettings).where(WorkspaceSettings.id == _SINGLETON_ID)
        )
        return result.scalar_one_or_none()
