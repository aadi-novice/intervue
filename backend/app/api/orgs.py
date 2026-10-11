from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.api.deps import OrgContext, api_error, get_current_user, require_role
from app.db.dependencies import get_db
from app.models.tenancy import User
from app.schemas.auth import (
    InvitationCreate,
    InvitationResponse,
    MemberResponse,
    OrgCreate,
    OrgSettingsUpdate,
    OrgSummary,
    TokenRequest,
)
from app.services import org_service
from app.services.auth_service import AuthError

router = APIRouter(prefix="/orgs", tags=["Organizations"])


def _raise(e: AuthError):
    raise api_error(e.status, e.detail, e.code)


@router.post("", status_code=201, response_model=OrgSummary)
def create_org(
    body: OrgCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    org = org_service.create_org(db, user, body.name)
    return OrgSummary(id=org.id, name=org.name, slug=org.slug, role="admin", settings=org_service.public_settings(org.settings))


@router.get("/me", response_model=list[OrgSummary])
def my_orgs(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return [
        OrgSummary(id=o.id, name=o.name, slug=o.slug, role=r, settings=org_service.public_settings(o.settings))
        for o, r in org_service.list_user_orgs(db, user)
    ]


@router.post("/invitations/accept", response_model=OrgSummary)
def accept_invitation(
    body: TokenRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    try:
        m = org_service.accept_invitation(db, user, body.token)
    except AuthError as e:
        _raise(e)
    return OrgSummary(
        id=m.org.id, name=m.org.name, slug=m.org.slug, role=m.role, settings=org_service.public_settings(m.org.settings)
    )


@router.get("/{org_id}/members", response_model=list[MemberResponse])
def members(org_id: int, ctx: OrgContext = Depends(require_role("recruiter", "hiring_manager")),
            db: Session = Depends(get_db)):
    return [
        MemberResponse(user_id=m.user_id, email=m.user.email, full_name=m.user.full_name, role=m.role)
        for m in org_service.list_members(db, ctx)
    ]


@router.post("/{org_id}/invitations", status_code=201, response_model=InvitationResponse)
def invite(org_id: int, body: InvitationCreate, ctx: OrgContext = Depends(require_role()),
           db: Session = Depends(get_db)):
    try:
        inv = org_service.invite(db, ctx, body.email, body.role)
    except AuthError as e:
        _raise(e)
    return InvitationResponse(id=inv.id, email=inv.email, role=inv.role, expires_at=inv.expires_at)


@router.delete("/{org_id}/members/{user_id}", status_code=204)
def remove_member(org_id: int, user_id: int, ctx: OrgContext = Depends(require_role()),
                  db: Session = Depends(get_db)):
    try:
        org_service.remove_member(db, ctx, user_id)
    except AuthError as e:
        _raise(e)
    return Response(status_code=204)


@router.patch("/{org_id}/settings", response_model=OrgSummary)
def update_settings(org_id: int, body: OrgSettingsUpdate, ctx: OrgContext = Depends(require_role()),
                    db: Session = Depends(get_db)):
    org = org_service.update_settings(db, ctx, body.model_dump(exclude_none=True))
    return OrgSummary(id=org.id, name=org.name, slug=org.slug, role=ctx.role, settings=org_service.public_settings(org.settings))
