from __future__ import annotations

import hashlib
import hmac
import os
from types import SimpleNamespace

import httpx
import pytest
import respx

from app.callback import compute_signature, send_callback
from app.download import DownloadTooLarge, download_to_file, downloaded_audio
from app.engines.base import normalize_language, sec_to_ms
from app.engines.openai_api import OpenAIEngine, language_to_code
from app.engines.whisper_local import WhisperLocalEngine
from tests.conftest import make_settings

URL = "https://storage.example.com/a.opus"
CB = "https://backend.example.com/internal/transcriber/callback"


# ------------------------------------------------------------------------- helpers
def test_sec_to_ms():
    assert sec_to_ms(0) == 0
    assert sec_to_ms(1.2346) == 1235
    assert sec_to_ms(61.0) == 61000
    assert sec_to_ms(None) == 0
    assert isinstance(sec_to_ms(2.5), int)


@pytest.mark.parametrize("value,expected", [("auto", None), ("AUTO", None), ("", None), (None, None), ("en", "en"), ("DE", "de")])
def test_normalize_language(value, expected):
    assert normalize_language(value) == expected


# --------------------------------------------------------------------- whisper engine
class FakeWhisperModel:
    def __init__(self, segments, info):
        self._segments, self._info = segments, info
        self.kwargs = None
        self.path = None

    def transcribe(self, path, **kwargs):
        self.path, self.kwargs = path, kwargs
        return iter(self._segments), self._info


def _whisper_fixture():
    segs = [
        SimpleNamespace(
            start=0.0, end=2.4567, text=" Hello world. ", avg_logprob=-0.25,
            words=[
                SimpleNamespace(start=0.0, end=0.5004, word=" Hello", probability=0.99),
                SimpleNamespace(start=0.6, end=2.4567, word=" world.", probability=0.876),
            ],
        ),
        SimpleNamespace(start=3.1, end=4.0, text=" Bye.", avg_logprob=-0.4, words=None),
    ]
    info = SimpleNamespace(language="en", duration=123.0456)
    return FakeWhisperModel(segs, info)


def test_whisper_engine_maps_segments_and_converts_ms():
    model = _whisper_fixture()
    created = {}

    def factory(name, device, compute_type, root):
        created.update(name=name, device=device, compute_type=compute_type)
        return model

    eng = WhisperLocalEngine("large-v3", "cuda", "int8_float16", model_factory=factory)
    eng.load()
    res = eng.transcribe("/tmp/a.opus", "en")

    assert created == {"name": "large-v3", "device": "cuda", "compute_type": "int8_float16"}
    assert model.kwargs == {"language": "en", "vad_filter": True, "word_timestamps": True, "beam_size": 5}
    assert res.language == "en"
    assert res.duration_ms == 123046
    d = res.to_dict()
    assert d["segments"][0] == {
        "start_ms": 0,
        "end_ms": 2457,
        "text": "Hello world.",
        "avg_logprob": -0.25,
        "words": [
            {"start_ms": 0, "end_ms": 500, "word": " Hello", "probability": 0.99},
            {"start_ms": 600, "end_ms": 2457, "word": " world.", "probability": 0.876},
        ],
    }
    assert d["segments"][1] == {"start_ms": 3100, "end_ms": 4000, "text": "Bye.", "avg_logprob": -0.4, "words": []}


def test_whisper_engine_auto_language_is_none():
    model = _whisper_fixture()
    eng = WhisperLocalEngine("medium", "cpu", "int8", model_factory=lambda *a: model)
    eng.transcribe("/tmp/a.opus", "auto")  # lazily loads
    assert model.kwargs["language"] is None


# ------------------------------------------------------------------------------ config
def test_config_cpu_fallback_model_and_compute_types():
    s = make_settings(whisper_device="cpu")
    assert s.resolve_device() == "cpu"
    assert s.resolve_model("cpu") == "medium"
    assert s.resolve_model("cuda") == "large-v3"
    assert s.resolve_compute_type("cpu") == "int8"
    assert s.resolve_compute_type("cuda") == "int8_float16"

    explicit = make_settings(whisper_model="large-v3")
    assert explicit.resolve_model("cpu") == "large-v3"
    assert make_settings(whisper_compute_type="float16").resolve_compute_type("cuda") == "float16"


def test_config_from_env(monkeypatch):
    from app.config import Settings

    monkeypatch.setenv("TRANSCRIBER_API_KEY", "k")
    monkeypatch.setenv("TRANSCRIBER_CALLBACK_SECRET", "s")
    monkeypatch.setenv("WHISPER_MODEL", "large-v3")
    monkeypatch.setenv("MAX_CONCURRENT_JOBS", "3")
    s = Settings(_env_file=None)
    assert s.max_concurrent_jobs == 3
    assert s.download_max_bytes == 2 * 1024**3
    assert s.callback_inline_max_bytes == 5 * 1024**2
    assert s.transcriber_mode == "local"
    # explicitly set via env -> no CPU fallback
    assert s.resolve_model("cpu") == "large-v3"
    monkeypatch.delenv("WHISPER_MODEL")
    assert Settings(_env_file=None).resolve_model("cpu") == "medium"


