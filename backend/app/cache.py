"""Response cache so several widgets on one data source share a single fetch.

Two backends behind one interface:

  * memory (default) — a dict in this process. Fine for a single worker.
  * redis  (set REDIS_URL) — shared across workers and survives a restart,
    which is what you want when running more than one uvicorn worker.

Redis is optional: if the package or the server is unavailable we log once and
fall back to memory rather than taking the app down over a cache.
"""
import asyncio
import json
import logging
import time
from typing import Any

from .config import settings

log = logging.getLogger("uvicorn.error")

_locks: dict[str, asyncio.Lock] = {}
_locks_guard = asyncio.Lock()

KEY_PREFIX = "hubbro:data:"


def make_key(datasource_id: int, options: dict) -> str:
    return f"{datasource_id}:{json.dumps(options or {}, sort_keys=True, default=str)}"


class MemoryBackend:
    name = "memory"

    def __init__(self):
        self._store: dict[str, tuple[float, Any]] = {}

    def get(self, key):
        entry = self._store.get(key)
        if not entry:
            return None
        expires_at, value = entry
        if time.time() > expires_at:
            self._store.pop(key, None)
            return None
        return value

    def set(self, key, value, ttl):
        self._store[key] = (time.time() + ttl, value)
        if len(self._store) > 500:      # bound memory; drop the soonest to expire
            for k in sorted(self._store, key=lambda k: self._store[k][0])[:100]:
                self._store.pop(k, None)

    def invalidate_prefix(self, prefix):
        for k in [k for k in self._store if k.startswith(prefix)]:
            self._store.pop(k, None)

    def clear(self):
        self._store.clear()


class RedisBackend:
    name = "redis"

    def __init__(self, url):
        import redis  # imported lazily so the dependency stays optional
        self._client = redis.Redis.from_url(url, decode_responses=True,
                                            socket_connect_timeout=2, socket_timeout=2)
        self._client.ping()             # fail here, at startup, not on first request

    def get(self, key):
        try:
            raw = self._client.get(KEY_PREFIX + key)
            return json.loads(raw) if raw else None
        except Exception as e:
            log.warning("Cache read failed (%s) — treating as a miss", e)
            return None

    def set(self, key, value, ttl):
        try:
            self._client.setex(KEY_PREFIX + key, ttl, json.dumps(value, default=str))
        except Exception as e:
            log.warning("Cache write failed (%s) — continuing without caching", e)

    def invalidate_prefix(self, prefix):
        try:
            for k in self._client.scan_iter(match=f"{KEY_PREFIX}{prefix}*", count=200):
                self._client.delete(k)
        except Exception as e:
            log.warning("Cache invalidation failed (%s)", e)

    def clear(self):
        try:
            for k in self._client.scan_iter(match=f"{KEY_PREFIX}*", count=200):
                self._client.delete(k)
        except Exception as e:
            log.warning("Cache clear failed (%s)", e)


def _build_backend():
    url = settings.REDIS_URL
    if not url:
        return MemoryBackend()
    try:
        backend = RedisBackend(url)
        log.info("Cache backend: redis (%s)", url.split("@")[-1])
        return backend
    except ImportError:
        log.warning("REDIS_URL is set but the 'redis' package isn't installed — "
                    "using the in-process cache. Add redis to requirements.txt.")
    except Exception as e:
        log.warning("Could not reach Redis at %s (%s) — using the in-process cache.",
                    url.split("@")[-1], e)
    return MemoryBackend()


_backend = _build_backend()


def backend_name() -> str:
    return _backend.name


def get(key: str):
    if not settings.CACHE_ENABLED:
        return None
    return _backend.get(key)


def set(key: str, value, ttl: int | None = None):
    if not settings.CACHE_ENABLED:
        return
    ttl = settings.CACHE_TTL_SECONDS if ttl is None else ttl
    if ttl <= 0:
        return
    _backend.set(key, value, ttl)


def invalidate_datasource(datasource_id: int):
    _backend.invalidate_prefix(f"{datasource_id}:")


def clear():
    """Drop everything — used by tests."""
    _backend.clear()


async def lock_for(key: str) -> asyncio.Lock:
    """One lock per key so concurrent widgets don't stampede the same source.

    Process-local: with several workers each may still fetch once, which is a
    far smaller problem than every widget fetching independently.
    """
    async with _locks_guard:
        if key not in _locks:
            _locks[key] = asyncio.Lock()
        return _locks[key]
