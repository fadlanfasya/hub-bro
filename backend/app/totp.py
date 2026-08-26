"""Time-based one-time passwords (RFC 6238), and their recovery codes.

Implemented on the standard library rather than a dependency. That is not a
"roll your own crypto" decision: TOTP is HMAC-SHA1 over a counter plus a
documented truncation, and the HMAC itself comes from `hmac`. Nothing here
invents a primitive. RFC 6238 publishes test vectors, and test_totp.py checks
this implementation against them — which is a stronger guarantee than trusting
a library nobody in the team has read.

Second factors are opt-in per person. Someone who turns it on gets recovery
codes at the same moment, because the realistic failure is not an attacker: it
is a lost or wiped phone, and without recovery the only remaining door is
another admin. For a workspace with one admin there would be no door at all.
"""
import base64
import hashlib
import hmac
import json
import secrets
import struct
import time
from urllib.parse import quote

DIGITS = 6
PERIOD = 30          # seconds per code, the value every authenticator assumes
DRIFT_STEPS = 1      # accept one step either side, for unsynchronised clocks

RECOVERY_CODE_COUNT = 8
RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"   # no l/1/o/0 to misread


def generate_secret(length: int = 20) -> str:
    """A fresh base32 secret. 20 bytes is what RFC 4226 recommends."""
    return base64.b32encode(secrets.token_bytes(length)).decode("ascii").rstrip("=")


def _counter_code(secret: str, counter: int, digits: int = DIGITS) -> str:
    """One HOTP value — the whole of RFC 4226 in five lines."""
    padding = "=" * (-len(secret) % 8)
    key = base64.b32decode(secret.upper() + padding, casefold=True)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    truncated = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(truncated % (10 ** digits)).zfill(digits)


def code_at(secret: str, at: float | None = None,
            digits: int = DIGITS, period: int = PERIOD) -> str:
    """The code an authenticator would be showing at that moment."""
    moment = time.time() if at is None else at
    return _counter_code(secret, int(moment // period), digits)


def verify(secret: str, code: str, at: float | None = None,
           digits: int = DIGITS, period: int = PERIOD,
           drift: int = DRIFT_STEPS) -> bool:
    """Is this the current code, or one step either side?

    The comparison is constant-time. A timing difference here would leak the
    code digit by digit, which is enough to forge one within its 30 seconds.
    """
    code = (code or "").strip().replace(" ", "")
    if not code.isdigit() or len(code) != digits:
        return False
    moment = time.time() if at is None else at
    counter = int(moment // period)
    return any(hmac.compare_digest(_counter_code(secret, counter + offset, digits), code)
               for offset in range(-drift, drift + 1))


def qr_svg(uri: str) -> str:
    """The provisioning URI as an inline SVG, or "" if it can't be drawn.

    Rendered on the server rather than shipping a QR library to the browser:
    the secret is already here, and this way it never has to be handed to a
    third-party script to be drawn. SVG rather than PNG so it stays sharp and
    needs no image encoder.

    A missing `qrcode` package returns "" instead of raising. The QR is a
    convenience — the secret and the otpauth link are the actual requirement —
    so an optional dependency that isn't installed yet must not take the whole
    enrolment down with an unexplained 500.
    """
    try:
        import io
        import qrcode
        import qrcode.image.svg
    except ImportError:
        return ""

    code = qrcode.QRCode(box_size=10, border=2)
    code.add_data(uri)
    code.make(fit=True)
    buffer = io.BytesIO()
    code.make_image(image_factory=qrcode.image.svg.SvgPathImage).save(buffer)
    return buffer.getvalue().decode("utf-8")


def provisioning_uri(secret: str, account: str, issuer: str = "Hub-Bro") -> str:
    """The otpauth:// URI an authenticator app scans."""
    label = quote(f"{issuer}:{account}", safe="")
    return (f"otpauth://totp/{label}?secret={secret}"
            f"&issuer={quote(issuer, safe='')}&algorithm=SHA1"
            f"&digits={DIGITS}&period={PERIOD}")


# --------------------------------------------------------------------------
# recovery codes
# --------------------------------------------------------------------------

def generate_recovery_codes(count: int = RECOVERY_CODE_COUNT) -> list[str]:
    """Human-typeable single-use codes, shown once and never again."""
    def one():
        raw = "".join(secrets.choice(RECOVERY_ALPHABET) for _ in range(10))
        return f"{raw[:5]}-{raw[5:]}"
    return [one() for _ in range(count)]


def normalise_recovery(code: str) -> str:
    return (code or "").strip().lower().replace(" ", "")


def hash_recovery_codes(codes: list[str]) -> str:
    """Store them hashed. A stolen database must not yield working codes.

    SHA-256 without a slow KDF is right here and wrong for passwords: these are
    50 bits of randomness we generated, not something a person chose, so there
    is nothing for a dictionary attack to work with.
    """
    return json.dumps([hashlib.sha256(normalise_recovery(c).encode()).hexdigest()
                       for c in codes])


def consume_recovery_code(stored: str, code: str) -> tuple[bool, str]:
    """Check a recovery code and burn it. Returns (accepted, new stored value)."""
    try:
        hashes = json.loads(stored or "[]")
    except ValueError:
        return False, stored or "[]"
    candidate = hashlib.sha256(normalise_recovery(code).encode()).hexdigest()
    for i, stored_hash in enumerate(hashes):
        if hmac.compare_digest(stored_hash, candidate):
            remaining = hashes[:i] + hashes[i + 1:]
            return True, json.dumps(remaining)
    return False, stored or "[]"


def recovery_codes_left(stored: str) -> int:
    try:
        return len(json.loads(stored or "[]"))
    except ValueError:
        return 0
