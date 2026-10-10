"""HTTP client for the transcriber service (the only coupling is the documented contract)."""

import httpx

from app.core.config import settings


class TranscriberError(Exception):
    pass


def submit(job_id: str, audio_url: str, language: str = "auto") -> None:
    try:
        r = httpx.post(
            f"{settings.transcriber_url.rstrip('/')}/jobs",
            json={
                "job_id": job_id,
                "audio_url": audio_url,
                "language": language,
                "callback_url": f"{settings.internal_api_url.rstrip('/')}/internal/transcriber/callback",
            },
            headers={"Authorization": f"Bearer {settings.transcriber_api_key}"},
            timeout=30,
        )
    except httpx.HTTPError as e:
        raise TranscriberError(f"Transcriber unreachable: {e}") from e
    if r.status_code != 202:
        raise TranscriberError(f"Transcriber rejected job ({r.status_code}): {r.text[:300]}")
