import re
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.api.deps import OrgContext
from app.core import email as mailer
from app.core.config import settings
from app.models.tenancy import MEMBERSHIP_ROLES, Invitation, Membership, Organization, User
from app.services.auth_service import AuthError
from app.services import audit_service

ALLOWED_SETTINGS = {
    "seed_color", "blind_review", "bot_name", "consent_message", "auto_join", "logo_url",
}


def public_settings(settings: dict | None) -> dict:
    """Org settings safe to send to browsers: drops encrypted secrets such as the Slack URL."""
    return {k: v for k, v in (settings or {}).items() if not k.endswith("_enc")}


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:60] or "org"


def create_org(db: Session, user: User, name: str) -> Organization:
    base = _slugify(name)
    slug, n = base, 1
    while db.query(Organization).filter(Organization.slug == slug).first():
        n += 1
        slug = f"{base}-{n}"
    org = Organization(name=name.strip(), slug=slug, settings={})
    db.add(org)
    db.flush()
    db.add(Membership(org_id=org.id, user_id=user.id, role="admin"))
    db.commit()
    db.refresh(org)
    return org


def list_user_orgs(db: Session, user: User) -> list[tuple[Organization, str]]:
    rows = db.query(Membership).filter(Membership.user_id == user.id).all()
    return [(m.org, m.role) for m in rows]


def list_members(db: Session, ctx: OrgContext) -> list[Membership]:
    return db.query(Membership).filter(Membership.org_id == ctx.org_id).all()


def invite(db: Session, ctx: OrgContext, email: str, role: str) -> Invitation:
    if role not in MEMBERSHIP_ROLES:
        raise AuthError(422, "Unknown role", "invalid_role")
    inv = Invitation(
        org_id=ctx.org_id,
        email=email.strip().lower(),
        role=role,
        token=secrets.token_urlsafe(32),
        expires_at=datetime.now(UTC) + timedelta(days=7),
    )
    db.add(inv)
    audit_service.record(db, ctx, "member.invited", "invitation", None, email=inv.email, role=role)
    db.commit()
    db.refresh(inv)
    link = f"{settings.frontend_url}/invite?token={inv.token}"
    mailer.send_email(
        inv.email, f"You're invited to {ctx.org.name} on Intervue", f"Join: {link}"
    )
    return inv


def accept_invitation(db: Session, user: User, token: str) -> Membership:
    inv = db.query(Invitation).filter(Invitation.token == token).first()
    expires = inv.expires_at if inv and inv.expires_at.tzinfo else (
        inv.expires_at.replace(tzinfo=UTC) if inv else None
    )
    if inv is None or inv.accepted_at is not None or expires < datetime.now(UTC):
        raise AuthError(400, "Invalid or expired invitation", "invalid_invitation")
    if inv.email != user.email.lower():
        raise AuthError(403, "Invitation was issued to a different email", "wrong_email")
    existing = (
        db.query(Membership)
        .filter(Membership.org_id == inv.org_id, Membership.user_id == user.id)
        .first()
    )
    if existing is None:
        existing = Membership(org_id=inv.org_id, user_id=user.id, role=inv.role)
        db.add(existing)
    inv.accepted_at = datetime.now(UTC)
    db.commit()
    db.refresh(existing)
    return existing


def remove_member(db: Session, ctx: OrgContext, user_id: int) -> None:
    m = (
        db.query(Membership)
        .filter(Membership.org_id == ctx.org_id, Membership.user_id == user_id)
        .first()
    )
    if m is None:
        raise AuthError(404, "Member not found", "not_found")
    if m.role == "admin":
        admins = (
            db.query(Membership)
            .filter(Membership.org_id == ctx.org_id, Membership.role == "admin")
            .count()
        )
        if admins <= 1:
            raise AuthError(409, "Cannot remove the last admin", "last_admin")
    db.delete(m)
    audit_service.record(db, ctx, "member.removed", "user", user_id)
    db.commit()


def update_settings(db: Session, ctx: OrgContext, data: dict) -> Organization:
    org = ctx.org
    if "name" in data and data["name"]:
        org.name = data.pop("name")
    if "data_retention_days" in data and data["data_retention_days"]:
        org.data_retention_days = int(data.pop("data_retention_days"))
    merged = dict(org.settings or {})
    merged.update({k: v for k, v in data.items() if k in ALLOWED_SETTINGS})
    org.settings = merged
    db.commit()
    db.refresh(org)
    return org
