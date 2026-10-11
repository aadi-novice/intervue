"""
Calendar auto-join (M6).

Flow: a user connects Google/Microsoft (OAuth, tokens Fernet-encrypted) -> we sync their next
`CALENDAR_WINDOW_DAYS` of events every few minutes (and immediately on push notifications) ->
events with a Meet/Teams/Zoom link whose attendees include a known candidate become interviews
-> depending on the user's auto-join setting the notetaker is scheduled for 1 minute before start.

Provider HTTP lives in `app/services/calendar/{google,microsoft}.py` only.
"""

import hashlib
import hmac
import logging
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse

import httpx
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import OrgContext
from app.core import crypto
from app.core import email as mailer
from app.core import security
from app.core.config import settings
from app.core.errors import DomainError, Invalid, NotFound
from app.models.calendar import AUTO_JOIN_MODES, CalendarConnection, CalendarEvent
from app.models.candidate import Candidate
from app.models.interview import Interview, InterviewParticipant
from app.models.tenancy import AuditLog, Membership, Organization, User
from app.services import bot_service, interview_service
from app.services.calendar import google, microsoft
from app.services.calendar.types import (
    CalendarApiError,
    CalendarAuthError,
    RawEvent,
)

log = logging.getLogger(__name__)

ADAPTERS = {"google": google, "microsoft": microsoft}
BOT_ROLES = ("admin", "recruiter", "hiring_manager")
STATE_SALT = "calendar-oauth"
TOKEN_SKEW = timedelta(seconds=120)


class NotConfigured(DomainError):
    status, code = 501, "oauth_not_configured"


def http_client() -> httpx.Client:
    return httpx.Client(timeout=20, follow_redirects=False)


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(dt: datetime | None) -> datetime | None:
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=UTC)


def adapter(provider: str):
    a = ADAPTERS.get(provider)
    if a is None:
        raise NotFound("Unknown calendar provider")
    return a


def redirect_uri(provider: str) -> str:
    return f"{settings.public_api_url.rstrip('/')}/calendar/oauth/{provider}/callback"


def _audit(db: Session, org_id: int, user_id: int | None, action: str, entity_id=None, **meta):
    db.add(
        AuditLog(
            org_id=org_id, user_id=user_id, action=action, entity_type="calendar",
            entity_id=str(entity_id) if entity_id is not None else None, metadata_=meta,
        )
    )


# ── OAuth ─────────────────────────────────────────────────────────────────────
def connect_url(ctx: OrgContext, provider: str) -> str:
    a = adapter(provider)
    if not a.configured():
        raise NotConfigured(f"{provider} calendar sign-in is not configured on this server")
    state = security.make_signed_token(
        {"u": ctx.user.id, "o": ctx.org_id, "p": provider, "n": secrets.token_urlsafe(8)}, STATE_SALT
    )
    return a.authorize_url(redirect_uri(provider), state, login_hint=ctx.user.email)


