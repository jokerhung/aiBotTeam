"""Remote access: domain-based requests need a paired browser; localhost and LAN/Tailscale IP requests open directly.

By default the server listens on 127.0.0.1 only and none of this applies. A pairing code is shown on the server's console (and by
`botteam pair`); it is single-use and short-lived, and a session is a random cookie of which only a hash is kept.
"""
from __future__ import annotations

import hashlib
import hmac
import ipaddress
import secrets
import time
from typing import Optional
from urllib.parse import urlsplit

CODE_TTL = 10 * 60
SESSION_TTL = 30 * 24 * 3600
COOKIE = "botteam_session"
OPEN_PATHS = ("/api/auth/pair", "/api/auth/status", "/health")
MAX_TRIES = 8


def _hash(v: str) -> str:
    return hashlib.sha256(v.encode("utf8")).hexdigest()


class Pairing:
    def __init__(self, required: bool) -> None:
        self.required = required
        self.codes: dict[str, float] = {}  # hash -> expires
        self.sessions: dict[str, float] = {}  # hash -> expires
        self.tries: list[float] = []

    def new_code(self) -> str:
        code = f"{secrets.randbelow(10**8):08d}"
        code = f"{code[:4]}-{code[4:]}"
        self.codes[_hash(code)] = time.time() + CODE_TTL
        return code

    def pair(self, code: str) -> Optional[str]:
        """A session token for a valid, unused code; None otherwise. Too many wrong tries in a minute lock it for a while."""
        now = time.time()
        self.tries = [t for t in self.tries if now - t < 60]
        if len(self.tries) >= MAX_TRIES:
            return None
        h = _hash(code.strip())
        exp = next((e for k, e in self.codes.items() if hmac.compare_digest(k, h)), None)
        if exp is None or exp < now:
            self.tries.append(now)
            return None
        self.codes.pop(h, None)  # single use
        token = secrets.token_urlsafe(32)
        self.sessions[_hash(token)] = now + SESSION_TTL
        return token

    def valid(self, token: Optional[str]) -> bool:
        if not token:
            return False
        exp = self.sessions.get(_hash(token))
        return bool(exp and exp > time.time())

    def revoke(self, token: Optional[str]) -> None:
        if token:
            self.sessions.pop(_hash(token), None)


def is_loopback(host: str) -> bool:
    return host in ("127.0.0.1", "localhost", "::1")


DIRECT_NETWORKS = tuple(ipaddress.ip_network(n) for n in (
    "127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
    "169.254.0.0/16", "100.64.0.0/10", "::1/128", "fc00::/7", "fe80::/10",
))


def direct_access_host(authority: str) -> bool:
    """Only localhost and literal LAN/Tailscale addresses bypass browser pairing."""
    try:
        parsed = urlsplit("//" + authority)
        _ = parsed.port  # reject malformed ports as well as malformed hostnames
        if parsed.username is not None or parsed.password is not None or parsed.path or parsed.query or parsed.fragment:
            return False
        host = (parsed.hostname or "").lower().rstrip(".")
        if host == "localhost":
            return True
        address = ipaddress.ip_address(host)
        if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
            address = address.ipv4_mapped
        return any(address.version == network.version and address in network for network in DIRECT_NETWORKS)
    except ValueError:
        return False


def request_needs_pairing(request, enabled: bool) -> bool:
    if not enabled:
        return False
    authority = request.headers.get("host", "")
    forwarded = request.headers.get("x-forwarded-host")
    if forwarded is not None:
        # Only the local web/reverse proxy may state the browser's original host.
        # Run uvicorn with proxy_headers=False to retain the actual TCP peer here.
        if not request.client or not is_loopback(request.client.host):
            return True
        authority = forwarded
    return not direct_access_host(authority)
