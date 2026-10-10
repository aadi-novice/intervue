"""Hosted speech-to-text via the OpenAI audio transcription API (TRANSCRIBER_MODE=api).

Notes / limits:
- OpenAI rejects uploads larger than 25 MB. Recordings from the notetaker bot are
  16 kHz mono Opus (roughly 1 MB per 10 min at 16 kbit/s), so this covers multi-hour calls.
- Only `whisper-1` supports `verbose_json` with word + segment timestamps. For other
  models (e.g. `gpt-4o-transcribe`) the API returns text only, so the result is a single
  segment spanning the whole file with no word timings.
- The API does not return per-word probabilities, so `probability` is null.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from app.engines.base import Segment, TranscriptionResult, Word, normalize_language, sec_to_ms

log = logging.getLogger(__name__)

# Whisper language codes -> names (verbose_json returns the *name*, e.g. "english").
_WHISPER_LANGUAGES = {
    "en": "english", "zh": "chinese", "de": "german", "es": "spanish", "ru": "russian",
    "ko": "korean", "fr": "french", "ja": "japanese", "pt": "portuguese", "tr": "turkish",
    "pl": "polish", "ca": "catalan", "nl": "dutch", "ar": "arabic", "sv": "swedish",
    "it": "italian", "id": "indonesian", "hi": "hindi", "fi": "finnish", "vi": "vietnamese",
    "he": "hebrew", "uk": "ukrainian", "el": "greek", "ms": "malay", "cs": "czech",
    "ro": "romanian", "da": "danish", "hu": "hungarian", "ta": "tamil", "no": "norwegian",
    "th": "thai", "ur": "urdu", "hr": "croatian", "bg": "bulgarian", "lt": "lithuanian",
    "la": "latin", "mi": "maori", "ml": "malayalam", "cy": "welsh", "sk": "slovak",
    "te": "telugu", "fa": "persian", "lv": "latvian", "bn": "bengali", "sr": "serbian",
    "az": "azerbaijani", "sl": "slovenian", "kn": "kannada", "et": "estonian", "mk": "macedonian",
    "br": "breton", "eu": "basque", "is": "icelandic", "hy": "armenian", "ne": "nepali",
    "mn": "mongolian", "bs": "bosnian", "kk": "kazakh", "sq": "albanian", "sw": "swahili",
    "gl": "galician", "mr": "marathi", "pa": "punjabi", "si": "sinhala", "km": "khmer",
    "sn": "shona", "yo": "yoruba", "so": "somali", "af": "afrikaans", "oc": "occitan",
    "ka": "georgian", "be": "belarusian", "tg": "tajik", "sd": "sindhi", "gu": "gujarati",
    "am": "amharic", "yi": "yiddish", "lo": "lao", "uz": "uzbek", "fo": "faroese",
    "ht": "haitian creole", "ps": "pashto", "tk": "turkmen", "nn": "nynorsk", "mt": "maltese",
    "sa": "sanskrit", "lb": "luxembourgish", "my": "myanmar", "bo": "tibetan", "tl": "tagalog",
    "mg": "malagasy", "as": "assamese", "tt": "tatar", "haw": "hawaiian", "ln": "lingala",
    "ha": "hausa", "ba": "bashkir", "jw": "javanese", "su": "sundanese", "yue": "cantonese",
}
_NAME_TO_CODE = {name: code for code, name in _WHISPER_LANGUAGES.items()}


def language_to_code(value: str | None) -> str:
    if not value:
        return "unknown"
    v = value.strip().lower()
    if v in _WHISPER_LANGUAGES:
        return v
    return _NAME_TO_CODE.get(v, v)


def _get(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _probe_duration_ms(path: str) -> int:
    """Best-effort container duration (PyAV ships with faster-whisper)."""
    try:
        import av

        with av.open(path) as container:
            if container.duration:
                return int(container.duration / 1000)  # container.duration is in microseconds
    except Exception:
        log.debug("could not probe duration", exc_info=True)
    return 0


class OpenAIEngine:
    def __init__(
        self,
        api_key: str | None,
        model: str = "whisper-1",
        client_factory: Callable[[], Any] | None = None,
    ) -> None:
        self.api_key = api_key
        self.model = model
        self._client_factory = client_factory
        self._client: Any | None = None

    @property
    def supports_timestamps(self) -> bool:
        return self.model.startswith("whisper")

    def load(self) -> None:
        if self._client_factory is not None:
            self._client = self._client_factory()
            return
        if not self.api_key:
            raise RuntimeError("OPENAI_API_KEY is required when TRANSCRIBER_MODE=api")
        from openai import OpenAI

        self._client = OpenAI(api_key=self.api_key)

    def transcribe(self, path: str, language: str | None) -> TranscriptionResult:
        if self._client is None:
            self.load()
        assert self._client is not None
        lang = normalize_language(language)
        kwargs: dict[str, Any] = {"model": self.model}
        if lang:
            kwargs["language"] = lang
        if self.supports_timestamps:
            kwargs["response_format"] = "verbose_json"
            kwargs["timestamp_granularities"] = ["word", "segment"]
        else:
            kwargs["response_format"] = "json"

        with open(path, "rb") as f:
            resp = self._client.audio.transcriptions.create(file=f, **kwargs)

        if self.supports_timestamps:
            return self.map_verbose(resp, requested_language=lang)
        text = (_get(resp, "text") or "").strip()
        duration_ms = _probe_duration_ms(path)
        segments = [Segment(0, duration_ms, text, None, [])] if text else []
        return TranscriptionResult(language=lang or "unknown", duration_ms=duration_ms, segments=segments)

    @staticmethod
    def map_verbose(resp: Any, requested_language: str | None = None) -> TranscriptionResult:
        raw_words = list(_get(resp, "words") or [])
        raw_segments = list(_get(resp, "segments") or [])
        words = [
            Word(sec_to_ms(_get(w, "start")), sec_to_ms(_get(w, "end")), _get(w, "word") or "", None)
            for w in raw_words
        ]
        segments: list[Segment] = []
        wi = 0
        for i, s in enumerate(raw_segments):
            start_ms, end_ms = sec_to_ms(_get(s, "start")), sec_to_ms(_get(s, "end"))
            is_last = i == len(raw_segments) - 1
            seg_words: list[Word] = []
            # Words and segments are both time-ordered: give each word to the segment
            # its start falls in (any leftovers go to the last segment).
            while wi < len(words) and (is_last or words[wi].start_ms < end_ms):
                seg_words.append(words[wi])
                wi += 1
            avg = _get(s, "avg_logprob")
            segments.append(
                Segment(
                    start_ms,
                    end_ms,
                    (_get(s, "text") or "").strip(),
                    float(avg) if avg is not None else None,
                    seg_words,
                )
            )
        language = requested_language or language_to_code(_get(resp, "language"))
        return TranscriptionResult(
            language=language,
            duration_ms=sec_to_ms(_get(resp, "duration")),
            segments=segments,
        )