def complete_oauth(
    db: Session, provider: str, code: str, state: str, http: httpx.Client | None = None
) -> CalendarConnection:
    data = security.read_signed_token(state, STATE_SALT, 600)
    if not data or data.get("p") != provider:
        raise Invalid("Invalid or expired state; start the connection again", "bad_state")
    membership = (
        db.query(Membership)
        .filter(Membership.user_id == data["u"], Membership.org_id == data["o"])
        .first()
    )
    if membership is None:
        raise Invalid("You are no longer a member of this organization", "wrong_org")
    a = adapter(provider)
    own = http is None
    http = http or http_client()
    try:
        tokens = a.exchange_code(http, code, redirect_uri(provider))
    except CalendarAuthError as e:
        raise Invalid(str(e), "oauth_denied")
    except CalendarApiError as e:
        raise Invalid(str(e), "oauth_failed")
    finally:
        if own:
            http.close()
    if not tokens.account_email:
        raise Invalid("Could not determine the calendar account email", "no_account_email")

    conn = (
        db.query(CalendarConnection)
        .filter(
            CalendarConnection.org_id == data["o"], CalendarConnection.user_id == data["u"],
            CalendarConnection.provider == provider,
            CalendarConnection.account_email == tokens.account_email,
        )
        .first()
    )
    if conn is None:
        if not tokens.refresh_token:
            raise Invalid("The provider did not grant offline access; reconnect and accept all permissions", "no_refresh_token")
        conn = CalendarConnection(
            org_id=data["o"], user_id=data["u"], provider=provider,
            account_email=tokens.account_email, access_token_enc="", auto_join="tagged",
        )
        db.add(conn)
    conn.access_token_enc = crypto.encrypt(tokens.access_token)
    if tokens.refresh_token:
        conn.refresh_token_enc = crypto.encrypt(tokens.refresh_token)
    conn.token_expires_at = tokens.expires_at
    conn.scopes = tokens.scopes
    conn.status, conn.last_error = "active", None
    db.flush()
    _audit(db, conn.org_id, conn.user_id, "calendar.connected", conn.id, provider=provider)
    db.commit()
    db.refresh(conn)
    return conn


# ── tokens ────────────────────────────────────────────────────────────────────
def access_token(db: Session, conn: CalendarConnection, http: httpx.Client) -> str:
    exp = _aware(conn.token_expires_at)
    if exp and exp - _now() > TOKEN_SKEW:
        return crypto.decrypt(conn.access_token_enc)
    if not conn.refresh_token_enc:
        raise CalendarAuthError("No refresh token stored")
    ts = adapter(conn.provider).refresh(http, crypto.decrypt(conn.refresh_token_enc))
    conn.access_token_enc = crypto.encrypt(ts.access_token)
    if ts.refresh_token:
        conn.refresh_token_enc = crypto.encrypt(ts.refresh_token)
    conn.token_expires_at = ts.expires_at
    db.commit()
    return ts.access_token


def _mark_reauth(db: Session, conn: CalendarConnection, why: str) -> None:
    first = conn.status != "needs_reauth"
    conn.status, conn.last_error = "needs_reauth", why[:500]
    db.commit()
    if first:
        from app.services import notification_service

        notification_service.notify(
            db, conn.org_id, conn.user_id, "calendar_reauth", "Reconnect your calendar",
            f"Access to {conn.account_email} ({conn.provider}) expired or was revoked.",
            "/settings?tab=integrations",
        )
        user = db.get(User, conn.user_id)
        if user:
            mailer.send_email(
                user.email,
                "Reconnect your calendar to Intervue",
                f"Intervue lost access to your {conn.provider} calendar ({conn.account_email}). "
                f"Reconnect it in Settings > Integrations to keep auto-join working.\n"
                f"{settings.frontend_url}/settings",
            )


# ── watches (push notifications) ──────────────────────────────────────────────
def watch_secret(conn_id: int) -> str:
    return hmac.new(
        settings.internal_hmac_secret.encode(), f"calendar-watch:{conn_id}".encode(), hashlib.sha256
    ).hexdigest()[:48]


def push_possible() -> bool:
    if not settings.calendar_push_enabled:
        return False
    u = urlparse(settings.public_api_url)
    return u.scheme == "https" and (u.hostname or "") not in ("localhost", "127.0.0.1", "")


def _webhook_url(provider: str) -> str:
    return f"{settings.public_api_url.rstrip('/')}/webhooks/calendar/{provider}"


