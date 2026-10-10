"""Per-org / per-user rate limits for expensive endpoints (upload, rank, analysis)."""

from fastapi import Depends

from app.api.deps import OrgContext, api_error, get_org_context
from app.core import rate_limit
from app.core.config import settings


def limit_org(name: str, setting: str):
    def _dep(ctx: OrgContext = Depends(get_org_context)) -> None:
        limit = getattr(settings, setting)
        if not rate_limit.hit(f"{name}:org:{ctx.org_id}", limit, 3600):
            raise api_error(429, f"Rate limit reached for {name} ({limit}/hour)", "rate_limited")

    return _dep


def limit_user(name: str, setting: str):
    def _dep(ctx: OrgContext = Depends(get_org_context)) -> None:
        limit = getattr(settings, setting)
        if not rate_limit.hit(f"{name}:user:{ctx.user.id}", limit, 3600):
            raise api_error(429, f"Rate limit reached for {name} ({limit}/hour)", "rate_limited")

    return _dep
