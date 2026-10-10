"""Intervue transcriber service.

Run with:  uv run python -m app      (or: uvicorn app.main:create_app --factory)
"""

import asyncio
import hmac
import logging
from contextlib import asynccontextmanager
from typing import Annotated

import httpx
from fastapi import Depends, FastAPI, Header, Request
from fastapi.responses import JSONResponse
from pydantic import AnyHttpUrl, BaseModel, Field

from app.config import Settings, get_settings
from app.engines.base import TranscriptionEngine
from app.jobs import JobManager
from app.logging_config import configure_logging

log = logging.getLogger(__name__)


# --------------------------------------------------------------------------- errors
class APIError(Exception):
    def __init__(self, status_code: int, detail: str, code: str) -> None:
        self.status_code, self.detail, self.code = status_code, detail, code


async def _api_error_handler(_: Request, exc: APIError) -> JSONResponse:
    headers = {"WWW-Authenticate": "Bearer"} if exc.status_code == 401 else None
    return JSONResponse({"detail": exc.detail, "code": exc.code}, status_code=exc.status_code, headers=headers)


# -------------------------------------------------------------------------- schemas
class JobRequest(BaseModel):
    job_id: str = Field(min_length=1, max_length=200)
    audio_url: AnyHttpUrl
    language: str = Field(default="auto", pattern=r"^(auto|[A-Za-z]{2,3})$")
    callback_url: AnyHttpUrl


class JobResponse(BaseModel):
    job_id: str
    status: str


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    error: str | None = None


# --------------------------------------------------------------------------- engine
def build_engine(settings: Settings) -> TranscriptionEngine:
    if settings.transcriber_mode == "api":
        from app.engines.openai_api import OpenAIEngine

        return OpenAIEngine(api_key=settings.openai_api_key, model=settings.stt_api_model)

    from app.engines.whisper_local import WhisperLocalEngine

    device = settings.resolve_device()
    return WhisperLocalEngine(
        model=settings.resolve_model(device),
        device=device,
        compute_type=settings.resolve_compute_type(device),
        beam_size=settings.whisper_beam_size,
        download_root=settings.whisper_download_root,
    )


# ------------------------------------------------------------------------------ app
def create_app(settings: Settings | None = None, engine: TranscriptionEngine | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        eng = engine or build_engine(settings)
        http = httpx.AsyncClient(
            timeout=httpx.Timeout(settings.callback_timeout_seconds, connect=10.0, read=settings.download_timeout_seconds),
            follow_redirects=True,
        )
        manager = JobManager(settings, eng, http)
        app.state.settings = settings
        app.state.manager = manager
        app.state.model_loaded = False
        manager.start()

        async def _load() -> None:
            try:
                await asyncio.to_thread(eng.load)
                app.state.model_loaded = True
                log.info("engine ready", extra={"mode": settings.transcriber_mode})
            except Exception:
                # Keep serving: /readyz stays 503 and each job retries the load lazily
                # (and fails with a callback) instead of hanging in the queue forever.
                log.exception("engine failed to load")
            finally:
                manager.ready.set()

        loader = asyncio.create_task(_load())
        try:
            yield
        finally:
            loader.cancel()
            await manager.stop()
            await http.aclose()

    app = FastAPI(title="Intervue Transcriber", version="0.1.0", lifespan=lifespan)
    app.add_exception_handler(APIError, _api_error_handler)  # type: ignore[arg-type]

    def require_api_key(authorization: Annotated[str | None, Header()] = None) -> None:
        expected = settings.transcriber_api_key
        scheme, _, token = (authorization or "").partition(" ")
        if scheme.lower() != "bearer" or not token or not hmac.compare_digest(token.encode(), expected.encode()):
            raise APIError(401, "invalid or missing API key", "unauthorized")

    def get_manager(request: Request) -> JobManager:
        return request.app.state.manager

    Auth = Depends(require_api_key)

    @app.post("/jobs", status_code=202, response_model=JobResponse, dependencies=[Auth])
    async def create_job(body: JobRequest, manager: Annotated[JobManager, Depends(get_manager)]) -> JobResponse:
        job = manager.submit(body.job_id, str(body.audio_url), body.language, str(body.callback_url))
        return JobResponse(job_id=job.job_id, status=job.status)

    @app.get("/jobs/{job_id}", response_model=JobStatusResponse, dependencies=[Auth])
    async def get_job(job_id: str, manager: Annotated[JobManager, Depends(get_manager)]) -> JobStatusResponse:
        job = manager.get(job_id)
        if job is None:
            raise APIError(404, "job not found", "not_found")
        return JobStatusResponse(**job.public())

    @app.get("/healthz")
    async def healthz() -> dict:
        return {"status": "ok"}

    @app.get("/readyz")
    async def readyz(request: Request) -> JSONResponse:
        manager: JobManager = request.app.state.manager
        ready = settings.transcriber_mode == "api" or request.app.state.model_loaded
        body = {"status": "ready" if ready else "loading", "queue_depth": manager.queue_depth}
        return JSONResponse(body, status_code=200 if ready else 503)

    return app
