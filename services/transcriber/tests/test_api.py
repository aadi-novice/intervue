from __future__ import annotations

import json
import os
import threading
import time

import httpx
import pytest
import respx

from app.callback import compute_signature
from tests.conftest import (
    API_KEY,
    AUDIO_URL,
    AUTH,
    CALLBACK_URL,
    SECRET,
    FakeEngine,
    wait_for,
    wait_status,
)

AUDIO_BYTES = b"OggS" + b"\x00" * 2048


def job_body(job_id: str = "job-1", **kw) -> dict:
    body = {"job_id": job_id, "audio_url": AUDIO_URL, "language": "auto", "callback_url": CALLBACK_URL}
    body.update(kw)
    return body


@pytest.fixture
def mock_http():
    with respx.mock(assert_all_called=False) as router:
        router.get(AUDIO_URL).mock(return_value=httpx.Response(200, content=AUDIO_BYTES))
        router.post(CALLBACK_URL).mock(return_value=httpx.Response(200, json={"ok": True}))
        yield router


def callback_calls(router) -> list[httpx.Request]:
    return [c.request for c in router.calls if c.request.method == "POST" and str(c.request.url) == CALLBACK_URL]


def assert_valid_signature(req: httpx.Request) -> dict:
    ts = req.headers["X-Timestamp"]
    assert ts.isdigit() and abs(int(ts) - time.time()) < 60
    raw = req.content
    expected = compute_signature(SECRET, ts, raw)
    # Recompute independently of the helper too.
    import hashlib
    import hmac

    assert expected == hmac.new(SECRET.encode(), f"{ts}.".encode() + raw, hashlib.sha256).hexdigest()
    assert req.headers["X-Signature"] == expected
    assert req.headers["Content-Type"] == "application/json"
    return json.loads(raw)


# ----------------------------------------------------------------------------- health
def test_healthz_and_readyz(client_factory, engine):
    c = client_factory(engine)
    assert c.get("/healthz").status_code == 200
    wait_for(lambda: c.get("/readyz").status_code == 200)


def test_readyz_503_until_model_loaded(client_factory):
    gate = threading.Event()
    c = client_factory(FakeEngine(load_gate=gate))
    assert c.get("/healthz").status_code == 200
    r = c.get("/readyz")
    assert r.status_code == 503 and r.json()["status"] == "loading"
    gate.set()
    wait_for(lambda: c.get("/readyz").status_code == 200)


def test_readyz_api_mode_always_ready(client_factory):
    gate = threading.Event()
    c = client_factory(FakeEngine(load_gate=gate), transcriber_mode="api")
    assert c.get("/readyz").status_code == 200
    gate.set()


# ------------------------------------------------------------------------------- auth
@pytest.mark.parametrize(
    "headers",
    [{}, {"Authorization": "Bearer wrong"}, {"Authorization": API_KEY}, {"Authorization": f"Basic {API_KEY}"}],
)
def test_auth_required(client_factory, engine, headers):
    c = client_factory(engine)
    r = c.post("/jobs", json=job_body(), headers=headers)
    assert r.status_code == 401
    assert r.json() == {"detail": "invalid or missing API key", "code": "unauthorized"}
    assert c.get("/jobs/job-1", headers=headers).status_code == 401
    assert engine.calls == []


def test_unknown_job_404(client_factory, engine):
    c = client_factory(engine)
    r = c.get("/jobs/nope", headers=AUTH)
    assert r.status_code == 404 and r.json()["code"] == "not_found"


def test_validation_error(client_factory, engine):
    c = client_factory(engine)
    assert c.post("/jobs", json={"job_id": "x"}, headers=AUTH).status_code == 422
    assert c.post("/jobs", json=job_body(language="not a lang"), headers=AUTH).status_code == 422


# ----------------------------------------------------------------- 202 + idempotency
def test_202_and_idempotent_by_job_id(client_factory, mock_http):
    gate = threading.Event()
    engine = FakeEngine(gate=gate)
    c = client_factory(engine)

    r = c.post("/jobs", json=job_body(), headers=AUTH)
    assert r.status_code == 202
    assert r.json() == {"job_id": "job-1", "status": "queued"}

    wait_for(lambda: len(engine.calls) == 1)
    r2 = c.post("/jobs", json=job_body(), headers=AUTH)
    assert r2.status_code == 202
    assert r2.json() == {"job_id": "job-1", "status": "running"}

    gate.set()
    assert wait_status(c, "job-1")["status"] == "completed"
    r3 = c.post("/jobs", json=job_body(), headers=AUTH)
    assert r3.status_code == 202 and r3.json()["status"] == "completed"

    time.sleep(0.1)
    assert len(engine.calls) == 1
    assert len(callback_calls(mock_http)) == 1


