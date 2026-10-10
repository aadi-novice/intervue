"""Engine-agnostic transcription result types."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Protocol, runtime_checkable


def sec_to_ms(seconds: float | None) -> int:
    """Convert seconds (float) to integer milliseconds."""
    if seconds is None:
        return 0
    return int(round(float(seconds) * 1000))


@dataclass
class Word:
    start_ms: int
    end_ms: int
    word: str
    probability: float | None


@dataclass
class Segment:
    start_ms: int
    end_ms: int
    text: str
    avg_logprob: float | None
    words: list[Word] = field(default_factory=list)


@dataclass
class TranscriptionResult:
    language: str
    duration_ms: int
    segments: list[Segment]

    def to_dict(self) -> dict:
        return asdict(self)


def normalize_language(language: str | None) -> str | None:
    """"auto" (or empty) means let the engine detect the language."""
    if not language or language.lower() == "auto":
        return None
    return language.lower()


@runtime_checkable
class TranscriptionEngine(Protocol):
    def load(self) -> None:
        """Load model weights / create clients. Blocking; called in a thread."""
        ...

    def transcribe(self, path: str, language: str | None) -> TranscriptionResult:
        """Blocking transcription. `language` is "auto"/None or an ISO code."""
        ...
