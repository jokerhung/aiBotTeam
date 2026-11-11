"""Which addresses the server may fetch for a person: a guard against making it reach into networks it should not (SSRF)."""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlsplit


class BlockedAddress(ValueError):
    pass


def _addresses(host: str, port: int) -> list[ipaddress._BaseAddress]:
    try:
        return [ipaddress.ip_address(host)]
    except ValueError:
        pass
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except OSError as e:
        raise BlockedAddress(f"cannot resolve {host}") from e
    return [ipaddress.ip_address(i[4][0].split("%")[0]) for i in infos]


def check_url(url: str, *, allow_loopback: bool = False, allow_private: bool = False) -> str:
    """The URL when it is safe to fetch; BlockedAddress otherwise. Only http(s); never link-local (cloud metadata) or unspecified
    addresses; loopback and private ranges only when the caller says that is expected (a local MCP server) and never for imports."""
    parts = urlsplit(url.strip())
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise BlockedAddress("only http and https addresses are allowed")
    if parts.username or parts.password:
        raise BlockedAddress("an address with a user name or password is not allowed")
    for ip in _addresses(parts.hostname, parts.port or (443 if parts.scheme == "https" else 80)):
        if ip.is_link_local or ip.is_unspecified or ip.is_multicast or ip.is_reserved:
            raise BlockedAddress(f"{ip} is not a public address")
        if ip.is_loopback and not allow_loopback:
            raise BlockedAddress("loopback addresses are not allowed here")
        if ip.is_private and not ip.is_loopback and not allow_private:
            raise BlockedAddress(f"{ip} is on a private network")
    return url.strip()
