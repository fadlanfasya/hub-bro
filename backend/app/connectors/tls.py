"""Whether to verify TLS certificates for a given URL.

Asking people to tick a "verify SSL" box gets the wrong answer twice: they
untick it for an internal host with a self-signed certificate, then leave it
unticked for a public API, and nobody notices. The box is also meaningless to
anyone who does not already know what it does.

So it is decided from the address instead. Private networks routinely use
self-signed or internal-CA certificates, and an attacker on your own LAN who
can intercept 10.1.6.51 already has bigger openings. Anything reachable from
the public internet gets verified, because there the certificate is the only
thing proving you are talking to the right server.

An explicit `verify_ssl` in the config still wins, so data sources saved before
this existed keep behaving exactly as they did.
"""
import ipaddress
from urllib.parse import urlparse

# Hostnames that are always local, regardless of what they resolve to.
_LOCAL_SUFFIXES = (".local", ".internal", ".lan", ".home", ".corp", ".test")
_LOCAL_NAMES = ("localhost",)


def is_private_host(url: str) -> bool:
    """True for loopback, RFC1918 addresses, and internal-looking hostnames."""
    try:
        host = (urlparse(url or "").hostname or "").strip().lower()
    except ValueError:
        return False
    if not host:
        return False
    if host in _LOCAL_NAMES or host.endswith(_LOCAL_SUFFIXES):
        return True
    # a bare hostname with no dots is a LAN name, not a public domain
    if "." not in host:
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False        # a real domain name — verify it
    return ip.is_private or ip.is_loopback or ip.is_link_local


def verify_for(url: str, config: dict | None = None) -> bool:
    """Verification setting for httpx.

    Explicit config wins; otherwise public hosts are verified and private ones
    are not.
    """
    if config is not None and "verify_ssl" in config:
        return bool(config["verify_ssl"])
    return not is_private_host(url)
