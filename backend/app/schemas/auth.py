from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

OrgRole = Literal["admin", "recruiter", "hiring_manager", "interviewer"]


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str = Field(min_length=1, max_length=200)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenRequest(BaseModel):
    token: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    password: str


class UserResponse(BaseModel):
    id: int
    email: str
    full_name: str
    avatar_url: str | None = None
    email_verified: bool

    @classmethod
    def from_user(cls, u) -> "UserResponse":
        return cls(
            id=u.id,
            email=u.email,
            full_name=u.full_name,
            avatar_url=u.avatar_url,
            email_verified=u.email_verified_at is not None,
        )


class OrgSummary(BaseModel):
    id: int
    name: str
    slug: str
    role: OrgRole
    settings: dict = {}


class MeResponse(BaseModel):
    user: UserResponse
    orgs: list[OrgSummary]


class OrgCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class MemberResponse(BaseModel):
    user_id: int
    email: str
    full_name: str
    role: OrgRole


class InvitationCreate(BaseModel):
    email: EmailStr
    role: OrgRole


class InvitationResponse(BaseModel):
    id: int
    email: str
    role: str
    expires_at: datetime


class OrgSettingsUpdate(BaseModel):
    name: str | None = None
    data_retention_days: int | None = Field(default=None, ge=1, le=3650)
    seed_color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    blind_review: bool | None = None
    bot_name: str | None = Field(default=None, max_length=80)
    consent_message: str | None = Field(default=None, min_length=10, max_length=1000)
    auto_join: Literal["all", "tagged", "never"] | None = None
    logo_url: str | None = None
