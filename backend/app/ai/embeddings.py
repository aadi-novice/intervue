"""Embedding inputs + calls. Canonical texts deliberately exclude identity and school names."""

import re

from app.ai import llm

BATCH = 64


def _join(parts: list[str]) -> str:
    return "\n".join(p.strip() for p in parts if p and p.strip())


def resume_canonical_text(profile: dict) -> str:
    """summary + experience + skills + projects (no name, contact details or institutions)."""
    exp = [
        f"{e.get('designation', '')} at {e.get('company', '')}: {e.get('description', '')} "
        f"Technologies: {', '.join(e.get('technologies') or [])}"
        for e in profile.get("experience") or []
    ]
    projects = [
        f"Project {p.get('name', '')}: {p.get('description', '')} "
        f"Technologies: {', '.join(p.get('technologies') or [])}"
        for p in profile.get("projects") or []
    ]
    skills = profile.get("skills") or {}
    skill_line = "; ".join(
        f"{k.replace('_', ' ')}: {', '.join(v)}" for k, v in skills.items() if v
    )
    years = (profile.get("metadata") or {}).get("total_experience_years")
    return _join(
        [
            profile.get("summary", ""),
            f"Total experience: {years} years" if years else "",
            *exp,
            f"Skills: {skill_line}" if skill_line else "",
            *projects,
        ]
    )[:30000]


def role_canonical_text(name: str, level: str, years: int, description: str | None, rubric) -> str:
    crit = [
        f"- {c.name}{' (must have)' if c.must_have else ''}: {c.description}" for c in rubric
    ]
    return _join(
        [
            f"{name} ({level}, {years}+ years)",
            description or "",
            "Requirements:" if crit else "",
            *crit,
        ]
    )[:30000]


def redact_resume_text(text: str, basics: dict | None, education: list | None) -> str:
    """Remove name, email, phone and institution names before scoring (bias guardrail)."""
    basics = basics or {}
    secrets = [
        basics.get("full_name"),
        basics.get("email"),
        basics.get("phone"),
        *[(e or {}).get("institution") for e in education or []],
    ]
    for s in sorted({s.strip() for s in secrets if s and len(s.strip()) >= 3}, key=len, reverse=True):
        text = re.sub(re.escape(s), "[REDACTED]", text, flags=re.I)
    return text


def embed_texts(texts: list[str], org_id: int, purpose: str, job_id: int | None = None):
    out: list[list[float]] = []
    for i in range(0, len(texts), BATCH):
        out.extend(
            llm.embed(purpose=purpose, texts=texts[i : i + BATCH], org_id=org_id, job_id=job_id)
        )
    return out


def normalize_ws(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip().lower()
