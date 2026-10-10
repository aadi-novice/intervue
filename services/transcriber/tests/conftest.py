from __future__ import annotations

import threading
import time
from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.engines.base import Segment, TranscriptionResult, Word
from app.main import create_app

API_KEY = "test-api-key"
SECRET = "test-callback-secret"
AUDIO_URL = "https://storage.example.com/recordings/abc/audio.opus?X-Amz-Signature=xyz"
CALLBACK_URL = "https://backend.example.com/internal/transcriber/callback"
AUTH = {"Authorization": f"Bearer {API_KEY}"}


def make_settings(**overrides) -> Settings:
    base = dict(
        transcriber_api_key=API_KEY,
        transcriber_callback_secret=SECRET,
        callback_retry_base_seconds=0.0,
        _env_file=None,
    )
    base.update(overrides)
    return Settings(**base)  # type: ignore[arg-type]


def sample_result() -> TranscriptionResult:
    return TranscriptionResult(
        language="en",
        duration_ms=123000,
        segments=[
            Segment(
                start_ms=0,
                end_ms=1500,
                text="Hello there.",
                avg_logprob=-0.21,
                words=[Word(0, 600, " Hello", 0.98), Word(650, 1500, " there.", 0.91)],
            )
        ],
    )


class FakeEngine:
    def __init__(
        self,
        result: TranscriptionResult | None = None,
        error: Exception | None = None,
        gate: threading.Event | None = None,
        load_gate: threading.Event | None = None,
    ) -> None:
        self.result = result or sample_result()
        self.error = error
        self.gate = gate
        self.load_gate = load_gate
        self.calls: list[tuple[str, str | None]] = []
        self.seen_files_existed: list[bool] = []
        self.loaded = False

    def load(self) -> None:
        if self.load_gate is not None:
            self.load_gate.wait(10)
        self.loaded = True

    def transcribe(self, path: str, language: str | None) -> TranscriptionResult:
        import os

        self.calls.append((path, language))
        self.seen_files_existed.append(os.path.exists(path))
        if self.gate is not None:
            self.gate.wait(10)
        if self.error is not None:
            err, self.error = self.error, None  # fail once, then succeed
            raise err
        return self.result


@pytest.fixture
def engine() -> FakeEngine:
    return FakeEngine()


@pytest.fixture
def client_factory() -> Callable[..., TestClient]:
    clients: list[TestClient] = []

    def _make(engine, **settings_overrides) -> TestClient:
        app = create_app(make_settings(**settings_overrides), engine=engine)
        c = TestClient(app)
        c.__enter__()
        clients.append(c)
        return c

    yield _make
    for c in clients:
        c.__exit__(None, None, None)


def wait_for(predicate: Callable[[], bool], timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("condition not met in time")


def wait_status(client: TestClient, job_id: str, statuses=("completed", "failed")) -> dict:
    holder: dict = {}

    def check() -> bool:
        r = client.get(f"/jobs/{job_id}", headers=AUTH)
        holder.update(r.json())
        return r.status_code == 200 and holder.get("status") in statuses

    wait_for(check)
    return holder
