"""Cache backend tests — memory always, Redis when one is reachable.

Run: python tests/test_cache.py
"""
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("SECRET_KEY", "cache-test-key")

from app.cache import MemoryBackend, make_key  # noqa: E402

passed = failed = skipped = 0


def check(label, actual, expected):
    global passed, failed
    if actual == expected:
        passed += 1
        print(f"  PASS  {label}")
    else:
        failed += 1
        print(f"  FAIL  {label}\n        expected {expected!r}\n        got      {actual!r}")


def run_backend_suite(backend, name):
    print(f"{name} backend")
    backend.clear()

    backend.set("1:a", {"rows": [1, 2, 3]}, 60)
    check(f"[{name}] stores and reads back", backend.get("1:a"), {"rows": [1, 2, 3]})
    check(f"[{name}] misses on an unknown key", backend.get("nope"), None)

    backend.set("1:b", {"x": 1}, 60)
    backend.set("2:a", {"x": 2}, 60)
    backend.invalidate_prefix("1:")
    check(f"[{name}] invalidating a source clears its keys", backend.get("1:a"), None)
    check(f"[{name}] ...and its other keys", backend.get("1:b"), None)
    check(f"[{name}] ...but leaves other sources alone", backend.get("2:a"), {"x": 2})

    backend.set("ttl:key", {"v": 1}, 1)
    check(f"[{name}] value is present before expiry", backend.get("ttl:key"), {"v": 1})
    time.sleep(1.2)
    check(f"[{name}] value is gone after the TTL", backend.get("ttl:key"), None)

    backend.set("types", {"a": None, "b": True, "c": 1.5, "d": "x"}, 60)
    check(f"[{name}] round-trips JSON types",
          backend.get("types"), {"a": None, "b": True, "c": 1.5, "d": "x"})

    backend.clear()
    check(f"[{name}] clear empties the cache", backend.get("2:a"), None)


print("cache keys")
check("same options produce the same key",
      make_key(1, {"a": 1, "b": 2}), make_key(1, {"b": 2, "a": 1}))
check("different options differ",
      make_key(1, {"a": 1}) == make_key(1, {"a": 2}), False)
check("different sources differ",
      make_key(1, {"a": 1}) == make_key(2, {"a": 1}), False)
check("empty and missing options match", make_key(1, {}), make_key(1, None))

run_backend_suite(MemoryBackend(), "memory")

print("memory backend bounds")
mem = MemoryBackend()
for i in range(600):
    mem.set(f"k{i}", {"i": i}, 60)
check("evicts to stay under the size cap", len(mem._store) <= 550, True)

# --- Redis backend ---
# Prefer a real server via REDIS_URL. Otherwise fall back to fakeredis, which
# speaks the same protocol, so the RedisBackend code path is still exercised.
from app.cache import RedisBackend  # noqa: E402

redis_url = os.environ.get("REDIS_URL", "")
redis_backend = None

if redis_url:
    try:
        redis_backend = RedisBackend(redis_url)
        label = "redis"
    except Exception as e:
        print(f"  note: could not connect to {redis_url} ({e}) — trying fakeredis")

if redis_backend is None:
    try:
        import fakeredis
        import redis as redis_module

        real_from_url = redis_module.Redis.from_url
        redis_module.Redis.from_url = staticmethod(
            lambda url, **kw: fakeredis.FakeRedis(decode_responses=kw.get("decode_responses", False))
        )
        redis_backend = RedisBackend("redis://fake")
        redis_module.Redis.from_url = real_from_url
        label = "redis (fakeredis)"
    except ImportError:
        skipped += 1
        print("redis backend\n  SKIP  install fakeredis or set REDIS_URL to test this backend")

if redis_backend is not None:
    run_backend_suite(redis_backend, label)

    print("redis resilience")
    class BrokenClient:
        def get(self, *a, **k): raise ConnectionError("redis is down")
        def setex(self, *a, **k): raise ConnectionError("redis is down")
        def scan_iter(self, *a, **k): raise ConnectionError("redis is down")

    broken = RedisBackend.__new__(RedisBackend)
    broken._client = BrokenClient()
    # a cache outage must degrade to "no caching", never take a request down
    check("[redis] read failure is treated as a miss", broken.get("k"), None)
    try:
        broken.set("k", {"v": 1}, 60)
        broken.invalidate_prefix("1:")
        passed += 1
        print("  PASS  [redis] write and invalidate failures don't raise")
    except Exception as e:
        failed += 1
        print(f"  FAIL  [redis] failure escaped: {e}")

print(f"\n{passed} passed, {failed} failed, {skipped} skipped")
sys.exit(1 if failed else 0)
