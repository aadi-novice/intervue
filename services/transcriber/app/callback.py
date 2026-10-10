"""Signed callbacks to the backend with exponential-backoff retries.

Signature: X-Signature = hex(hmac_sha256(TRANSCRIBER_CALLBACK_SECRET, f"{X-Timestamp}." + raw_body))
The timestamp (unix seconds) is regenerated for every attempt so the receiver can
enforce a short replay window.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

log = logging.getLogger(__name__)


def compute_signature(secret: str, timestamp: str, body: bytes) -> str:
    msg = timestamp.encode() + b"." + body
    return hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()


def encode_body(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _retryable(status: int) -> bool:
    return status >= 500 or status in (408, 425, 429)


async def send_callback(
    client: httpx.AsyncClient,
    url: str,
    payload: dict[str, Any],
    secret: str,
    *,
    max_attempts: int = 5,
    base_delay: float = 1.0,
    inline_max_bytes: int | None = None,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> bool:
    """POST `payload` to `url`. Returns True on a 2xx, False after giving up."""
    body = encode_body(payload)
    job_id = payload.get("job_id")
    if inline_max_bytes is not None and len(body) > inline_max_bytes:
        # The service has no storage credentials, so large results are still sent inline.
        log.warning(
            "callback body exceeds CALLBACK_INLINE_MAX_BYTES; sending inline anyway",
            extra={"job_id": job_id, "bytes": len(body), "limit": inline_max_bytes},
        )

    for attempt in range(1, max_attempts + 1):
        ts = str(int(time.time()))
        headers = {
            "Content-Type": "application/json",
            "X-Timestamp": ts,
            "X-Signature": compute_signature(secret, ts, body),
        }
        try:
            resp = await client.post(url, content=body, headers=headers)
            if 200 <= resp.status_code < 300:
                log.info("callback delivered", extra={"job_id": job_id, "attempt": attempt})
                return True
            if not _retryable(resp.status_code):
                log.error(
                    "callback rejected (not retrying)",
                    extra={"job_id": job_id, "status_code": resp.status_code, "attempt": attempt},
                )
                return False
            log.warning(
                "callback failed, will retry",
                extra={"job_id": job_id, "status_code": resp.status_code, "attempt": attempt},
            )
        except httpx.HTTPError as exc:
            log.warning(
                "callback transport error, will retry",
                extra={"job_id": job_id, "error": repr(exc), "attempt": attempt},
            )
        if attempt < max_attempts:
            await sleep(base_delay * (2 ** (attempt - 1)))

    log.error("callback gave up", extra={"job_id": job_id, "attempts": max_attempts})
    return False