def ensure_watch(db: Session, conn: CalendarConnection, http: httpx.Client) -> bool:
    """Create or renew the push channel. Never raises: polling still works without it."""
    if not push_possible():
        return False
    expiring = conn.watch_expires_at is None or _aware(conn.watch_expires_at) - _now() < timedelta(hours=12)
    if not expiring:
        return True
    a = adapter(conn.provider)
    try:
        token = access_token(db, conn, http)
        if conn.watch_id and conn.provider == "microsoft":
            info = a.renew_watch(http, token, conn.watch_id)
        else:
            if conn.watch_id:
                a.stop_watch(http, token, conn.watch_id, conn.watch_resource)
            info = a.create_watch(http, token, _webhook_url(conn.provider), watch_secret(conn.id))
        conn.watch_id, conn.watch_expires_at = info.watch_id, info.expires_at
        conn.watch_resource = info.resource or conn.watch_resource
        db.commit()
        return True
    except CalendarAuthError as e:
        _mark_reauth(db, conn, str(e))
    except (CalendarApiError, httpx.HTTPError) as e:
        log.warning("calendar watch failed for connection %s: %s", conn.id, e)
        db.rollback()
    return False


def connection_for_push(db: Session, provider: str, watch_id: str, secret: str | None):
    conn = (
        db.query(CalendarConnection)
        .filter(CalendarConnection.provider == provider, CalendarConnection.watch_id == watch_id)
        .first()
    )
    if conn is None or not secret or not hmac.compare_digest(secret, watch_secret(conn.id)):
        return None
    return conn


# ── sync ──────────────────────────────────────────────────────────────────────
@dataclass
class SyncResult:
    seen: int = 0
    created: int = 0
    updated: int = 0
    cancelled: int = 0
    bots: int = 0


def sync_connection(
    db: Session, connection_id: int, http: httpx.Client | None = None
) -> SyncResult:
    conn = db.get(CalendarConnection, connection_id)
    res = SyncResult()
    if conn is None or conn.status == "needs_reauth":
        return res
    membership = (
        db.query(Membership)
        .filter(Membership.org_id == conn.org_id, Membership.user_id == conn.user_id)
        .first()
    )
    if membership is None:
        conn.status, conn.last_error = "error", "Owner is no longer a member of the organization"
        db.commit()
        return res
    org = db.get(Organization, conn.org_id)
    owner = db.get(User, conn.user_id)

    own = http is None
    http = http or http_client()
    try:
        now = _now()
        window_end = now + timedelta(days=settings.calendar_window_days)
        try:
            token = access_token(db, conn, http)
            events = adapter(conn.provider).list_events(http, token, now - timedelta(hours=1), window_end)
        except CalendarAuthError as e:
            _mark_reauth(db, conn, str(e))
            return res
        except crypto.DecryptionError as e:
            _mark_reauth(db, conn, str(e))
            return res
        except (CalendarApiError, httpx.HTTPError) as e:
            conn.last_error = str(e)[:500]
            db.commit()
            return res
        _ingest(db, conn, org, owner, membership.role, events, now, window_end, res)
        conn.last_synced_at, conn.last_error = now, None
        if conn.status == "error":
            conn.status = "active"
        db.commit()
        ensure_watch(db, conn, http)
    finally:
        if own:
            http.close()
    return res


