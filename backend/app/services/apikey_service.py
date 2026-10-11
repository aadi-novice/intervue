"""Read-only public API keys (M10b). Only a SHA-256 of the key is stored; shown once at creation."""

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.api.deps import OrgContext
from app.core.errors import Conflict, NotFound
from app.models.integrations import ApiKey
from app.models.tenancy import Membership
from app.services import audit_service

MAX_KEYS = 20
PREFIX_LEN = 8
TOUCH_EVERY = timedelta(minutes=1)


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(dt):
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=UTC)


def _hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def create(db: Session, ctx: OrgContext, name: str, expires_in_days: int | None) -> tuple[ApiKey, str]:
    active = db.query(ApiKey).filter(ApiKey.org_id == ctx.org_id, ApiKey.revoked_at.is_(None)).count()
    if active >= MAX_KEYS:
        raise Conflict(f"At most {MAX_KEYS} active API keys", "too_many_keys")
    prefix = secrets.token_hex(PREFIX_LEN // 2)
    key = f"ik_{prefix}_{secrets.token_urlsafe(32)}"
    row = ApiKey(
        org_id=ctx.org_id, name=name.strip(), prefix=prefix, key_hash=_hash(key),
        created_by_user_id=ctx.user.id,
        expires_at=_now() + timedelta(days=expires_in_days) if expires_in_days else None,
    )
    db.add(row)
    db.flush()
    audit_service.record(db, ctx, "api_key.created", "api_key", row.id, name=row.name)
    db.commit()
    db.refresh(row)
    return row, key


def list_keys(db: Session, ctx: OrgContext) -> list[ApiKey]:
    return db.query(ApiKey).filter(ApiKey.org_id == ctx.org_id).order_by(ApiKey.id.desc()).all()


def revoke(db: Session, ctx: OrgContext, key_id: int) -> None:
    row = db.query(ApiKey).filter(ApiKey.id == key_id, ApiKey.org_id == ctx.org_id).first()
    if row is None:
        raise NotFound("API key not found")
    if row.revoked_at is None:
        row.revoked_at = _now()
        audit_service.record(db, ctx, "api_key.revoked", "api_key", row.id)
        db.commit()


def authenticate(db: Session, presented: str | None) -> ApiKey | None:
    """Return the key row for a valid, active key; None otherwise (never says why)."""
    if not presented or not presented.startswith("ik_"):
        return None
    parts = presented.split("_", 2)
    if len(parts) != 3 or len(parts[1]) != PREFIX_LEN:
        return None
    row = db.query(ApiKey).filter(ApiKey.prefix == parts[1]).first()
    if row is None or not hmac.compare_digest(row.key_hash, _hash(presented)):
        return None
    if row.revoked_at is not None or (row.expires_at and _aware(row.expires_at) < _now()):
        return None
    # a key dies with its creator's membership
    if row.created_by_user_id is None or not db.query(Membership.id).filter(
        Membership.org_id == row.org_id, Membership.user_id == row.created_by_user_id
    ).first():
        return None
    if row.last_used_at is None or _now() - _aware(row.last_used_at) > TOUCH_EVERY:
        row.last_used_at = _now()
        db.commit()
    return row
