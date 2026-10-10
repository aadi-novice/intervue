"""Bot launcher interface. Vendor SDKs (docker, boto3 ECS, redis queue) live in the adapters."""

from dataclasses import dataclass
from typing import Protocol


@dataclass
class BotSpec:
    session_id: int
    meeting_url: str
    bot_name: str
    consent_message: str
    callback_url: str
    callback_secret: str
    upload_prefix: str
    max_duration_min: int = 180
    admission_timeout_min: int = 10
    alone_timeout_sec: int = 120

    def env(self) -> dict[str, str]:
        return {
            "BOT_SESSION_ID": str(self.session_id),
            "MEETING_URL": self.meeting_url,
            "BOT_NAME": self.bot_name,
            "CONSENT_MESSAGE": self.consent_message,
            "CALLBACK_URL": self.callback_url,
            "CALLBACK_SECRET": self.callback_secret,
            "UPLOAD_PREFIX": self.upload_prefix,
            "MAX_DURATION_MIN": str(self.max_duration_min),
            "ADMISSION_TIMEOUT_MIN": str(self.admission_timeout_min),
            "ALONE_TIMEOUT_SEC": str(self.alone_timeout_sec),
        }

    def queue_payload(self) -> dict:
        """Shape consumed by the pool worker (`services/notetaker-bot/src/pool.ts`)."""
        return {
            "bot_session_id": str(self.session_id),
            "meeting_url": self.meeting_url,
            "bot_name": self.bot_name,
            "consent_message": self.consent_message,
            "callback_url": self.callback_url,
            "callback_secret": self.callback_secret,
            "upload_prefix": self.upload_prefix,
            "max_duration_min": self.max_duration_min,
            "admission_timeout_min": self.admission_timeout_min,
            "alone_timeout_sec": self.alone_timeout_sec,
        }


class BotLauncher(Protocol):
    name: str

    def launch(self, spec: BotSpec) -> str:
        """Start a bot for the session. Returns an opaque reference stored on the session."""
        ...

    def stop(self, container_ref: str) -> None:
        """Best-effort hard stop (the graceful path is the control endpoint)."""
        ...

    def is_running(self, container_ref: str) -> bool | None:
        """True/False if known, None if the launcher cannot tell (pool)."""
        ...
