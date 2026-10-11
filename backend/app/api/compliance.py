"""Org data export (admin only)."""

from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import OrgContext, require_role
from app.api.limits import limit_org
from app.db.dependencies import get_db
from app.services import export_service

router = APIRouter(tags=["Compliance"])


class ExportRequest(BaseModel):
    include_recordings: bool = False


class ExportStatus(BaseModel):
    status: str  # none | queued | running | completed | failed | expired
    error: str | None = None
    size_bytes: int | None = None
    files: int | None = None
    include_recordings: bool | None = None
    expires_at: datetime | None = None
    url: str | None = None  # short-lived presigned link, only on /latest?download=true


@router.post(
    "/orgs/{org_id}/exports",
    status_code=202,
    response_model=ExportStatus,
)
def request_export(
    org_id: int,
    body: ExportRequest | None = None,
    ctx: OrgContext = Depends(require_role()),
    db: Session = Depends(get_db),
    _rate: None = Depends(limit_org("export", "limit_export_per_hour")),
):
    include = (body or ExportRequest()).include_recordings
    export_service.request_export(db, ctx, include)
    return ExportStatus(status="queued", include_recordings=include)


@router.get("/orgs/{org_id}/exports/latest", response_model=ExportStatus)
def latest_export(
    org_id: int,
    download: bool = False,
    ctx: OrgContext = Depends(require_role()),
    db: Session = Depends(get_db),
):
    job = export_service.latest(db, ctx)
    if job is None:
        return ExportStatus(status="none")
    r = job.result or {}
    if job.status == "completed" and r.get("expired"):
        return ExportStatus(status="expired")
    out = ExportStatus(
        status=job.status, error=job.error if job.status == "failed" else None,
        size_bytes=r.get("size_bytes"), files=r.get("files"),
        include_recordings=r.get("include_recordings"),
        expires_at=datetime.fromisoformat(r["expires_at"]) if r.get("expires_at") else None,
    )
    if download and job.status == "completed":
        _, out.url = export_service.download_url(db, ctx)
    return out
