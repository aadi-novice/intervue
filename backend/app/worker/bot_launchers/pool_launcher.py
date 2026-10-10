"""Render / fixed-fleet launcher: push the session onto a Redis queue that bot workers BLPOP."""

import json

import redis

from app.core.config import settings
from app.worker.bot_launchers.base import BotSpec


class PoolLauncher:
    name = "pool"

    def _redis(self):
        return redis.Redis.from_url(settings.redis_url)

    def launch(self, spec: BotSpec) -> str:
        self._redis().rpush(settings.bot_queue_name, json.dumps(spec.queue_payload()))
        return f"pool:{spec.session_id}"

    def stop(self, container_ref: str) -> None:
        # Pool workers only stop through the control endpoint.
        return None

    def is_running(self, container_ref: str) -> bool | None:
        return None
