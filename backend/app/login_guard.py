"""Throttling for the login endpoint.

Without this, a password is only as strong as how fast someone can type — the
endpoint would answer as quickly as the network allows, forever. This makes
guessing expensive without making a forgetful colleague's day miserable.

Two counters, deliberately:

  * per account — stops someone grinding one known email address
  * per client address — stops someone spraying one common password across
    every address they can think of, which no per-account counter would ever
    notice because each account sees only one failure

A lockout is temporary and backs off, never permanent. A permanent lock is a
denial-of-service anyone can trigger against a colleague just by knowing their
email, and it moves the problem to whoever has to unlock it at 3am.

Held in memory on purpose. It resets when the process restarts, which is a real
weakness and an accepted one: the alternative is a write to the database on
every failed password, and the attack this defends against is a burst lasting
seconds, not a campaign spanning restarts. If Hub-Bro is ever exposed to the
public internet, put something in front of it that does this at the edge.
"""
import time
from dataclasses import dataclass, field
from threading import Lock

# Attempts allowed before the first lockout, per counter.
MAX_ATTEMPTS = 5

# Lockout after hitting the limit, doubling on each further failure.
BASE_LOCKOUT_SECONDS = 30
MAX_LOCKOUT_SECONDS = 15 * 60

# Failures older than this stop counting, so yesterday's typo is not held
# against you today.
WINDOW_SECONDS = 15 * 60

# An address may be a whole office behind one NAT, so it gets more room than a
# single account before it is throttled.
IP_MULTIPLIER = 4


@dataclass
class _Counter:
    failures: int = 0
    first_at: float = 0.0
    locked_until: float = 0.0
    lockouts: int = 0


@dataclass
class LoginGuard:
    """Tracks failed logins. All times are seconds from time.monotonic()."""
    max_attempts: int = MAX_ATTEMPTS
    window: float = WINDOW_SECONDS
    _counters: dict = field(default_factory=dict)
    _lock: Lock = field(default_factory=Lock)

    def _now(self) -> float:
        return time.monotonic()

    def _get(self, key, now: float) -> _Counter:
        counter = self._counters.get(key)
        if counter is None:
            counter = _Counter(first_at=now)
            self._counters[key] = counter
        elif counter.locked_until <= now and now - counter.first_at > self.window:
            # the window has passed with no lockout in force — start fresh
            counter.failures, counter.first_at, counter.lockouts = 0, now, 0
        return counter

    def retry_after(self, keys) -> int:
        """Seconds the caller must wait, or 0 when it may proceed."""
        now = self._now()
        with self._lock:
            waits = [self._counters[k].locked_until - now
                     for k in keys if k in self._counters]
        longest = max(waits, default=0)
        return int(longest) + 1 if longest > 0 else 0

    def record_failure(self, key, limit_multiplier: int = 1) -> None:
        now = self._now()
        with self._lock:
            counter = self._get(key, now)
            counter.failures += 1
            allowed = self.max_attempts * limit_multiplier
            if counter.failures >= allowed:
                counter.lockouts += 1
                # 30s, 60s, 120s … capped. Enough to make a script pointless
                # while a person who mistypes twice barely notices.
                wait = min(BASE_LOCKOUT_SECONDS * (2 ** (counter.lockouts - 1)),
                           MAX_LOCKOUT_SECONDS)
                counter.locked_until = now + wait
                counter.failures = 0
                counter.first_at = now

    def record_success(self, keys) -> None:
        """Clear the account's counters once the right password arrives."""
        with self._lock:
            for key in keys:
                self._counters.pop(key, None)

    def forget(self) -> None:
        with self._lock:
            self._counters.clear()

    def prune(self, older_than: float | None = None) -> int:
        """Drop counters nobody is waiting on, so memory can't creep upward."""
        now = self._now()
        cutoff = older_than if older_than is not None else self.window
        with self._lock:
            stale = [k for k, c in self._counters.items()
                     if c.locked_until <= now and now - c.first_at > cutoff]
            for key in stale:
                del self._counters[key]
        return len(stale)


guard = LoginGuard()


def client_ip(request) -> str:
    """The caller's address, honouring a proxy header only when configured.

    Trusting X-Forwarded-For unconditionally would let anyone send a header and
    get a fresh quota per request, which is worse than having no IP counter at
    all — it would look like protection while providing none.
    """
    from .config import settings
    if settings.TRUST_PROXY:
        forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
        if forwarded:
            return forwarded
    return getattr(getattr(request, "client", None), "host", "") or "unknown"
