from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core import storage
from app.core.config import settings
from app.db import session as db_session

router = APIRouter(tags=["Health"])


@router.get("/healthz")
def healthz():
    return {"status": "ok"}


@router.get("/readyz")
def readyz():
    checks: dict[str, str] = {}

    try:
        with db_session.engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as e:
        checks["database"] = f"error: {type(e).__name__}"

    try:
        import redis

        redis.Redis.from_url(settings.redis_url, socket_connect_timeout=1).ping()
        checks["redis"] = "ok"
    except Exception as e:
        checks["redis"] = f"error: {type(e).__name__}"

    try:
        storage._client().head_bucket(Bucket=settings.s3_bucket)
        checks["storage"] = "ok"
    except Exception as e:
        checks["storage"] = f"error: {type(e).__name__}"

    ok = all(v == "ok" for v in checks.values())
    return JSONResponse(
        {"status": "ready" if ok else "degraded", "checks": checks},
        status_code=200 if ok else 503,
    )
