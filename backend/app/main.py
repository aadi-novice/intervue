import time

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.api import (
    analysis,
    auth,
    candidate,
    dashboard,
    health,
    internal,
    interviews,
    orgs,
    ranking,
    role,
)
from app.core.config import settings
from app.core.errors import install_error_handlers
from app.core.logging import configure_logging, init_sentry, new_request_id

configure_logging()
init_sentry("api")
log = structlog.get_logger("http")

app = FastAPI(title="Intervue API", version="1.0.0")

install_error_handlers(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-Id"],
)
# Needed only for the OAuth redirect round-trip (state / nonce).
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.internal_hmac_secret,
    same_site="lax",
    https_only=settings.cookie_secure,
    max_age=600,
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    rid = request.headers.get("x-request-id") or new_request_id()
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(request_id=rid)
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        log.exception("unhandled_error", path=request.url.path, method=request.method)
        raise
    response.headers["X-Request-Id"] = rid
    if request.url.path not in ("/healthz", "/readyz"):
        log.info(
            "request",
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            ms=int((time.perf_counter() - started) * 1000),
        )
    return response


@app.get("/")
def root():
    return {"message": "Intervue backend running"}


app.include_router(health.router)
app.include_router(auth.router)
app.include_router(orgs.router)
app.include_router(role.router)
app.include_router(candidate.router)
app.include_router(analysis.router)
app.include_router(interviews.router)
app.include_router(ranking.router)
app.include_router(dashboard.router)
app.include_router(internal.router)
