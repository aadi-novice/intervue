"""Sliding-window rate limiter. Redis-backed when reachable, in-process otherwise."""

import time
from collections import defaultdict, deque

from app.core.config import settings

_local: dict[str, deque] = defaultdict(deque)
_redis = None
_redis_failed = False


def _get_redis():
    global _redis, _redis_failed
    if _redis_failed or settings.environment == "test":
        return None
    if _redis is None:
        try:
            import redis

            _redis = redis.Redis.from_url(settings.redis_url, socket_connect_timeout=0.3)
            _redis.ping()
        except Exception:
            _redis_failed = True
            return None
    return _redis


def hit(key: str, limit: int, window_seconds: int) -> bool:
    """Record a hit; return True if still within the limit."""
    r = _get_redis()
    if r is not None:
        try:
            k = f"rl:{key}:{int(time.time() // window_seconds)}"
            n = r.incr(k)
            if n == 1:
                r.expire(k, window_seconds)
            return n <= limit
        except Exception:
            pass
    now = time.monotonic()
    q = _local[key]
    while q and now - q[0] > window_seconds:
        q.popleft()
    q.append(now)
    return len(q) <= limit


def reset() -> None:
    _local.clear()
