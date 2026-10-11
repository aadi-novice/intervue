from datetime import datetime

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import OrgContext, get_org_context
from app.db.dependencies import get_db
from app.services import notification_service

router = APIRouter(prefix="/notifications", tags=["Notifications"])


class NotificationOut(BaseModel):
    id: int
    kind: str
    title: str
    body: str | None = None
    link: str | None = None
    read: bool
    created_at: datetime

    @classmethod
    def from_model(cls, n) -> "NotificationOut":
        return cls(id=n.id, kind=n.kind, title=n.title, body=n.body, link=n.link,
                   read=n.read_at is not None, created_at=n.created_at)


@router.get("", response_model=list[NotificationOut])
def list_notifications(
    unread_only: bool = False,
    limit: int = Query(default=30, ge=1, le=100),
    ctx: OrgContext = Depends(get_org_context),
    db: Session = Depends(get_db),
):
    return [NotificationOut.from_model(n) for n in notification_service.list_for(db, ctx, unread_only, limit)]


@router.get("/unread-count")
def unread_count(ctx: OrgContext = Depends(get_org_context), db: Session = Depends(get_db)):
    return {"count": notification_service.unread_count(db, ctx)}


@router.post("/read-all")
def read_all(ctx: OrgContext = Depends(get_org_context), db: Session = Depends(get_db)):
    return {"updated": notification_service.mark_all_read(db, ctx)}


@router.post("/{notification_id}/read", status_code=204)
def read_one(
    notification_id: int, ctx: OrgContext = Depends(get_org_context), db: Session = Depends(get_db)
):
    notification_service.mark_read(db, ctx, notification_id)
    return Response(status_code=204)
