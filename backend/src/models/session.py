from pydantic import BaseModel, Field, field_validator


class SessionCreate(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)

    @field_validator("username", "password")
    @classmethod
    def not_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("请输入用户名和密码")
        return stripped


class SessionPublic(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str
    role: str


class CurrentSessionPublic(BaseModel):
    username: str
    role: str
