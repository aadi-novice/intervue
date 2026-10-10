"""LLM gateway: ai_runs bookkeeping, cost, caching, error recording."""

from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.ai import llm
from app.ai.schemas import ClaimCheckOut
from app.models.ai_run import AIRun


def _fake_client(parsed=None, refusal=None, prompt_tokens=1000, completion_tokens=500):
    msg = SimpleNamespace(parsed=parsed, refusal=refusal)
    resp = SimpleNamespace(
        choices=[SimpleNamespace(message=msg)],
        usage=SimpleNamespace(prompt_tokens=prompt_tokens, completion_tokens=completion_tokens),
    )
    client = MagicMock()
    client.chat.completions.parse.return_value = resp
    return client


def _out():
    return ClaimCheckOut.model_validate(
        {
            "comparisons": [
                {
                    "claim": "Python expert",
                    "resume_quote": "Python",
                    "verdict": "verified",
                    "explanation": "Confirmed",
                    "severity": "low",
                    "segment_ids": [1],
                }
            ]
        }
    )


def _call(org_id, **kw):
    return llm.complete_json(
        purpose="claim_check",
        prompt_version="v1",
        messages=[{"role": "user", "content": "hi"}],
        schema=ClaimCheckOut,
        org_id=org_id,
        **kw,
    )


def test_records_ai_run_with_tokens_and_cost(db_session, org):
    client = _fake_client(parsed=_out())
    with patch("app.ai.llm.get_client", return_value=client):
        result = _call(org.id)

    assert result.comparisons[0].claim == "Python expert"
    run = db_session.query(AIRun).one()
    assert (run.org_id, run.purpose, run.status) == (org.id, "claim_check", "ok")
    assert (run.input_tokens, run.output_tokens) == (1000, 500)
    # gpt-4.1-mini: 1000 * 0.40/1M + 500 * 1.60/1M = 0.0012
    assert run.cost_usd == Decimal("0.00120")
    assert run.prompt_version == "v1"


def test_identical_input_is_served_from_cache(db_session, org):
    client = _fake_client(parsed=_out())
    with patch("app.ai.llm.get_client", return_value=client):
        _call(org.id)
        again = _call(org.id)

    assert client.chat.completions.parse.call_count == 1
    assert again.comparisons[0].verdict == "verified"
    statuses = [r.status for r in db_session.query(AIRun).order_by(AIRun.id)]
    assert statuses == ["ok", "cached"]


def test_cache_is_not_shared_across_orgs(db_session, org, other_org):
    client = _fake_client(parsed=_out())
    with patch("app.ai.llm.get_client", return_value=client):
        _call(org.id)
        _call(other_org.id)
    assert client.chat.completions.parse.call_count == 2


def test_cache_can_be_bypassed(db_session, org):
    client = _fake_client(parsed=_out())
    with patch("app.ai.llm.get_client", return_value=client):
        _call(org.id)
        _call(org.id, use_cache=False)
    assert client.chat.completions.parse.call_count == 2


def test_refusal_and_errors_are_recorded(db_session, org):
    client = _fake_client(refusal="nope")
    with patch("app.ai.llm.get_client", return_value=client):
        with pytest.raises(llm.LLMError):
            _call(org.id)
    client.chat.completions.parse.side_effect = RuntimeError("boom")
    with patch("app.ai.llm.get_client", return_value=client):
        with pytest.raises(RuntimeError):
            _call(org.id, use_cache=False)
    runs = db_session.query(AIRun).order_by(AIRun.id).all()
    assert [r.status for r in runs] == ["error", "error"]
    assert "boom" in runs[1].error


def test_embed_records_run_and_orders_by_index(db_session, org):
    client = MagicMock()
    client.embeddings.create.return_value = SimpleNamespace(
        data=[
            SimpleNamespace(index=1, embedding=[0.2]),
            SimpleNamespace(index=0, embedding=[0.1]),
        ],
        usage=SimpleNamespace(prompt_tokens=100),
    )
    with patch("app.ai.llm.get_client", return_value=client):
        vecs = llm.embed(purpose="embedding", texts=["a", "b"], org_id=org.id)
    assert vecs == [[0.1], [0.2]]
    run = db_session.query(AIRun).one()
    assert run.purpose == "embedding" and run.input_tokens == 100


def test_unknown_model_cost_is_zero():
    assert llm.compute_cost("mystery-model", 10, 10) == Decimal("0")
