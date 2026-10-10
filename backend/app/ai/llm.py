"""
LLM gateway. EVERY model call in the app goes through here.

- structured outputs validated with Pydantic (no regex-parsing JSON)
- one `ai_runs` row per call (org, purpose, model, tokens, cost, latency, prompt_version)
- identical input (org + purpose + prompt_version + model + messages) is served from cache
"""

import hashlib
import json
import logging
import time
from decimal import Decimal
from functools import lru_cache
from typing import TypeVar

from pydantic import BaseModel

from app.core.config import settings
from app.db import session as db_session
from app.models.ai_run import AIRun

log = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)

# USD per 1M tokens (input, output). Unknown models are recorded with cost 0 + a warning.
PRICING: dict[str, tuple[Decimal, Decimal]] = {
    "gpt-4.1": (Decimal("2.00"), Decimal("8.00")),
    "gpt-4.1-mini": (Decimal("0.40"), Decimal("1.60")),
    "gpt-4.1-nano": (Decimal("0.10"), Decimal("0.40")),
    "gpt-4o": (Decimal("2.50"), Decimal("10.00")),
    "gpt-4o-mini": (Decimal("0.15"), Decimal("0.60")),
    "text-embedding-3-small": (Decimal("0.02"), Decimal("0")),
    "text-embedding-3-large": (Decimal("0.13"), Decimal("0")),
}

PURPOSE_MODEL = {
    "resume_parse": lambda: settings.model_resume_parse,
    "rank": lambda: settings.model_rank,
    "rubric_suggest": lambda: settings.model_rank,
}


def model_for(purpose: str) -> str:
    return PURPOSE_MODEL.get(purpose, lambda: settings.model_analysis)()


class LLMError(Exception):
    pass


@lru_cache
def get_client():
    from openai import OpenAI

    if not settings.openai_api_key:
        raise LLMError("OPENAI_API_KEY is not configured")
    return OpenAI(api_key=settings.openai_api_key, max_retries=2, timeout=120)


def compute_cost(model: str, input_tokens: int, output_tokens: int) -> Decimal:
    price = PRICING.get(model)
    if price is None:
        log.warning("No pricing for model %s; cost recorded as 0", model)
        return Decimal("0")
    return (
        Decimal(input_tokens) * price[0] + Decimal(output_tokens) * price[1]
    ) / Decimal(1_000_000)


def cache_key(org_id: int, purpose: str, prompt_version: str, model: str, payload) -> str:
    raw = json.dumps(
        [org_id, purpose, prompt_version, model, payload], sort_keys=True, ensure_ascii=False
    )
    return hashlib.sha256(raw.encode()).hexdigest()


def _record(**fields) -> None:
    # Own session so cost data survives a rolled-back caller transaction.
    s = db_session.SessionLocal()
    try:
        s.add(AIRun(**fields))
        s.commit()
    except Exception:  # never let bookkeeping break the feature
        log.exception("failed to record ai_run")
        s.rollback()
    finally:
        s.close()


def _cached(org_id: int, key: str) -> dict | None:
    s = db_session.SessionLocal()
    try:
        row = (
            s.query(AIRun)
            .filter(
                AIRun.org_id == org_id,
                AIRun.cache_key == key,
                AIRun.status == "ok",
                AIRun.result.isnot(None),
            )
            .order_by(AIRun.id.desc())
            .first()
        )
        return row.result if row else None
    finally:
        s.close()


def complete_json(
    *,
    purpose: str,
    prompt_version: str,
    messages: list[dict],
    schema: type[T],
    org_id: int,
    temperature: float = 0.2,
    use_cache: bool = True,
) -> T:
    model = model_for(purpose)
    key = cache_key(org_id, purpose, prompt_version, model, messages)
    if use_cache:
        hit = _cached(org_id, key)
        if hit is not None:
            _record(
                org_id=org_id, purpose=purpose, model=model, prompt_version=prompt_version,
                status="cached", cache_key=key, input_tokens=0, output_tokens=0, cost_usd=0,
                latency_ms=0,
            )
            return schema.model_validate(hit)

    started = time.perf_counter()
    try:
        resp = get_client().chat.completions.parse(
            model=model, messages=messages, response_format=schema, temperature=temperature
        )
        msg = resp.choices[0].message
        if msg.refusal:
            raise LLMError(f"Model refused: {msg.refusal}")
        parsed = msg.parsed
        if parsed is None:
            raise LLMError("Model returned no parsable output")
    except Exception as e:
        _record(
            org_id=org_id, purpose=purpose, model=model, prompt_version=prompt_version,
            status="error", error=str(e)[:2000], cache_key=key, input_tokens=0, output_tokens=0,
            cost_usd=0, latency_ms=int((time.perf_counter() - started) * 1000),
        )
        raise

    usage = resp.usage
    in_t, out_t = (usage.prompt_tokens, usage.completion_tokens) if usage else (0, 0)
    _record(
        org_id=org_id, purpose=purpose, model=model, prompt_version=prompt_version,
        status="ok", cache_key=key, input_tokens=in_t, output_tokens=out_t,
        cost_usd=compute_cost(model, in_t, out_t),
        latency_ms=int((time.perf_counter() - started) * 1000),
        result=parsed.model_dump(mode="json"),
    )
    return parsed


def embed(*, purpose: str, texts: list[str], org_id: int) -> list[list[float]]:
    """Embed texts (batched). Records one ai_run for the batch."""
    model = settings.embedding_model
    started = time.perf_counter()
    try:
        resp = get_client().embeddings.create(model=model, input=texts)
    except Exception as e:
        _record(
            org_id=org_id, purpose=purpose, model=model, prompt_version="-", status="error",
            error=str(e)[:2000], input_tokens=0, output_tokens=0, cost_usd=0,
            latency_ms=int((time.perf_counter() - started) * 1000),
        )
        raise
    in_t = resp.usage.prompt_tokens if resp.usage else 0
    _record(
        org_id=org_id, purpose=purpose, model=model, prompt_version="-", status="ok",
        input_tokens=in_t, output_tokens=0, cost_usd=compute_cost(model, in_t, 0),
        latency_ms=int((time.perf_counter() - started) * 1000),
    )
    return [d.embedding for d in sorted(resp.data, key=lambda d: d.index)]
