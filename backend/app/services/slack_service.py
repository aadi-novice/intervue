"""
Slack notifications through an incoming-webhook URL (M10b).

The URL is a secret: stored Fernet-encrypted inside `organizations.settings` (never returned by
any API; stripped by `org_service.public_settings`) and restricted to hooks.slack.com. Messages
contain ids, scores and role names only, never candidate names, so blind review is preserved.
"""

import logging
import re

import httpx
from sqlalchemy.orm import Session

from app.api.deps import OrgContext
from app.core import crypto
from app.core.config import settings
from app.core.errors import Invalid
from app.core.redact import scrub
from app.core.ssrf import validate_outbound_url
from app.models.role import Role
from app.models.tenancy import Organization
from app.services import audit_service

log = logging.getLogger(__name__)

EVENTS = ("interview.completed", "analysis.completed", "ranking.completed", "bot.failed")
URL_RE = re.compile(r"^https://hooks\.slack\.com/(services|workflows|triggers)/[A-Za-z0-9/_-]{8,}$")
KEY_URL, KEY_EVENTS, KEY_ERROR = "slack_webhook_enc", "slack_events", "slack_last_error"


def _cfg(org: Organization) -> dict:
    return org.settings or {}


def status(org: Organization) -> dict:
    enc = _cfg(org).get(KEY_URL)
    hint = None
    if enc:
        try:
            hint = "…" + crypto.decrypt(enc)[-4:]
        except crypto.DecryptionError:
            hint = "unreadable"
    return {
        "configured": bool(enc), "hint": hint,
        "events": _cfg(org).get(KEY_EVENTS, list(EVENTS)) if enc else [],
        "last_error": _cfg(org).get(KEY_ERROR),
    }


def configure(db: Session, ctx: OrgContext, webhook_url: str, events: list[str] | None) -> dict:
    url = webhook_url.strip()
    if not URL_RE.match(url):
        raise Invalid("Use the Incoming Webhook URL from Slack (https://hooks.slack.com/services/...)", "bad_slack_url")
    validate_outbound_url(url, allowed_hosts={"hooks.slack.com"})
    events = list(events) if events is not None else list(EVENTS)
    bad = [e for e in events if e not in EVENTS]
    if bad:
        raise Invalid(f"Unknown event(s): {', '.join(bad)}", "unknown_event")
    org = ctx.org
    merged = dict(org.settings or {})
    merged.update({KEY_URL: crypto.encrypt(url), KEY_EVENTS: sorted(set(events))})
    merged.pop(KEY_ERROR, None)
    org.settings = merged  # reassign so the JSON column change is detected
    audit_service.record(db, ctx, "slack.configured", "org", org.id, events=len(events))
    db.commit()
    return status(org)


def clear(db: Session, ctx: OrgContext) -> dict:
    org = ctx.org
    merged = {k: v for k, v in (org.settings or {}).items() if k not in (KEY_URL, KEY_EVENTS, KEY_ERROR)}
    org.settings = merged
    audit_service.record(db, ctx, "slack.removed", "org", org.id)
    db.commit()
    return status(org)


def _role_name(db: Session, org_id: int, role_id: int | None) -> str:
    r = db.query(Role).filter(Role.id == role_id, Role.org_id == org_id).first() if role_id else None
    return r.name if r else "a role"


def message_for(db: Session, org_id: int, event: str, data: dict) -> str | None:
    base = settings.frontend_url.rstrip("/")
    if event == "interview.completed":
        return (f"Interview #{data['interview_id']} for {_role_name(db, org_id, data.get('role_id'))}: "
                f"transcript is ready. <{base}/interviews/{data['interview_id']}|Open>")
    if event == "analysis.completed":
        return (f"Analysis ready for interview #{data['interview_id']} ({_role_name(db, org_id, data.get('role_id'))}). "
                f"AI suggestion: *{data.get('hiring_recommendation') or 'n/a'}* "
                f"(technical {data.get('technical_score')}, communication {data.get('communication_score')}, "
                f"confidence {data.get('confidence_score')}). Final decision by your team. "
                f"<{base}/interviews/{data['interview_id']}?tab=analysis|Open>")
    if event == "ranking.completed":
        return (f"Ranking finished for *{_role_name(db, org_id, data.get('role_id'))}*: "
                f"{data.get('scored', 0)} candidates scored. <{base}/roles/{data['role_id']}?tab=ranking|Open>")
    if event == "bot.failed":
        return (f"The notetaker could not record interview #{data['interview_id']}: "
                f"{data.get('reason', 'unknown reason')}. <{base}/interviews/{data['interview_id']}|Open>")
    return None


def announce(db: Session, org_id: int, event: str, data: dict) -> bool:
    """Queue a Slack message if this org enabled the event. Never raises."""
    org = db.get(Organization, org_id)
    if org is None or not _cfg(org).get(KEY_URL) or event not in _cfg(org).get(KEY_EVENTS, EVENTS):
        return False
    text = message_for(db, org_id, event, data)
    if not text:
        return False
    from app.worker.tasks.integrations import slack_send_task

    slack_send_task.delay(org_id, text)
    return True


def send(db: Session, org_id: int, text: str, http: httpx.Client | None = None) -> tuple[bool, str | None]:
    org = db.get(Organization, org_id)
    enc = _cfg(org).get(KEY_URL) if org else None
    if not enc:
        return False, "Slack is not configured"
    own = http is None
    http = http or httpx.Client(timeout=10, follow_redirects=False)
    err = None
    try:
        url = validate_outbound_url(crypto.decrypt(enc), allowed_hosts={"hooks.slack.com"})
        r = http.post(url, json={"text": text})
        if r.status_code != 200:
            err = f"Slack answered HTTP {r.status_code}: {scrub(r.text, 100)}"
    except (Invalid, httpx.HTTPError, crypto.DecryptionError) as e:
        err = scrub(str(getattr(e, "detail", e)), 200)
    finally:
        if own:
            http.close()
    merged = dict(org.settings or {})
    if err:
        merged[KEY_ERROR] = err
    else:
        merged.pop(KEY_ERROR, None)
    if merged != (org.settings or {}):
        org.settings = merged
        db.commit()
    return err is None, err


def test_message(db: Session, ctx: OrgContext, http: httpx.Client | None = None) -> dict:
    ok, err = send(db, ctx.org_id, "✅ Intervue is connected to this channel. You'll see interview and ranking updates here.", http)
    audit_service.record(db, ctx, "slack.tested", "org", ctx.org_id, ok=ok)
    db.commit()
    return {"ok": ok, "error": err}