def _ingest(db, conn, org, owner, role, events: list[RawEvent], now, window_end, res: SyncResult):
    usable = [e for e in events if not e.all_day and (e.meeting_url or e.cancelled)]
    emails = {a.email for e in usable for a in e.attendees if a.email}
    cands: dict[str, Candidate] = {}
    org_users: dict[str, int] = {}
    if emails:
        for c in (
            db.query(Candidate)
            .filter(Candidate.org_id == conn.org_id, func.lower(Candidate.email).in_(emails))
            .order_by(Candidate.id)
        ):
            cands.setdefault(c.email.lower(), c)
        for u in (
            db.query(User).join(Membership, Membership.user_id == User.id)
            .filter(Membership.org_id == conn.org_id, func.lower(User.email).in_(emails))
        ):
            org_users[u.email.lower()] = u.id
    existing = {
        r.external_id: r
        for r in db.query(CalendarEvent).filter(CalendarEvent.connection_id == conn.id)
    }
    seen_ids = set()
    for ev in usable:
        seen_ids.add(ev.external_id)
        res.seen += 1
        row = existing.get(ev.external_id)
        is_new = row is None
        if is_new:
            row = CalendarEvent(org_id=conn.org_id, connection_id=conn.id, external_id=ev.external_id,
                                start=ev.start, title=ev.title)
            db.add(row)
        declined = any(
            (a.is_self or a.email == conn.account_email) and a.response == "declined" for a in ev.attendees
        )
        row.title, row.start, row.end = ev.title[:300], ev.start, ev.end
        row.meeting_url = ev.meeting_url or row.meeting_url
        row.cancelled = ev.cancelled or declined
        row.attendees = [{"email": a.email, "name": a.name, "response": a.response} for a in ev.attendees]
        row.version, row.seen_at = ev.version, now
        if not (row.tagged and row.candidate_id):
            others = [a.email for a in ev.attendees if a.email and a.email != conn.account_email and not a.is_self]
            match = next((cands[e] for e in others if e in cands), None)
            row.candidate_id = match.id if match else None
        db.flush()
        outcome = apply_event(db, conn, org, owner, role, row, org_users)
        res.created += outcome.startswith("created")
        res.bots += outcome in ("created+bot", "bot")
        res.cancelled += outcome == "cancelled"
        res.updated += outcome == "updated"

    # events that vanished from the provider inside our window were deleted
    for ext, row in existing.items():
        if ext in seen_ids or row.cancelled:
            continue
        st = _aware(row.start)
        if st and now < st < window_end:
            row.cancelled = True
            if apply_event(db, conn, org, owner, role, row, org_users) == "cancelled":
                res.cancelled += 1
    db.commit()


def _cancel_interview(db: Session, row: CalendarEvent) -> bool:
    if not row.interview_id:
        return False
    iv = db.get(Interview, row.interview_id)
    if iv is None or iv.status != "scheduled":
        return False
    bot_service.cancel_scheduled_bot(db, iv)
    iv.status = "cancelled"
    return True


def apply_event(db, conn, org, owner, role, row: CalendarEvent, org_users: dict | None = None) -> str:
    """Make the interview/bot for one calendar row match its current state.

    Returns: none | created | created+bot | updated | bot | cancelled
    """
    if row.cancelled:
        row.skip_reason = None
        return "cancelled" if _cancel_interview(db, row) else "none"
    if not row.candidate_id:
        row.skip_reason = "no_candidate_match"
        return "none"
    cand = db.get(Candidate, row.candidate_id)
    if cand is None or cand.org_id != conn.org_id:
        row.candidate_id, row.skip_reason = None, "no_candidate_match"
        return "none"

    outcome = "none"
    iv = db.get(Interview, row.interview_id) if row.interview_id else None
    if iv is None:
        iv = _create_interview(db, conn, owner, role, row, cand, org_users or {})
        row.interview_id = iv.id
        outcome = "created"
    elif iv.status == "scheduled":
        moved = _aware(iv.scheduled_start) != _aware(row.start)
        if moved or iv.meeting_url != row.meeting_url or iv.title != row.title:
            iv.scheduled_start, iv.scheduled_end = row.start, row.end
            iv.meeting_url, iv.title = row.meeting_url, row.title[:200]
            try:
                iv.platform = interview_service.detect_platform(row.meeting_url)
            except Invalid:
                pass
            db.flush()
            if moved:
                bot_service.reschedule_bot(db, iv)
            outcome = "updated"
    db.flush()
    scheduled = _maybe_schedule_bot(db, conn, org, role, row, iv)
    if scheduled:
        return "created+bot" if outcome == "created" else "bot"
    return outcome


