from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

RoleStatus = Literal["open", "paused", "closed"]


class RoleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    experience_level: str
    experience_required_years: int = Field(ge=0, le=60)
    description: str | None = None


class RoleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    experience_level: str | None = None
    experience_required_years: int | None = Field(default=None, ge=0, le=60)
    description: str | None = None
    status: RoleStatus | None = None


class RoleResponse(BaseModel):
    id: int
    name: str
    experience_level: str
    experience_required_years: int
    description: str | None = None
    status: str = "open"
    created_at: datetime

    model_config = {"from_attributes": True}