# ----------------------------------------------------------------- happy path callback
def test_job_runs_and_posts_signed_callback(client_factory, engine, mock_http):
    c = client_factory(engine)
    c.post("/jobs", json=job_body("job-ok", language="en"), headers=AUTH)
    status = wait_status(c, "job-ok")
    assert status == {"job_id": "job-ok", "status": "completed", "error": None}

    [req] = callback_calls(mock_http)
    payload = assert_valid_signature(req)
    assert payload == {
        "job_id": "job-ok",
        "status": "completed",
        "language": "en",
        "duration_ms": 123000,
        "segments": [
            {
                "start_ms": 0,
                "end_ms": 1500,
                "text": "Hello there.",
                "avg_logprob": -0.21,
                "words": [
                    {"start_ms": 0, "end_ms": 600, "word": " Hello", "probability": 0.98},
                    {"start_ms": 650, "end_ms": 1500, "word": " there.", "probability": 0.91},
                ],
            }
        ],
    }
    # engine got the language as sent, and a real downloaded file that is deleted afterwards
    path, lang = engine.calls[0]
    assert lang == "en"
    assert engine.seen_files_existed == [True]
    assert not os.path.exists(path)


def test_language_auto_passed_through(client_factory, engine, mock_http):
    c = client_factory(engine)
    c.post("/jobs", json=job_body("job-auto"), headers=AUTH)
    wait_status(c, "job-auto")
    assert engine.calls[0][1] == "auto"


# -------------------------------------------------------------------------- failures
def test_failed_transcription_sends_failed_callback_and_can_be_retried(client_factory, mock_http):
    engine = FakeEngine(error=RuntimeError("cuda out of memory"))
    c = client_factory(engine)
    c.post("/jobs", json=job_body("job-f"), headers=AUTH)
    status = wait_status(c, "job-f")
    assert status == {"job_id": "job-f", "status": "failed", "error": "cuda out of memory"}

    [req] = callback_calls(mock_http)
    assert assert_valid_signature(req) == {"job_id": "job-f", "status": "failed", "error": "cuda out of memory"}
    assert not os.path.exists(engine.calls[0][0])

    # Re-posting a failed job re-runs it.
    r = c.post("/jobs", json=job_body("job-f"), headers=AUTH)
    assert r.status_code == 202 and r.json()["status"] == "queued"
    assert wait_status(c, "job-f")["status"] == "completed"
    assert len(engine.calls) == 2
    assert json.loads(callback_calls(mock_http)[1].content)["status"] == "completed"


def test_callback_retried_on_5xx(client_factory, engine):
    with respx.mock(assert_all_called=False) as router:
        router.get(AUDIO_URL).mock(return_value=httpx.Response(200, content=AUDIO_BYTES))
        cb = router.post(CALLBACK_URL).mock(
            side_effect=[httpx.Response(500), httpx.Response(503), httpx.ConnectError("boom"), httpx.Response(204)]
        )
        c = client_factory(engine)
        c.post("/jobs", json=job_body("job-r"), headers=AUTH)
        assert wait_status(c, "job-r")["status"] == "completed"
        assert cb.call_count == 4
        bodies = {call.request.content for call in cb.calls}
        assert len(bodies) == 1  # same body every attempt
        for call in cb.calls:
            assert_valid_signature(call.request)


def test_callback_gives_up_after_5_attempts(client_factory, engine):
    with respx.mock(assert_all_called=False) as router:
        router.get(AUDIO_URL).mock(return_value=httpx.Response(200, content=AUDIO_BYTES))
        cb = router.post(CALLBACK_URL).mock(return_value=httpx.Response(502))
        c = client_factory(engine)
        c.post("/jobs", json=job_body("job-g"), headers=AUTH)
        assert wait_status(c, "job-g")["status"] == "completed"
        assert cb.call_count == 5


def test_download_size_limit_fails_job(client_factory, engine):
    with respx.mock(assert_all_called=False) as router:
        router.get(AUDIO_URL).mock(return_value=httpx.Response(200, content=b"x" * 5000))
        cb = router.post(CALLBACK_URL).mock(return_value=httpx.Response(200))
        c = client_factory(engine, download_max_bytes=1000)
        c.post("/jobs", json=job_body("job-big"), headers=AUTH)
        status = wait_status(c, "job-big")
        assert status["status"] == "failed"
        assert "limit" in status["error"]
        payload = assert_valid_signature(cb.calls[0].request)
        assert payload["status"] == "failed" and "limit" in payload["error"]
        assert engine.calls == []


def test_download_http_error_fails_job(client_factory, engine):
    with respx.mock(assert_all_called=False) as router:
        router.get(AUDIO_URL).mock(return_value=httpx.Response(403))
        router.post(CALLBACK_URL).mock(return_value=httpx.Response(200))
        c = client_factory(engine)
        c.post("/jobs", json=job_body("job-403"), headers=AUTH)
        status = wait_status(c, "job-403")
        assert status["status"] == "failed" and "403" in status["error"]


def test_concurrency_bounded(client_factory, mock_http):
    gate = threading.Event()
    engine = FakeEngine(gate=gate)
    c = client_factory(engine, max_concurrent_jobs=1)
    for i in range(3):
        c.post("/jobs", json=job_body(f"job-c{i}"), headers=AUTH)
    wait_for(lambda: len(engine.calls) == 1)
    time.sleep(0.1)
    assert len(engine.calls) == 1
    assert c.get("/jobs/job-c2", headers=AUTH).json()["status"] == "queued"
    gate.set()
    for i in range(3):
        assert wait_status(c, f"job-c{i}")["status"] == "completed"