# ---------------------------------------------------------------------- openai engine
def test_openai_verbose_mapping():
    resp = {
        "language": "english",
        "duration": 10.5,
        "segments": [
            {"start": 0.0, "end": 2.0, "text": " Hi there.", "avg_logprob": -0.1},
            {"start": 2.5, "end": 4.25, "text": " Okay.", "avg_logprob": -0.3},
        ],
        "words": [
            {"word": "Hi", "start": 0.0, "end": 0.4},
            {"word": "there.", "start": 0.5, "end": 1.9},
            {"word": "Okay.", "start": 2.6, "end": 4.25},
        ],
    }
    res = OpenAIEngine.map_verbose(resp)
    assert res.language == "en"
    assert res.duration_ms == 10500
    assert [w.word for w in res.segments[0].words] == ["Hi", "there."]
    assert res.segments[1].words[0].start_ms == 2600
    assert res.segments[1].words[0].probability is None
    assert res.segments[1].text == "Okay."


def test_openai_engine_request_params(tmp_path):
    audio = tmp_path / "a.opus"
    audio.write_bytes(b"data")
    captured = {}

    class FakeTranscriptions:
        def create(self, **kwargs):
            captured.update(kwargs)
            return {"language": "german", "duration": 1.0, "segments": [], "words": []}

    client = SimpleNamespace(audio=SimpleNamespace(transcriptions=FakeTranscriptions()))
    eng = OpenAIEngine(api_key=None, model="whisper-1", client_factory=lambda: client)
    res = eng.transcribe(str(audio), "auto")
    assert captured["response_format"] == "verbose_json"
    assert captured["timestamp_granularities"] == ["word", "segment"]
    assert "language" not in captured
    assert res.language == "de"

    captured.clear()
    eng2 = OpenAIEngine(api_key=None, model="gpt-4o-transcribe", client_factory=lambda: client)
    FakeTranscriptions.create = lambda self, **kw: (captured.update(kw), {"text": " hello "})[1]
    res2 = eng2.transcribe(str(audio), "en")
    assert captured["response_format"] == "json" and captured["language"] == "en"
    assert res2.language == "en" and res2.segments[0].text == "hello"


def test_language_to_code():
    assert language_to_code("english") == "en"
    assert language_to_code("en") == "en"
    assert language_to_code(None) == "unknown"


# ---------------------------------------------------------------------------- callback
def test_compute_signature_formula():
    body = b'{"job_id":"j"}'
    expected = hmac.new(b"sec", b"1700000000." + body, hashlib.sha256).hexdigest()
    assert compute_signature("sec", "1700000000", body) == expected


async def test_send_callback_backoff_and_attempts():
    delays: list[float] = []

    async def fake_sleep(d):
        delays.append(d)

    with respx.mock() as router:
        route = router.post(CB).mock(return_value=httpx.Response(500))
        async with httpx.AsyncClient() as client:
            ok = await send_callback(client, CB, {"job_id": "j"}, "s", max_attempts=5, base_delay=1.0, sleep=fake_sleep)
    assert ok is False
    assert route.call_count == 5
    assert delays == [1.0, 2.0, 4.0, 8.0]


async def test_send_callback_no_retry_on_4xx():
    with respx.mock() as router:
        route = router.post(CB).mock(return_value=httpx.Response(401))
        async with httpx.AsyncClient() as client:
            ok = await send_callback(client, CB, {"job_id": "j"}, "s", base_delay=0)
    assert ok is False and route.call_count == 1


async def test_send_callback_oversize_still_inline():
    with respx.mock() as router:
        route = router.post(CB).mock(return_value=httpx.Response(200))
        async with httpx.AsyncClient() as client:
            ok = await send_callback(client, CB, {"job_id": "j", "x": "y" * 100}, "s", inline_max_bytes=10)
    assert ok and route.call_count == 1


# ---------------------------------------------------------------------------- download
async def test_download_limit_without_content_length(tmp_path):
    async def chunks():
        for _ in range(10):
            yield b"x" * 100

    with respx.mock() as router:
        router.get(URL).mock(return_value=httpx.Response(200, content=chunks()))
        async with httpx.AsyncClient() as client:
            with pytest.raises(DownloadTooLarge):
                await download_to_file(client, URL, str(tmp_path / "f"), max_bytes=500)


async def test_download_rejects_by_content_length(tmp_path):
    with respx.mock() as router:
        router.get(URL).mock(return_value=httpx.Response(200, content=b"x" * 600))
        async with httpx.AsyncClient() as client:
            with pytest.raises(DownloadTooLarge):
                await download_to_file(client, URL, str(tmp_path / "f"), max_bytes=500)


async def test_downloaded_audio_cleans_up():
    with respx.mock() as router:
        router.get(URL).mock(return_value=httpx.Response(200, content=b"abc"))
        async with httpx.AsyncClient() as client:
            async with downloaded_audio(client, URL, 100) as path:
                assert path.endswith(".opus")
                with open(path, "rb") as f:
                    assert f.read() == b"abc"
            assert not os.path.exists(path)
