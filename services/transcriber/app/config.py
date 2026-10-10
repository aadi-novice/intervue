"""Service configuration (environment only, via pydantic-settings)."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_WHISPER_MODEL = "large-v3"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- auth / signing (required, no defaults on purpose) ---
    transcriber_api_key: str = Field(min_length=1)
    transcriber_callback_secret: str = Field(min_length=1)

    # --- engine selection ---
    transcriber_mode: Literal["local", "api"] = "local"

    # --- local (faster-whisper) ---
    whisper_model: str = DEFAULT_WHISPER_MODEL
    whisper_device: Literal["auto", "cuda", "cpu"] = "auto"
    whisper_compute_type: str | None = None  # None -> int8_float16 on cuda, int8 on cpu
    whisper_cpu_fallback_model: str = "medium"
    whisper_beam_size: int = 5
    whisper_download_root: str | None = None  # model cache dir (HF cache by default)

    # --- hosted STT API ---
    stt_api_provider: Literal["openai"] = "openai"
    stt_api_model: str = "whisper-1"
    openai_api_key: str | None = None

    # --- jobs ---
    max_concurrent_jobs: int = Field(default=1, ge=1)
    job_ttl_seconds: int = 24 * 3600  # finished jobs are forgotten after this
    download_max_bytes: int = 2 * 1024**3
    download_timeout_seconds: float = 300.0

    # --- callbacks ---
    callback_inline_max_bytes: int = 5 * 1024**2
    callback_max_attempts: int = Field(default=5, ge=1)
    callback_retry_base_seconds: float = 1.0
    callback_timeout_seconds: float = 30.0

    log_level: str = "INFO"

    # ------------------------------------------------------------------ helpers
    def resolve_device(self) -> str:
        if self.whisper_device != "auto":
            return self.whisper_device
        try:
            import ctranslate2

            return "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
        except Exception:  # pragma: no cover - ctranslate2 missing/broken
            return "cpu"

    def resolve_compute_type(self, device: str) -> str:
        if self.whisper_compute_type:
            return self.whisper_compute_type
        return "int8_float16" if device == "cuda" else "int8"

    def resolve_model(self, device: str) -> str:
        """On CPU, swap the (too slow) default large-v3 for the fallback model,
        unless WHISPER_MODEL was set explicitly."""
        explicitly_set = "whisper_model" in self.model_fields_set
        if device == "cpu" and not explicitly_set:
            return self.whisper_cpu_fallback_model
        return self.whisper_model


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
