"""In-app notifications (bell). Creation is best-effort: it must never break the caller."""

import logging
from datetime import UTC, datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import OrgContext
from app.core.errors import NotFound
from app.models.notification import Notification

log = logging.getLogger(__name__)

MAX_LIST = 100


def notify(
    db: Session,
    org_id: int,
    user_id: int | None,
    kind: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
) -> Notification | None:
    """Add a notification and commit it. Returns None when there is nobody to notify."""
    if user_id is None:
        return None
    try:
        n = Notification(
            org_id=org_id, user_id=user_id, kind=kind, title=title[:200],
            body=(body or None) and body[:1000], link=link,
        )
        db.add(n)
        db.commit()
        return n
    except Exception:  # bookkeeping must not break a pipeline
        db.rollback()
        log.exception("failed to create notification (%s)", kind)
        return None


def list_for(db: Session, ctx: OrgContext, unread_only: bool = False, limit: int = 30) -> list[Notification]:
    q = db.query(Notification).filter(
        Notification.org_id == ctx.org_id, Notification.user_id == ctx.user.id
    )
    if unread_only:
        q = q.filter(Notification.read_at.is_(None))
    return q.order_by(Notification.id.desc()).limit(min(limit, MAX_LIST)).all()


def unread_count(db: Session, ctx: OrgContext) -> int:
    return (
        db.query(func.count(Notification.id))
        .filter(
            Notification.org_id == ctx.org_id, Notification.user_id == ctx.user.id,
            Notification.read_at.is_(None),
        )
        .scalar()
        or 0
    )


def mark_read(db: Session, ctx: OrgContext, notification_id: int) -> Notification:
    n = (
        db.query(Notification)
        .filter(
            Notification.id == notification_id, Notification.org_id == ctx.org_id,
            Notification.user_id == ctx.user.id,  # personal: nobody reads or clears another's
        )
        .first()
    )
    if n is None:
        raise NotFound("Notification not found")
    if n.read_at is None:
        n.read_at = datetime.now(UTC)
        db.commit()
    return n


def mark_all_read(db: Session, ctx: OrgContext) -> int:
    now = datetime.now(UTC)
    n = (
        db.query(Notification)
        .filter(
            Notification.org_id == ctx.org_id, Notification.user_id == ctx.user.id,
            Notification.read_at.is_(None),
        )
        .update({"read_at": now}, synchronize_session=False)
    )
    db.commit()
    return n
