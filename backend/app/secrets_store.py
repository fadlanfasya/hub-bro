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


def merge_masked(existing: dict, incoming: dict) -> dict:
    """When saving, keep the stored secret wherever the client sent back the mask.

    Lets the edit form round-trip without ever handling the real value.
    """
    merged = dict(incoming or {})
    for key in SECRET_FIELDS:
        if merged.get(key) == MASK:
            merged[key] = (existing or {}).get(key, "")
    for key in SECRET_DICT_FIELDS:
        if isinstance(merged.get(key), dict):
            old = (existing or {}).get(key) or {}
            merged[key] = {k: (old.get(k, "") if v == MASK else v) for k, v in merged[key].items()}
    return merged
