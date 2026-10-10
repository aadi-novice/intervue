"""Calendar connections, synced events, and provider push webhooks (M6)."""

import json

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import PlainTextResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.api.deps import OrgContext, get_org_context
from app.api.limits import limit_user
from app.core.config import settings
from app.core.errors import DomainError
from app.db.dependencies import get_db
from app.models.calendar import CalendarEvent
from app.models.candidate import Candidate
from app.models.interview import Interview
from app.schemas.calendar import (
    AutoJoinUpdate,
    CalendarEventOut,
    ConnectionOut,
    ConnectUrl,
    EventCandidate,
    ProviderOut,
    TagRequest,
)
from app.services import calendar_service

router = APIRouter(tags=["Calendar"])


def _event_out(db: Session, e: CalendarEvent) -> CalendarEventOut:
    cand = db.get(Candidate, e.candidate_id) if e.candidate_id else None
    iv = db.get(Interview, e.interview_id) if e.interview_id else None
    return CalendarEventOut(
        id=e.id, connection_id=e.connection_id, title=e.title, start=e.start, end=e.end,
        meeting_url=e.meeting_url, platform=iv.platform if iv else None, attendees=e.attendees or [],
        candidate=EventCandidate(id=cand.id, name=cand.name) if cand else None,
        tagged=e.tagged, interview_id=e.interview_id,
        bot_status=iv.bot_sessions[-1].status if iv and iv.bot_sessions else None,
        skip_reason=e.skip_reason,
    )


@router.get("/calendar/providers", response_model=list[ProviderOut])
def providers(ctx: OrgContext = Depends(get_org_context)):
    return [
        ProviderOut(provider=name, configured=a.configured())
        for name, a in calendar_service.ADAPTERS.items()
    ]


@router.get("/calendar/connections", response_model=list[ConnectionOut])
def connections(ctx: OrgContext = Depends(get_org_context), db: Session = Depends(get_db)):
    return [ConnectionOut.from_model(c) for c in calendar_service.list_connections(db, ctx)]


@router.get("/calendar/connect/{provider}", response_model=ConnectUrl)
def connect(provider: str, ctx: OrgContext = Depends(get_org_context)):
    return ConnectUrl(url=calendar_service.connect_url(ctx, provider))


@router.get("/calendar/oauth/{provider}/callback", include_in_schema=False)
def oauth_callback(
    provider: str,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    """Browser redirect target; identity comes from the signed `state`, not a cookie."""
    base = f"{settings.frontend_url.rstrip('/')}/settings?tab=integrations"
    if error or not code or not state:
        return RedirectResponse(f"{base}&calendar_error={error or 'cancelled'}", status_code=302)
    try:
        conn = calendar_service.complete_oauth(db, provider, code, state)
    except DomainError as e:
        return RedirectResponse(f"{base}&calendar_error={e.code}", status_code=302)
    from app.worker.tasks.calendar import sync_connection_task

    sync_connection_task.delay(conn.id)
    return RedirectResponse(f"{base}&calendar=connected", status_code=302)


@router.patch("/calendar/connections/{connection_id}", response_model=ConnectionOut)
def update_connection(
    connection_id: int,
    body: AutoJoinUpdate,
    ctx: OrgContext = Depends(get_org_context),
    db: Session = Depends(get_db),
):
    return ConnectionOut.from_model(calendar_service.set_auto_join(db, ctx, connection_id, body.auto_join))


@router.delete("/calendar/connections/{connection_id}", status_code=204)
def delete_connection(
    connection_id: int, ctx: OrgContext = Depends(get_org_context), db: Session = Depends(get_db)
):
    calendar_service.disconnect(db, ctx, connection_id)
    return Response(status_code=204)


@router.post(
    "/calendar/connections/{connection_id}/sync",
    status_code=202,
    dependencies=[Depends(limit_user("calendar_sync", "limit_uploads_per_hour"))],
)
def sync_now(
    connection_id: int, ctx: OrgContext = Depends(get_org_context), db: Session = Depends(get_db)
):
    calendar_service._own_connection(db, ctx, connection_id)  # 404 unless it is yours
    from app.worker.tasks.calendar import sync_connection_task

    sync_connection_task.delay(connection_id)
    return {"status": "queued"}


@router.get("/calendar/events", response_model=list[CalendarEventOut])
def events(
    connection_id: int | None = None,
    ctx: OrgContext = Depends(get_org_context),
    db: Session = Depends(get_db),
):
    return [_event_out(db, e) for e in calendar_service.list_events(db, ctx, connection_id)]


@router.post("/calendar/events/{event_id}/tag", response_model=CalendarEventOut)
def tag_event(
    event_id: int,
    body: TagRequest,
    ctx: OrgContext = Depends(get_org_context),
    db: Session = Depends(get_db),
):
    return _event_out(db, calendar_service.tag_event(db, ctx, event_id, body.tagged, body.candidate_id))


# ── provider push notifications (public; authenticated by our per-connection secret) ──
@router.post("/webhooks/calendar/google", include_in_schema=False)
def google_push(request: Request, db: Session = Depends(get_db)):
    h = request.headers
    conn = calendar_service.connection_for_push(
        db, "google", h.get("x-goog-channel-id", ""), h.get("x-goog-channel-token")
    )
    if conn is None:
        return Response(status_code=204)  # never reveal which channels exist
    if h.get("x-goog-resource-state") != "sync":  # "sync" is the initial handshake
        from app.worker.tasks.calendar import sync_connection_task

        sync_connection_task.delay(conn.id)
    return Response(status_code=204)


@router.post("/webhooks/calendar/microsoft", include_in_schema=False)
async def microsoft_push(request: Request, validationToken: str | None = None, db: Session = Depends(get_db)):
    if validationToken:  # subscription handshake: echo the token as plain text
        return PlainTextResponse(validationToken)
    try:
        payload = json.loads(await request.body())
    except ValueError:
        return Response(status_code=202)
    from app.worker.tasks.calendar import sync_connection_task

    queued: set[int] = set()
    for n in payload.get("value", []):
        conn = calendar_service.connection_for_push(
            db, "microsoft", str(n.get("subscriptionId", "")), n.get("clientState")
        )
        if conn is not None and conn.id not in queued:
            queued.add(conn.id)
            sync_connection_task.delay(conn.id)
    return Response(status_code=202)