def _create_interview(db, conn, owner, role, row, cand, org_users) -> Interview:
    iv = Interview(
        org_id=conn.org_id, candidate_id=cand.id, role_id=cand.role_id,
        title=row.title[:200] or "Interview", scheduled_start=row.start, scheduled_end=row.end,
        meeting_url=row.meeting_url, platform=interview_service.detect_platform(row.meeting_url),
        status="scheduled", created_by_user_id=owner.id,
    )
    db.add(iv)
    db.flush()
    people = [
        InterviewParticipant(interview_id=iv.id, display_name=cand.name, email=cand.email, kind="candidate"),
        InterviewParticipant(
            interview_id=iv.id, user_id=owner.id, display_name=owner.full_name or owner.email,
            email=owner.email, kind="interviewer",
        ),
    ]
    for a in row.attendees or []:
        e = (a.get("email") or "").lower()
        if not e or e in (cand.email.lower(), owner.email.lower(), conn.account_email):
            continue
        uid = org_users.get(e)
        people.append(
            InterviewParticipant(
                interview_id=iv.id, user_id=uid, display_name=a.get("name") or e, email=e,
                kind="interviewer" if uid else "other",
            )
        )
    db.add_all(people)
    _audit(db, conn.org_id, owner.id, "interview.created_from_calendar", iv.id, event=row.external_id)
    return iv


def _maybe_schedule_bot(db, conn, org, role, row, iv) -> bool:
    if conn.auto_join == "never":
        row.skip_reason = "auto_join_off"
        return False
    if conn.auto_join == "tagged" and not row.tagged:
        row.skip_reason = "not_tagged"
        return False
    if iv.status != "scheduled":
        return False
    if iv.bot_sessions:
        row.skip_reason = "bot_already_attempted" if not any(
            b.status in bot_service.NON_TERMINAL for b in iv.bot_sessions
        ) else None
        return False
    if role not in BOT_ROLES:
        row.skip_reason = "role_cannot_schedule_bot"
        return False
    if iv.platform not in bot_service.SUPPORTED_PLATFORMS:
        row.skip_reason = "platform_unsupported"
        return False
    now = _now()
    start = _aware(iv.scheduled_start)
    end = _aware(iv.scheduled_end) or (start + timedelta(minutes=60))
    if end <= now:
        row.skip_reason = "event_in_past"
        return False
    mode = "scheduled" if start - bot_service.LEAD_TIME > now else "now"
    try:
        bot_service.schedule_bot(db, org, iv, mode)
    except DomainError as e:
        row.skip_reason = e.code
        return False
    _audit(db, conn.org_id, conn.user_id, "bot.scheduled_from_calendar", iv.id, mode=mode)
    row.skip_reason = None
    return True


# ── user actions ──────────────────────────────────────────────────────────────
def _own_connection(db: Session, ctx: OrgContext, connection_id: int) -> CalendarConnection:
    conn = (
        db.query(CalendarConnection)
        .filter(
            CalendarConnection.id == connection_id, CalendarConnection.org_id == ctx.org_id,
            CalendarConnection.user_id == ctx.user.id,  # connections are strictly personal
        )
        .first()
    )
    if conn is None:
        raise NotFound("Calendar connection not found")
    return conn


def list_connections(db: Session, ctx: OrgContext) -> list[CalendarConnection]:
    return (
        db.query(CalendarConnection)
        .filter(CalendarConnection.org_id == ctx.org_id, CalendarConnection.user_id == ctx.user.id)
        .order_by(CalendarConnection.id)
        .all()
    )


def set_auto_join(db: Session, ctx: OrgContext, connection_id: int, mode: str) -> CalendarConnection:
    if mode not in AUTO_JOIN_MODES:
        raise Invalid("auto_join must be all, tagged or never", "bad_auto_join")
    conn = _own_connection(db, ctx, connection_id)
    conn.auto_join = mode
    _audit(db, ctx.org_id, ctx.user.id, "calendar.auto_join_changed", conn.id, mode=mode)
    db.commit()
    db.refresh(conn)
    return conn


