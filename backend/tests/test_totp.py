"""TOTP against the RFC's own test vectors, plus the cases that bite.

Run: python tests/test_totp.py

The vectors matter more than anything else here. An implementation that is
subtly wrong still produces six plausible digits, and the only way that shows
up is a colleague who cannot sign in and an authenticator app that looks fine.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("SECRET_KEY", "unit-test-secret-key")
os.environ["DATABASE_URL"] = "sqlite://"

from app import totp  # noqa: E402

passed = failed = 0


def check(label, actual, expected):
    global passed, failed
    if actual == expected:
        passed += 1
        print(f"  PASS  {label}")
    else:
        failed += 1
        print(f"  FAIL  {label}\n        expected {expected!r}, got {actual!r}")


print("RFC 6238 test vectors")
# Appendix B. The seed is the ASCII "12345678901234567890", base32 encoded.
import base64  # noqa: E402
SEED = base64.b32encode(b"12345678901234567890").decode().rstrip("=")
for moment, expected in [
    (59, "287082"),
    (1111111109, "081804"),
    (1111111111, "050471"),
    (1234567890, "005924"),
    (2000000000, "279037"),
    (20000000000, "353130"),
]:
    check(f"t={moment} -> {expected}", totp.code_at(SEED, at=moment, digits=6), expected)

print("RFC 4226 vectors, the HOTP counters underneath")
for counter, expected in enumerate(["755224", "287082", "359152", "969429", "338314"]):
    check(f"counter {counter}", totp._counter_code(SEED, counter), expected)

print("verifying")
secret = totp.generate_secret()
now = 1_700_000_000
check("the current code is accepted",
      totp.verify(secret, totp.code_at(secret, at=now), at=now), True)
check("a wrong code is not", totp.verify(secret, "000000", at=now - 10**6), False)

print("clocks are never perfectly in step")
check("one step behind is accepted",
      totp.verify(secret, totp.code_at(secret, at=now - 30), at=now), True)
check("one step ahead is accepted",
      totp.verify(secret, totp.code_at(secret, at=now + 30), at=now), True)
check("two steps behind is not",
      totp.verify(secret, totp.code_at(secret, at=now - 60), at=now), False)
check("two steps ahead is not",
      totp.verify(secret, totp.code_at(secret, at=now + 60), at=now), False)

print("a code lasts its period and no longer")
# Measured from the start of a window: 1_700_000_000 is 20 seconds into one, so
# "+29" from there is already the next code — which is correct behaviour and a
# careless assertion.
window_start = (now // totp.PERIOD) * totp.PERIOD
same = totp.code_at(secret, at=window_start)
check("still the same 29 seconds in",
      totp.code_at(secret, at=window_start + 29), same)
check("different one second later",
      totp.code_at(secret, at=window_start + 30) != same, True)

print("input people actually type")
code = totp.code_at(secret, at=now)
check("spaces are tolerated",
      totp.verify(secret, f"{code[:3]} {code[3:]}", at=now), True)
check("surrounding whitespace too", totp.verify(secret, f"  {code}  ", at=now), True)
check("letters are refused", totp.verify(secret, "12345a", at=now), False)
check("too short is refused", totp.verify(secret, code[:5], at=now), False)
check("too long is refused", totp.verify(secret, code + "0", at=now), False)
check("empty is refused", totp.verify(secret, "", at=now), False)
check("None is refused", totp.verify(secret, None, at=now), False)

print("secrets")
check("base32 and no padding", set(totp.generate_secret()) <= set(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"), True)
check("two secrets differ", totp.generate_secret() != totp.generate_secret(), True)
check("a secret works in an authenticator's format",
      len(totp.generate_secret()) >= 32, True)

print("the QR payload")
uri = totp.provisioning_uri("ABC234", "alice@peruri.co.id")
check("is an otpauth URI", uri.startswith("otpauth://totp/"), True)
check("carries the secret", "secret=ABC234" in uri, True)
check("names the issuer", "issuer=Hub-Bro" in uri, True)
check("escapes the @ in the label", "alice%40peruri.co.id" in uri, True)
check("states the period", "period=30" in uri, True)

print("recovery codes")
codes = totp.generate_recovery_codes()
check("there are eight", len(codes), 8)
check("all different", len(set(codes)), 8)
check("shaped for typing", all(len(c) == 11 and c[5] == "-" for c in codes), True)
check("no characters that read alike",
      any(ch in "".join(codes) for ch in "l1o0"), False)

stored = totp.hash_recovery_codes(codes)
check("stored hashed, never in the clear", codes[0] in stored, False)
check("all eight are counted", totp.recovery_codes_left(stored), 8)

ok, stored = totp.consume_recovery_code(stored, codes[0])
check("a real code is accepted", ok, True)
check("and is used up", totp.recovery_codes_left(stored), 7)

ok, stored = totp.consume_recovery_code(stored, codes[0])
check("the same code cannot be used twice", ok, False)
check("and nothing else was consumed", totp.recovery_codes_left(stored), 7)

ok, _ = totp.consume_recovery_code(stored, "aaaaa-bbbbb")
check("an invented code is refused", ok, False)

ok, stored = totp.consume_recovery_code(stored, codes[3].upper())
check("case and spacing are forgiven", ok, True)

check("an empty store refuses everything",
      totp.consume_recovery_code("[]", codes[1])[0], False)
check("so does a corrupted one",
      totp.consume_recovery_code("not json", codes[1])[0], False)
check("and it doesn't crash counting them", totp.recovery_codes_left("not json"), 0)

print("the QR is a convenience, not a requirement")
# An optional dependency that isn't installed must not take enrolment down.
import builtins  # noqa: E402
_real_import = builtins.__import__


def _no_qrcode(name, *a, **k):
    if name.startswith("qrcode"):
        raise ModuleNotFoundError("No module named 'qrcode'")
    return _real_import(name, *a, **k)


builtins.__import__ = _no_qrcode
try:
    check("a missing qrcode package returns empty, never raises",
          totp.qr_svg("otpauth://totp/x"), "")
finally:
    builtins.__import__ = _real_import

svg = totp.qr_svg("otpauth://totp/Hub-Bro:a@x.com?secret=ABC234")
check("and draws a real code when it is installed", len(svg) > 1000, True)
check("as SVG", svg.lstrip().startswith("<?xml"), True)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
