"""Login throttling, written as attempted break-ins.

Run: python tests/test_login_guard.py

The cases that matter are not "does it block" — that part is easy. They are the
ones where a control that looks protective isn't: a spray attack that no
per-account counter would see, a proxy header that hands out fresh quota, and a
lockout that a stranger can trigger against a colleague forever.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("SECRET_KEY", "unit-test-secret-key")
os.environ["DATABASE_URL"] = "sqlite://"

from app.login_guard import (  # noqa: E402
    BASE_LOCKOUT_SECONDS, IP_MULTIPLIER, MAX_ATTEMPTS, MAX_LOCKOUT_SECONDS,
    LoginGuard, client_ip,
)

passed = failed = 0


def check(label, actual, expected):
    global passed, failed
    if actual == expected:
        passed += 1
        print(f"  PASS  {label}")
    else:
        failed += 1
        print(f"  FAIL  {label}\n        expected {expected!r}, got {actual!r}")


class FakeClock(LoginGuard):
    """A guard whose clock we control, so no test ever sleeps."""
    def __init__(self, **kw):
        super().__init__(**kw)
        self.t = 1000.0

    def _now(self):
        return self.t

    def tick(self, seconds):
        self.t += seconds


ACC = ("user", "alice@x.com")
IP = ("ip", "10.1.6.9")

print("a wrong password is allowed a few times")
g = FakeClock()
for i in range(MAX_ATTEMPTS - 1):
    g.record_failure(ACC)
check(f"{MAX_ATTEMPTS - 1} failures still let you try", g.retry_after([ACC]), 0)

g.record_failure(ACC)
check("the next one locks", g.retry_after([ACC]) > 0, True)
check("for about the base wait", g.retry_after([ACC]) <= BASE_LOCKOUT_SECONDS + 1, True)

print("the lock lifts by itself")
g.tick(BASE_LOCKOUT_SECONDS + 1)
check("no unlocking by hand", g.retry_after([ACC]), 0)

print("keeping it up costs more each time")
waits = []
for _ in range(4):
    for _ in range(MAX_ATTEMPTS):
        g.record_failure(ACC)
    waits.append(g.retry_after([ACC]))
    g.tick(waits[-1] + 1)
check("each lockout is longer than the last", waits == sorted(waits) and waits[0] < waits[-1], True)
check("but it stops growing", waits[-1] <= MAX_LOCKOUT_SECONDS + 1, True)

print("a correct password clears the slate")
g = FakeClock()
for _ in range(MAX_ATTEMPTS - 1):
    g.record_failure(ACC)
g.record_success([ACC, IP])
for _ in range(MAX_ATTEMPTS - 1):
    g.record_failure(ACC)
check("earlier failures aren't held against you", g.retry_after([ACC]), 0)

print("yesterday's typo doesn't count today")
g = FakeClock(window=60)
for _ in range(MAX_ATTEMPTS - 1):
    g.record_failure(ACC)
g.tick(120)
g.record_failure(ACC)
check("the window resets", g.retry_after([ACC]), 0)

print("spraying one password across many accounts")
# No per-account counter would ever see this: each address fails once. This is
# the case the IP counter exists for.
g = FakeClock()
for i in range(MAX_ATTEMPTS * IP_MULTIPLIER):
    g.record_failure(("user", f"victim{i}@x.com"))
    g.record_failure(IP, IP_MULTIPLIER)
check("no single account is locked",
      g.retry_after([("user", "victim0@x.com")]), 0)
check("but the source is", g.retry_after([IP]) > 0, True)

print("one office behind one address")
g = FakeClock()
for _ in range(MAX_ATTEMPTS):
    g.record_failure(IP, IP_MULTIPLIER)
check("a colleague's fumble doesn't lock the whole building",
      g.retry_after([IP]), 0)

print("a lock is a delay, never a wall")
g = FakeClock()
for _ in range(MAX_ATTEMPTS * 20):
    g.record_failure(ACC)
check("even sustained abuse tops out", g.retry_after([ACC]) <= MAX_LOCKOUT_SECONDS + 1, True)
g.tick(MAX_LOCKOUT_SECONDS + 1)
check("and the real owner can always get back in", g.retry_after([ACC]), 0)

print("accounts are independent")
g = FakeClock()
for _ in range(MAX_ATTEMPTS):
    g.record_failure(ACC)
check("locking Alice leaves Bob alone", g.retry_after([("user", "bob@x.com")]), 0)

print("memory cannot creep upward")
g = FakeClock(window=60)
for i in range(500):
    g.record_failure(("user", f"noise{i}@x.com"))
g.tick(3600)
removed = g.prune()
check("stale counters are dropped", removed, 500)
check("nothing is left", len(g._counters), 0)

for _ in range(MAX_ATTEMPTS):
    g.record_failure(ACC)
check("but a live lockout is not pruned away", g.prune(), 0)

print("the proxy header is only trusted when configured")


class FakeRequest:
    def __init__(self, header=None, host="10.9.9.9"):
        self.headers = {"x-forwarded-for": header} if header else {}
        self.client = type("C", (), {"host": host})()


from app.config import settings  # noqa: E402

settings.TRUST_PROXY = False
check("a spoofed header is ignored by default",
      client_ip(FakeRequest("1.2.3.4")), "10.9.9.9")
settings.TRUST_PROXY = True
check("and used when the deployment says so",
      client_ip(FakeRequest("1.2.3.4")), "1.2.3.4")
check("the first hop is the client",
      client_ip(FakeRequest("1.2.3.4, 10.0.0.1")), "1.2.3.4")
check("a missing header still falls back",
      client_ip(FakeRequest(None)), "10.9.9.9")
settings.TRUST_PROXY = False

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
