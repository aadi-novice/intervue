"""Find a supported meeting link (Meet / Teams / Zoom) inside calendar event text."""

import html
import re

_PATTERNS = [
    re.compile(r"https?://meet\.google\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:\?[^\s<>\"')]*)?", re.I),
    re.compile(r"https?://teams\.(?:microsoft|live)\.com/[^\s<>\"')]+", re.I),
    re.compile(r"https?://[\w.-]*zoom\.(?:us|com)/(?:j|my)/[^\s<>\"')]+", re.I),
]
_TRAILING = ".,;:!?)]}>\"'"


def extract_meeting_url(*texts: str | None) -> str | None:
    """First supported link across the given fields, in order (put structured fields first)."""
    for text in texts:
        if not text:
            continue
        text = html.unescape(text)
        for pat in _PATTERNS:
            m = pat.search(text)
            if m:
                return m.group(0).rstrip(_TRAILING)
    return None
