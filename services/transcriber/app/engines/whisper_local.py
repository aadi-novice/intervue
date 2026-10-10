"""Local faster-whisper engine (GPU or CPU)."""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from app.engines.base import Segment, TranscriptionResult, Word, normalize_language, sec_to_ms

log = logging.getLogger(__name__)


def _default_model_factory(model: str, device: str, compute_type: str, download_root: str | None) -> Any:
    from faster_whisper import WhisperModel

    return WhisperModel(model, device=device, compute_type=compute_type, download_root=download_root)


class WhisperLocalEngine:
    def __init__(
        self,
        model: str,
        device: str,
        compute_type: str,
        beam_size: int = 5,
        download_root: str | None = None,
        model_factory: Callable[..., Any] | None = None,
    ) -> None:
        self.model_name = model
        self.device = device
        self.compute_type = compute_type
        self.beam_size = beam_size
        self.download_root = download_root
        self._factory = model_factory or _default_model_factory
        self._model: Any | None = None

    def load(self) -> None:
        log.info(
            "loading whisper model",
            extra={"model": self.model_name, "device": self.device, "compute_type": self.compute_type},
        )
        self._model = self._factory(self.model_name, self.device, self.compute_type, self.download_root)
        log.info("whisper model loaded", extra={"model": self.model_name})

    def transcribe(self, path: str, language: str | None) -> TranscriptionResult:
        if self._model is None:
            self.load()
        assert self._model is not None
        segments_iter, info = self._model.transcribe(
            path,
            language=normalize_language(language),
            vad_filter=True,
            word_timestamps=True,
            beam_size=self.beam_size,
        )
        # `segments_iter` is a lazy generator: decoding happens while iterating.
        segments = [self._map_segment(s) for s in segments_iter]
        return TranscriptionResult(
            language=info.language,
            duration_ms=sec_to_ms(info.duration),
            segments=segments,
        )

    @staticmethod
    def _map_segment(seg: Any) -> Segment:
        words = [
            Word(
                start_ms=sec_to_ms(w.start),
                end_ms=sec_to_ms(w.end),
                word=w.word,
                probability=float(w.probability) if w.probability is not None else None,
            )
            for w in (seg.words or [])
        ]
        return Segment(
            start_ms=sec_to_ms(seg.start),
            end_ms=sec_to_ms(seg.end),
            text=seg.text.strip(),
            avg_logprob=float(seg.avg_logprob) if seg.avg_logprob is not None else None,
            words=words,
        )
