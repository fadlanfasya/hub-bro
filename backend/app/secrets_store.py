"""Encryption for credentials stored in data source configs.

Values are encrypted with Fernet (AES-128-CBC + HMAC) using a key derived from
SECRET_KEY, and stored with an "enc:v1:" prefix so plaintext rows written by
older versions keep working and are upgraded on the next save.

Rotating SECRET_KEY makes existing secrets undecryptable — they read back as
empty and the source needs its credentials re-entered.
"""
import base64
import hashlib
import logging

from cryptography.fernet import Fernet, InvalidToken

from .config import settings

PREFIX = "enc:v1:"
MASK = "••••••••"

# Config keys treated as secret: encrypted at rest, masked in API responses.
SECRET_FIELDS = {"user_token", "app_token", "password", "token", "api_key"}
# Header values are secrets too (Authorization, App-Token, …)
SECRET_DICT_FIELDS = {"headers"}

log = logging.getLogger("uvicorn.error")


def _fernet() -> Fernet:
    digest = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(value: str) -> str:
    if not value or not isinstance(value, str) or value.startswith(PREFIX):
        return value
    return PREFIX + _fernet().encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    if not isinstance(value, str) or not value.startswith(PREFIX):
        return value  # legacy plaintext, or not a secret
    try:
        return _fernet().decrypt(value[len(PREFIX):].encode()).decode()
    except (InvalidToken, ValueError):
        log.warning("Could not decrypt a stored credential — SECRET_KEY may have changed. "
                    "Re-enter the credentials for that data source.")
        return ""


def _walk(config: dict, fn) -> dict:
    out = dict(config or {})
    for key in SECRET_FIELDS:
        if key in out and isinstance(out[key], str):
            out[key] = fn(out[key])
    for key in SECRET_DICT_FIELDS:
        if isinstance(out.get(key), dict):
            out[key] = {k: fn(v) if isinstance(v, str) else v for k, v in out[key].items()}
    return out


def encrypt_config(config: dict) -> dict:
    """Encrypt secret fields before writing to the database."""
    return _walk(config, encrypt)


def decrypt_config(config: dict) -> dict:
    """Decrypt secret fields for use by a connector."""
    return _walk(config, decrypt)


def mask_config(config: dict) -> dict:
    """Replace secrets with a mask for API responses — the UI never sees them."""
    return _walk(config, lambda v: MASK if v else v)


# Sending this as a secret's value deliberately clears it. Anything else that
# is blank is treated as "no change".
CLEAR = "__clear__"


def _resolve_secret(incoming_value, stored_value):
    """Decide what a saved secret should end up as.

    An empty value means "leave it alone", never "delete it". Blanking a stored
    credential by accident is far more likely than wanting to remove one — a
    half-finished edit, a form that didn't prefill, a field the user opened and
    closed — and the failure is silent until a dashboard stops loading. Clearing
    therefore has to be explicit.
    """
    if incoming_value == CLEAR:
        return ""
    if incoming_value == MASK:
        return stored_value
    if incoming_value is None or incoming_value == "":
        return stored_value
    return incoming_value


def merge_masked(existing: dict, incoming: dict) -> dict:
    """When saving, work out which secrets to keep and which to replace.

    Lets the edit form round-trip without ever handling the real value.
    """
    merged = dict(incoming or {})
    stored = existing or {}

    for key in SECRET_FIELDS:
        # a key that is absent entirely must not drop the stored secret either
        if key not in merged and key in stored:
            merged[key] = stored[key]
            continue
        if key in merged:
            merged[key] = _resolve_secret(merged[key], stored.get(key, ""))

    for key in SECRET_DICT_FIELDS:
        if isinstance(merged.get(key), dict):
            old = stored.get(key) or {}
            merged[key] = {
                k: _resolve_secret(v, old.get(k, "")) for k, v in merged[key].items()
            }
    return merged
