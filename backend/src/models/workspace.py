from pydantic import BaseModel, ConfigDict


class WorkspaceSettingsPublic(BaseModel):
    high_risk_amount_threshold: float | None


class WorkspaceSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    high_risk_amount_threshold: float | None
