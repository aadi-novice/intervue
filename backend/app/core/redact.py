"""Scrub secrets out of text that is stored or shown to users (job errors, ai_runs.error)."""

import re

_PATTERNS = [
    (re.compile(r"sk-[A-Za-z0-9_\-]{8,}"), "sk-[redacted]"),  # OpenAI-style keys
    (re.compile(r"(?i)bearer\s+[A-Za-z0-9._\-]{12,}"), "Bearer [redacted]"),
    (re.compile(r"(?i)(api[_-]?key|secret|token|password)(\s*[=:]\s*)[^\s,;'\"]{6,}"), r"\1\2[redacted]"),
    (re.compile(r"AKIA[0-9A-Z]{16}"), "[redacted-aws-key]"),
]


def scrub(text: str | None, limit: int = 2000) -> str | None:
    if text is None:
        return None
    for pat, repl in _PATTERNS:
        text = pat.sub(repl, text)
    return text[:limit]
