"""
Outbound-URL safety for features that call user-supplied URLs (webhooks).

Blocks loopback / private / link-local / metadata / multicast addresses, credentials in URLs and
non-http(s) schemes. DNS is resolved here and every returned address must be globally routable.
Redirects are never followed by callers. Note: a hostile DNS server could still change its answer
between this check and the connection (rebinding); delivery therefore re-validates right before
each request and never follows redirects, which narrows but does not fully close that window.
"""

import ipaddress
import socket
from urllib.parse import urlparse

from app.core.config import settings
from app.core.errors import Invalid

BLOCKED_SUFFIXES = (".local", ".localhost", ".internal", ".lan", ".home", ".corp", ".intranet")
BLOCKED_HOSTS = {"localhost", "metadata.google.internal", "metadata"}


def _resolve(host: str, port: int) -> list[str]:
    try:
        return sorted({ai[4][0] for ai in socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)})
    except socket.gaierror as e:
        raise Invalid(f"Cannot resolve host: {host}", "unresolvable_host") from e


def _is_public(ip: str) -> bool:
    addr = ipaddress.ip_address(ip.split("%")[0])
    if getattr(addr, "ipv4_mapped", None):  # ::ffff:127.0.0.1
        addr = addr.ipv4_mapped
    return addr.is_global and not addr.is_multicast


def validate_outbound_url(url: str, *, allowed_hosts: set[str] | None = None) -> str:
    """Return the normalised URL or raise `Invalid` (code `unsafe_url`)."""
    try:
        u = urlparse(url.strip())
        host, port = (u.hostname or "").lower(), u.port
    except ValueError:
        raise Invalid("Invalid URL", "unsafe_url")
    if u.scheme not in ("http", "https") or not host:
        raise Invalid("URL must start with https://", "unsafe_url")
    if u.scheme == "http" and not settings.webhook_allow_insecure:
        raise Invalid("Webhook URLs must use https", "unsafe_url")
    if u.username or u.password:
        raise Invalid("Credentials in URLs are not allowed", "unsafe_url")
    if allowed_hosts is not None and host not in allowed_hosts:
        raise Invalid("Host is not allowed for this integration", "unsafe_url")
    if settings.webhook_allow_private:  # local development only
        return u.geturl()
    if host in BLOCKED_HOSTS or host.endswith(BLOCKED_SUFFIXES):
        raise Invalid("That host is not reachable from the public internet", "unsafe_url")
    try:  # literal IP in the URL
        ips = [str(ipaddress.ip_address(host.strip("[]")))]
    except ValueError:
        ips = _resolve(host, port or (443 if u.scheme == "https" else 80))
    if not ips or not all(_is_public(ip) for ip in ips):
        raise Invalid("That address is private or reserved and cannot be used", "unsafe_url")
    return u.geturl()
