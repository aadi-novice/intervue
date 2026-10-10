"""In-memory job store + asyncio queue + bounded worker pool.

Jobs live only in process memory: a restart forgets them. The backend should treat
a 404 from GET /jobs/{id} (or a missing callback past its deadline) as "resubmit".
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Literal

import httpx

from app.callback import send_callback
from app.config import Settings
from app.download import downloaded_audio
from app.engines.base import TranscriptionEngine

log = logging.getLogger(__name__)

JobStatus = Literal["queued", "running", "completed", "failed"]
_FINISHED = ("completed", "failed")


@dataclass
class Job:
    job_id: str
    audio_url: str
    language: str
    callback_url: str
    status: JobStatus = "queued"
    error: str | None = None
    updated_at: float = field(default_factory=time.monotonic)

    def set(self, status: JobStatus, error: str | None = None) -> None:
        self.status = status
        self.error = error
        self.updated_at = time.monotonic()

    def public(self) -> dict:
        return {"job_id": self.job_id, "status": self.status, "error": self.error}


class JobManager:
    def __init__(self, settings: Settings, engine: TranscriptionEngine, http: httpx.AsyncClient) -> None:
        self.settings = settings
        self.engine = engine
        self.http = http
        self.jobs: dict[str, Job] = {}
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self.ready = asyncio.Event()
        self._workers: list[asyncio.Task] = []

    # ----------------------------------------------------------------- lifecycle
    def start(self) -> None:
        for i in range(self.settings.max_concurrent_jobs):
            self._workers.append(asyncio.create_task(self._worker(i), name=f"transcriber-worker-{i}"))

    async def stop(self) -> None:
        for t in self._workers:
            t.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)
        self._workers.clear()

    # ------------------------------------------------------------------- public
    def submit(self, job_id: str, audio_url: str, language: str, callback_url: str) -> Job:
        """Idempotent by job_id: an existing non-failed job is returned unchanged."""
        self._prune()
        existing = self.jobs.get(job_id)
        if existing is not None and existing.status != "failed":
            return existing
        job = Job(job_id=job_id, audio_url=audio_url, language=language, callback_url=callback_url)
        self.jobs[job_id] = job
        self.queue.put_nowait(job_id)
        log.info("job queued", extra={"job_id": job_id, "retry": existing is not None})
        return job

    def get(self, job_id: str) -> Job | None:
        return self.jobs.get(job_id)

    @property
    def queue_depth(self) -> int:
        return self.queue.qsize()

    # ----------------------------------------------------------------- internals
    def _prune(self) -> None:
        cutoff = time.monotonic() - self.settings.job_ttl_seconds
        for jid in [j.job_id for j in self.jobs.values() if j.status in _FINISHED and j.updated_at < cutoff]:
            del self.jobs[jid]

    async def _worker(self, idx: int) -> None:
        await self.ready.wait()  # don't start until the model is loaded
        while True:
            job_id = await self.queue.get()
            try:
                job = self.jobs.get(job_id)
                if job is not None and job.status == "queued":
                    await self.process(job)
            except Exception:  # pragma: no cover - process() already handles errors
                log.exception("worker crashed on job", extra={"job_id": job_id})
            finally:
                self.queue.task_done()

    async def process(self, job: Job) -> None:
        s = self.settings
        job.set("running")
        started = time.monotonic()
        log.info("job started", extra={"job_id": job.job_id})
        try:
            async with downloaded_audio(self.http, job.audio_url, s.download_max_bytes) as path:
                result = await asyncio.to_thread(self.engine.transcribe, path, job.language)
            payload = {"job_id": job.job_id, "status": "completed", **result.to_dict()}
            final: JobStatus = "completed"
            error = None
            log.info(
                "job transcribed",
                extra={
                    "job_id": job.job_id,
                    "duration_ms": result.duration_ms,
                    "segments": len(result.segments),
                    "elapsed_s": round(time.monotonic() - started, 2),
                },
            )
        except Exception as exc:
            error = str(exc) or exc.__class__.__name__
            log.exception("job failed", extra={"job_id": job.job_id})
            payload = {"job_id": job.job_id, "status": "failed", "error": error}
            final = "failed"

        delivered = await send_callback(
            self.http,
            job.callback_url,
            payload,
            s.transcriber_callback_secret,
            max_attempts=s.callback_max_attempts,
            base_delay=s.callback_retry_base_seconds,
            inline_max_bytes=s.callback_inline_max_bytes,
        )
        if not delivered:
            log.error("callback not delivered", extra={"job_id": job.job_id, "status": final})
        # Status flips to its final value only after the callback attempt, so a poller
        # that sees completed/failed knows the callback has already been tried.
        job.set(final, error)
