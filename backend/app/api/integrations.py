"""Admin management of webhooks, API keys and Slack (M10b)."""

from datetime import datetime

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import OrgContext, require_role
from app.db.dependencies import get_db
from app.services import apikey_service, slack_service, webhook_service

router = APIRouter(tags=["Integrations"])


# ── webhooks ──────────────────────────────────────────────────────────────────
class WebhookCreate(BaseModel):
    url: str = Field(max_length=2000)
    events: list[str] | None = None  # None / ["*"] = every event
    description: str = Field(default="", max_length=200)


class WebhookUpdate(BaseModel):
    url: str | None = Field(default=None, max_length=2000)
    events: list[str] | None = None
    description: str | None = Field(default=None, max_length=200)
    active: bool | None = None


class WebhookOut(BaseModel):
    id: int
    url: str
    description: str
    events: list[str]
    active: bool
    consecutive_failures: int
    disabled_reason: str | None = None
    last_success_at: datetime | None = None
    last_failure_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class WebhookCreated(WebhookOut):
    secret: str  # shown exactly once


class DeliveryOut(BaseModel):
    id: int
    event: str
    event_id: str
    status: str
    attempts: int
    response_code: int | None = None
    error: str | None = None
    next_attempt_at: datetime | None = None
    delivered_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


@router.get("/orgs/{org_id}/webhooks/events")
def webhook_events(org_id: int, ctx: OrgContext = Depends(require_role())):
    return {"events": list(webhook_service.EVENTS)}


@router.get("/orgs/{org_id}/webhooks", response_model=list[WebhookOut])
def list_webhooks(org_id: int, ctx: OrgContext = Depends(require_role()), db: Session = Depends(get_db)):
    from app.models.integrations import WebhookEndpoint

    return (
        db.query(WebhookEndpoint).filter(WebhookEndpoint.org_id == ctx.org_id)
        .order_by(WebhookEndpoint.id).all()
    )


@router.post("/orgs/{org_id}/webhooks", status_code=201, response_model=WebhookCreated)
def create_webhook(
    org_id: int, body: WebhookCreate, ctx: OrgContext = Depends(require_role()), db: Session = Depends(get_db)
):
    ep, secret = webhook_service.create_endpoint(db, ctx, body.url, body.events, body.description)
    return WebhookCreated.model_validate({**WebhookOut.model_validate(ep).model_dump(), "secret": secret})


@router.patch("/orgs/{org_id}/webhooks/{endpoint_id}", response_model=WebhookOut)
def update_webhook(
    org_id: int, endpoint_id: int, body: WebhookUpdate,
    ctx: OrgContext = Depends(require_role()), db: Session = Depends(get_db),
):
    return webhook_service.update_endpoint(db, ctx, endpoint_id, body.model_dump(exclude_unset=True))


@router.post("/orgs/{org_id}/webhooks/{endpoint_id}/rotate-secret", response_model=WebhookCreated)
def rotate_webhook_secret(
    org_id: int, endpoint_id: int, ctx: OrgContext = Depends(require_role()), db: Session = Depends(get_db)
):
    ep, secret = webhook_service.rotate_secret(db, ctx, endpoint_id)
    return WebhookCreated.model_validate({**WebhookOut.model_validate(ep).model_dump(), "secret": secret})


@router.delete("/orgs/{org_id}/webhooks/{endpoint_id}", status_code=204)
def delete_webhook(
    org_id: int, endpoint_id: int, ctx: OrgContext = Depends(require_role()), db: Session = Depends(get_db)
):
    webhook_service.delete_endpoint(db, ctx, endpoint_id)
    return Response(status_code=204)


@router.post("/orgs/{org_id}/webhooks/{endpoint_id}/test", status_code=202, response_model=DeliveryOut)
def test_webhook(
    org_id: int, endpoint_id: int, ctx: OrgContext = Depends(require_role()), db: Session = Depends(get_db)
):
    d = webhook_service.send_ping(db, ctx, endpoint_id)
    db.refresh(d)
    return d


@router.get("/orgs/{org_id}/webhooks/{endpoint_id}/deliveries", response_model=list[DeliveryOut])
def webhook_deliveries(
    org_id: int, endpoint_id: int, limit: int = Query(default=50, ge=1, le=200),
    ctx: OrgContext = Depends(require_role()), db: Session = Depends(get_db),
):
    return webhook_service.list_deliveries(db, ctx, endpoint_id, limit)


# ── API keys ──────────────────────────────────────────────────────────────────
class ApiKeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    expires_in_days: int | None = Field(default=None, ge=1, le=730)


class ApiKeyOut(BaseModel):
    id: int
    name: str
    prefix: str
    last_used_at: datetime | None = None
    expires_at: datetime | None = None
    revoked_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ApiKeyCreated(ApiKeyOut):
    key: str  # shown exactly once


@router.get("/orgs/{org_id}/api-keys", response_model=list[ApiKeyOut])
def list_api_keys(org_id: int, ctx: OrgContext = Depends(require_role()), db: Session = Depends(get_db)):
    return apikey_service.list_keys(db, ctx)


@router.post("/orgs/{org_id}/api-keys", status_code=201, response_model=ApiKeyCreated)
def create_api_key(
    org_id: int, body: ApiKeyCreate, ctx: OrgContext = Depends(require_role()), db: Session = Depends(get_db)
):
    row, key = apikey_service.create(db, ctx, body.name, body.expires_in_days)
    return ApiKeyCreated.model_validate({**ApiKeyOut.model_validate(row).model_dump(), "key": key})


@router.delete("/orgs/{org_id}/api-keys/{key_id}", status_code=204)
def revoke_api_key(
    org_id: int, key_id: int, ctx: OrgContext = Depends(require_role()), db: Session = Depends(get_db)
):
    apikey_service.revoke(db, ctx, key_id)
    return Response(status_code=204)


# ── Slack ─────────────────────────────────────────────────────────────────────
class SlackConfig(BaseModel):
    webhook_url: str = Field(max_length=500)
    events: list[str] | None = None


class SlackStatus(BaseModel):
    configured: bool
    hint: str | None = None  # last 4 characters only; the URL itself is never returned
    events: list[str] = []
    last_error: str | None = None


@router.get("/orgs/{org_id}/slack", response_model=SlackStatus)
def slack_status(org_id: int, ctx: OrgContext = Depends(require_role())):
    return slack_service.status(ctx.org)


@router.put("/orgs/{org_id}/slack", response_model=SlackStatus)
def slack_configure(
    org_id: int, body: SlackConfig, ctx: OrgContext = Depends(require_role()), db: Session = Depends(get_db)
):
    return slack_service.configure(db, ctx, body.webhook_url, body.events)


@router.delete("/orgs/{org_id}/slack", response_model=SlackStatus)
def slack_remove(org_id: int, ctx: OrgContext = Depends(require_role()), db: Session = Depends(get_db)):
    return slack_service.clear(db, ctx)


@router.post("/orgs/{org_id}/slack/test")
def slack_test(org_id: int, ctx: OrgContext = Depends(require_role()), db: Session = Depends(get_db)):
    return slack_service.test_message(db, ctx)
