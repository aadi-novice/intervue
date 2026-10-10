"""Stream a (presigned) audio URL to a temp file with a hard size limit."""

from __future__ import annotations

import contextlib
import logging
import os
import tempfile
from collections.abc import AsyncIterator
from pathlib import PurePosixPath
from urllib.parse import urlparse

import httpx

log = logging.getLogger(__name__)

_CHUNK = 1024 * 1024


class DownloadError(Exception):
    pass


class DownloadTooLarge(DownloadError):
    pass


def _suffix_for(url: str) -> str:
    suffix = PurePosixPath(urlparse(url).path).suffix.lower()
    # Only keep short, plain extensions (helps ffmpeg/PyAV sniff the container).
    if suffix and len(suffix) <= 6 and suffix[1:].isalnum():
        return suffix
    return ".bin"


async def download_to_file(client: httpx.AsyncClient, url: str, dest: str, max_bytes: int) -> int:
    """Download `url` into `dest`. Returns bytes written. Raises DownloadTooLarge/DownloadError."""
    written = 0
    async with client.stream("GET", url) as resp:
        if resp.status_code != 200:
            raise DownloadError(f"audio download failed: HTTP {resp.status_code}")
        declared = resp.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > max_bytes:
            raise DownloadTooLarge(f"audio is {declared} bytes, limit is {max_bytes}")
        with open(dest, "wb") as f:
            async for chunk in resp.aiter_bytes(_CHUNK):
                written += len(chunk)
                if written > max_bytes:
                    raise DownloadTooLarge(f"audio exceeds limit of {max_bytes} bytes")
                f.write(chunk)
    if written == 0:
        raise DownloadError("audio download returned an empty body")
    return written


@contextlib.asynccontextmanager
async def downloaded_audio(client: httpx.AsyncClient, url: str, max_bytes: int) -> AsyncIterator[str]:
    """Yield a temp file path containing the audio; always deleted afterwards."""
    fd, path = tempfile.mkstemp(prefix="transcriber-", suffix=_suffix_for(url))
    os.close(fd)
    try:
        size = await download_to_file(client, url, path, max_bytes)
        log.info("audio downloaded", extra={"bytes": size})
        yield path
    finally:
        with contextlib.suppress(OSError):
            os.unlink(path)
