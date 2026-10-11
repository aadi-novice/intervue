"""
Outbound webhooks (M10b).

Events carry ids and scores only (never names, emails or transcript text), so blind-review orgs
leak nothing through them. Deliveries are signed:

    X-Intervue-Signature: t=<unix seconds>,v1=<hex hmac_sha256(secret, "<t>." + raw_body)>

and retried with backoff; an endpoint that keeps failing is disabled and its admins notified.
"""

import hashlib
import hmac
import json
import logging
import secrets
import time
import uuid
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy.orm import Session

from app.api.deps import OrgContext
from app.core import crypto
from app.core.config import settings
from app.core.errors import Conflict, Invalid, NotFound
from app.core.redact import scrub
from app.core.ssrf import validate_outbound_url
from app.models.integrations import WebhookDelivery, WebhookEndpoint
from app.models.tenancy import Membership
from app.services import audit_service

log = logging.getLogger(__name__)

EVENTS = ("interview.completed", "analysis.completed", "ranking.completed")
ALL = "*"
RETRY_DELAYS = [30, 120, 600, 3600, 21600]  # seconds after attempt 1..5 (6 attempts total)
SIGNATURE_TOLERANCE = 300


def _now() -> datetime:
    return datetime.now(UTC)


# ── signing ───────────────────────────────────────────────────────────────────
def sign(secret: str, timestamp: int | str, body: bytes) -> str:
    mac = hmac.new(secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={mac}"


def verify(secret: str, header: str, body: bytes, tolerance: int = SIGNATURE_TOLERANCE) -> bool:
    """What a receiver should do (also used by tests and documented in docs/WEBHOOKS.md)."""
    try:
        parts = dict(p.split("=", 1) for p in header.split(","))
        ts = int(parts["t"])
    except (ValueError, KeyError):
        return False
    if abs(time.time() - ts) > tolerance:
        return False
    return hmac.compare_digest(sign(secret, ts, body), f"t={ts},v1={parts.get('v1', '')}")


def new_secret() -> str:
    return "whsec_" + secrets.token_urlsafe(32)


# ── management ────────────────────────────────────────────────────────────────
def _clean_events(events: list[str] | None) -> list[str]:
    events = events or [ALL]
    if ALL in events:
        return [ALL]
    bad = [e for e in events if e not in EVENTS]
    if bad:
        raise Invalid(f"Unknown event(s): {', '.join(bad)}", "unknown_event")
    return sorted(set(events))


def create_endpoint(
    db: Session, ctx: OrgContext, url: str, events: list[str] | None, description: str
) -> tuple[WebhookEndpoint, str]:
    count = db.query(WebhookEndpoint).filter(WebhookEndpoint.org_id == ctx.org_id).count()
    if count >= settings.webhook_max_endpoints_per_org:
        raise Conflict(f"At most {settings.webhook_max_endpoints_per_org} webhook endpoints", "too_many_endpoints")
    url = validate_outbound_url(url)
    secret = new_secret()
    ep = WebhookEndpoint(
        org_id=ctx.org_id, url=url, description=description.strip(), events=_clean_events(events),
        secret_enc=crypto.encrypt(secret), created_by_user_id=ctx.user.id,
    )
    db.add(ep)
    db.flush()
    audit_service.record(db, ctx, "webhook.created", "webhook", ep.id, url_host=url.split("/")[2])
    db.commit()
    db.refresh(ep)
    return ep, secret


def get_endpoint(db: Session, ctx: OrgContext, endpoint_id: int) -> WebhookEndpoint:
    ep = (
        db.query(WebhookEndpoint)
        .filter(WebhookEndpoint.id == endpoint_id, WebhookEndpoint.org_id == ctx.org_id)
        .first()
    )
    if ep is None:
        raise NotFound("Webhook endpoint not found")
    return ep


def update_endpoint(db: Session, ctx: OrgContext, endpoint_id: int, data: dict) -> WebhookEndpoint:
    ep = get_endpoint(db, ctx, endpoint_id)
    if data.get("url") is not None:
        ep.url = validate_outbound_url(data["url"])
    if data.get("events") is not None:
        ep.events = _clean_events(data["events"])
    if data.get("description") is not None:
        ep.description = data["description"].strip()
    if data.get("active") is not None:
        ep.active = bool(data["active"])
        if ep.active:  # re-enabling resets the failure streak
            ep.consecutive_failures, ep.disabled_reason = 0, None
    audit_service.record(db, ctx, "webhook.updated", "webhook", ep.id)
    db.commit()
    db.refresh(ep)
    return ep


def rotate_secret(db: Session, ctx: OrgContext, endpoint_id: int) -> tuple[WebhookEndpoint, str]:
    ep = get_endpoint(db, ctx, endpoint_id)
    secret = new_secret()
    ep.secret_enc = crypto.encrypt(secret)
    audit_service.record(db, ctx, "webhook.secret_rotated", "webhook", ep.id)
    db.commit()
    return ep, secret


def delete_endpoint(db: Session, ctx: OrgContext, endpoint_id: int) -> None:
    ep = get_endpoint(db, ctx, endpoint_id)
    db.query(WebhookDelivery).filter(WebhookDelivery.endpoint_id == ep.id).delete()
    audit_service.record(db, ctx, "webhook.deleted", "webhook", ep.id)
    db.delete(ep)
    db.commit()


def list_deliveries(db: Session, ctx: OrgContext, endpoint_id: int, limit: int = 50) -> list[WebhookDelivery]:
    ep = get_endpoint(db, ctx, endpoint_id)
    return (
        db.query(WebhookDelivery)
        .filter(WebhookDelivery.endpoint_id == ep.id)
        .order_by(WebhookDelivery.id.desc())
        .limit(min(limit, 200))
        .all()
    )


# ── emitting ──────────────────────────────────────────────────────────────────
def _envelope(event: str, org_id: int, data: dict) -> dict:
    return {
        "id": f"evt_{uuid.uuid4().hex[:24]}", "type": event,
        "created_at": _now().isoformat(), "org_id": org_id, "data": data,
    }


def emit(db: Session, org_id: int, event: str, data: dict) -> int:
    """Queue a delivery for every matching active endpoint (and the Slack channel). Best effort."""
    queued = 0
    try:
        env = _envelope(event, org_id, data)
        endpoints = (
            db.query(WebhookEndpoint)
            .filter(WebhookEndpoint.org_id == org_id, WebhookEndpoint.active.is_(True))
            .all()
        )
        ids = []
        for ep in endpoints:
            if ALL not in ep.events and event not in ep.events:
                continue
            d = WebhookDelivery(
                org_id=org_id, endpoint_id=ep.id, event=event, event_id=env["id"], payload=env,
                status="pending", next_attempt_at=_now(),
            )
            db.add(d)
            db.flush()
            ids.append(d.id)
        db.commit()
        from app.worker.tasks.integrations import deliver_webhook_task

        for i in ids:
            deliver_webhook_task.delay(i)
            queued += 1
    except Exception:  # never break the pipeline that emitted the event
        db.rollback()
        log.exception("webhook emit failed for %s", event)
    try:
        from app.services import slack_service

        slack_service.announce(db, org_id, event, data)
    except Exception:
        log.exception("slack announce failed for %s", event)
    return queued


def send_ping(db: Session, ctx: OrgContext, endpoint_id: int) -> WebhookDelivery:
    ep = get_endpoint(db, ctx, endpoint_id)
    env = _envelope("ping", ctx.org_id, {"message": "Webhook test from Intervue", "endpoint_id": ep.id})
    d = WebhookDelivery(
        org_id=ctx.org_id, endpoint_id=ep.id, event="ping", event_id=env["id"], payload=env,
        status="pending", next_attempt_at=_now(),
    )
    db.add(d)
    db.commit()
    db.refresh(d)
    from app.worker.tasks.integrations import deliver_webhook_task

    deliver_webhook_task.delay(d.id)
    return d


# ── delivering ────────────────────────────────────────────────────────────────
def deliver(db: Session, delivery_id: int, http: httpx.Client | None = None) -> str:
    """One attempt. Returns the delivery status afterwards (pending = will be retried)."""
    d = db.get(WebhookDelivery, delivery_id)
    if d is None or d.status != "pending":
        return d.status if d else "missing"
    # claim the attempt atomically: a second worker (or the retry sweeper) that races us gets 0 rows
    claimed = (
        db.query(WebhookDelivery)
        .filter(
            WebhookDelivery.id == delivery_id, WebhookDelivery.status == "pending",
            WebhookDelivery.next_attempt_at <= _now(),
        )
        .update({"next_attempt_at": _now() + timedelta(minutes=5)}, synchronize_session=False)
    )
    db.commit()
    if not claimed:
        return "pending"
    db.refresh(d)
    ep = db.get(WebhookEndpoint, d.endpoint_id)
    if ep is None or (not ep.active and d.event != "ping"):
        d.status, d.error = "failed", "endpoint disabled or deleted"
        db.commit()
        return d.status

    body = json.dumps(d.payload, separators=(",", ":")).encode()
    d.attempts += 1
    ok, code, err = False, None, None
    own = http is None
    http = http or httpx.Client(timeout=10, follow_redirects=False)
    try:
        url = validate_outbound_url(ep.url)  # re-check right before connecting
        ts = int(time.time())
        r = http.post(
            url, content=body,
            headers={
                "Content-Type": "application/json", "User-Agent": "Intervue-Webhooks/1",
                "X-Intervue-Event": d.event, "X-Intervue-Delivery": str(d.id),
                "X-Intervue-Signature": sign(crypto.decrypt(ep.secret_enc), ts, body),
            },
        )
        code = r.status_code
        ok = 200 <= code < 300
        if not ok:
            err = f"HTTP {code}" + (" (redirects are not followed)" if 300 <= code < 400 else "")
        if code == 410:  # the receiver says it is gone for good
            ep.active, ep.disabled_reason = False, "endpoint returned 410 Gone"
    except Invalid as e:
        err = f"Blocked: {e.detail}"
    except (httpx.HTTPError, crypto.DecryptionError) as e:
        err = f"{type(e).__name__}: {e}"
    finally:
        if own:
            http.close()

    d.response_code, d.error = code, scrub(err, 500) if err else None
    if ok:
        d.status, d.delivered_at, d.next_attempt_at = "success", _now(), None
        ep.consecutive_failures, ep.last_success_at = 0, _now()
    else:
        ep.consecutive_failures += 1
        ep.last_failure_at = _now()
        gone = code == 410
        if gone or d.attempts >= settings.webhook_max_attempts:
            d.status, d.next_attempt_at = "failed", None
        else:
            d.next_attempt_at = _now() + timedelta(seconds=RETRY_DELAYS[min(d.attempts - 1, len(RETRY_DELAYS) - 1)])
        if ep.active and ep.consecutive_failures >= settings.webhook_disable_after_failures:
            ep.active, ep.disabled_reason = False, f"disabled after {ep.consecutive_failures} consecutive failures"
            _tell_admins_disabled(db, ep)
    db.commit()
    return d.status


def _tell_admins_disabled(db: Session, ep: WebhookEndpoint) -> None:
    from app.services import notification_service as ns

    for (uid,) in db.query(Membership.user_id).filter(Membership.org_id == ep.org_id, Membership.role == "admin"):
        ns.notify(db, ep.org_id, uid, "webhook_disabled", "A webhook endpoint was disabled",
                  f"{ep.description or ep.url}: {ep.disabled_reason}", "/settings?tab=integrations")


def due_delivery_ids(db: Session, limit: int = 200) -> list[int]:
    return [
        i for (i,) in db.query(WebhookDelivery.id)
        .filter(WebhookDelivery.status == "pending", WebhookDelivery.next_attempt_at <= _now())
        .order_by(WebhookDelivery.next_attempt_at)
        .limit(limit)
    ]