def disconnect(db: Session, ctx: OrgContext, connection_id: int, http: httpx.Client | None = None) -> None:
    conn = _own_connection(db, ctx, connection_id)
    own = http is None
    http = http or http_client()
    try:
        a = adapter(conn.provider)
        try:
            token = access_token(db, conn, http)
            if conn.watch_id:
                a.stop_watch(http, token, conn.watch_id, conn.watch_resource)
            a.revoke(http, crypto.decrypt(conn.refresh_token_enc or conn.access_token_enc))
        except (CalendarAuthError, CalendarApiError, crypto.DecryptionError, httpx.HTTPError):
            pass  # already revoked or unreachable: still remove our side
    finally:
        if own:
            http.close()
    # stop auto-join: cancel bots that were scheduled from this calendar and not yet launched
    for row in db.query(CalendarEvent).filter(CalendarEvent.connection_id == conn.id):
        if row.interview_id:
            iv = db.get(Interview, row.interview_id)
            if iv is not None:
                bot_service.cancel_scheduled_bot(db, iv)
    _audit(db, ctx.org_id, ctx.user.id, "calendar.disconnected", conn.id, provider=conn.provider)
    db.query(CalendarEvent).filter(CalendarEvent.connection_id == conn.id).delete()
    db.delete(conn)
    db.commit()


def list_events(db: Session, ctx: OrgContext, connection_id: int | None = None) -> list[CalendarEvent]:
    q = (
        db.query(CalendarEvent)
        .join(CalendarConnection, CalendarConnection.id == CalendarEvent.connection_id)
        .filter(CalendarEvent.org_id == ctx.org_id, CalendarConnection.user_id == ctx.user.id,
                CalendarEvent.start >= _now() - timedelta(hours=2), CalendarEvent.cancelled.is_(False))
    )
    if connection_id:
        q = q.filter(CalendarEvent.connection_id == connection_id)
    return q.order_by(CalendarEvent.start).limit(200).all()


def tag_event(
    db: Session, ctx: OrgContext, event_id: int, tagged: bool, candidate_id: int | None
) -> CalendarEvent:
    row = (
        db.query(CalendarEvent)
        .join(CalendarConnection, CalendarConnection.id == CalendarEvent.connection_id)
        .filter(CalendarEvent.id == event_id, CalendarEvent.org_id == ctx.org_id,
                CalendarConnection.user_id == ctx.user.id)
        .first()
    )
    if row is None:
        raise NotFound("Calendar event not found")
    conn = db.get(CalendarConnection, row.connection_id)
    if tagged:
        if candidate_id is not None:
            cand = db.query(Candidate).filter(Candidate.id == candidate_id, Candidate.org_id == ctx.org_id).first()
            if cand is None:
                raise NotFound("Candidate not found")
            row.candidate_id = cand.id
        if not row.candidate_id:
            raise Invalid("Choose which candidate this meeting is with", "candidate_required")
    row.tagged = tagged
    _audit(db, ctx.org_id, ctx.user.id, "calendar.event_tagged", row.id, tagged=tagged)
    apply_event(db, conn, ctx.org, ctx.user, ctx.role, row, {})
    db.commit()
    db.refresh(row)
    return row


def due_connection_ids(db: Session) -> list[int]:
    return [
        c[0] for c in db.query(CalendarConnection.id).filter(CalendarConnection.status == "active")
    ]


def renew_due_watches(db: Session, http: httpx.Client | None = None) -> int:
    if not push_possible():
        return 0
    own = http is None
    http = http or http_client()
    n = 0
    try:
        soon = _now() + timedelta(hours=12)
        for conn in db.query(CalendarConnection).filter(CalendarConnection.status == "active"):
            if conn.watch_expires_at is None or _aware(conn.watch_expires_at) < soon:
                n += bool(ensure_watch(db, conn, http))
    finally:
        if own:
            http.close()
    return n
