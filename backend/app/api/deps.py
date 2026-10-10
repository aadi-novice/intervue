"""Auth dependencies: current user, org context, role guards."""

from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from app.core import security
from app.db.dependencies import get_db
from app.models.tenancy import Membership, Organization, User

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def api_error(status: int, detail: str, code: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"detail": detail, "code": code})


@dataclass
class OrgContext:
    user: User
    org: Organization
    role: str

    @property
    def org_id(self) -> int:
        return self.org.id


def _token_from_request(request: Request) -> tuple[str | None, bool]:
    """Returns (token, via_cookie)."""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip(), False
    cookie = request.cookies.get("access_token")
    return cookie, True


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token, via_cookie = _token_from_request(request)
    if not token:
        raise api_error(401, "Not authenticated", "not_authenticated")
    user_id = security.decode_access_token(token)
    if user_id is None:
        raise api_error(401, "Invalid or expired token", "invalid_token")
    if via_cookie and request.method not in SAFE_METHODS:
        if not security.csrf_matches(
            request.cookies.get("csrf_token"), request.headers.get("x-csrf-token")
        ):
            raise api_error(403, "CSRF token missing or invalid", "csrf_failed")
    user = db.get(User, user_id)
    if user is None:
        raise api_error(401, "User not found", "invalid_token")
    return user


def get_org_context(
    request: Request,
    user: User = Depends(get_current_user),
    x_org_id: int | None = Header(default=None),
    db: Session = Depends(get_db),
) -> OrgContext:
    # /orgs/{org_id}/... routes name the org in the path; everything else uses X-Org-Id.
    path_org = request.path_params.get("org_id")
    if path_org is not None:
        try:
            x_org_id = int(path_org)
        except ValueError:
            raise api_error(404, "Organization not found", "not_found")
    if x_org_id is None:
        raise api_error(400, "X-Org-Id header required", "org_required")
    membership = (
        db.query(Membership)
        .filter(Membership.user_id == user.id, Membership.org_id == x_org_id)
        .first()
    )
    if membership is None:
        raise api_error(403, "Not a member of this organization", "wrong_org")
    return OrgContext(user=user, org=membership.org, role=membership.role)


def require_role(*roles: str):
    """Dependency factory. Admins always pass."""
    allowed = set(roles) | {"admin"}

    def _dep(ctx: OrgContext = Depends(get_org_context)) -> OrgContext:
        if ctx.role not in allowed:
            raise api_error(403, "Insufficient role", "forbidden")
        return ctx

    return _dep
