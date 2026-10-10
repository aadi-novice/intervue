"""Password hashing, JWT access tokens, opaque refresh tokens, CSRF and signing helpers."""

import hashlib
import hmac
import logging
import secrets
import time
from datetime import UTC, datetime, timedelta
from functools import lru_cache

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pwdlib import PasswordHash

from app.core.config import settings

log = logging.getLogger(__name__)

_hasher = PasswordHash.recommended()  # argon2


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        return False
    try:
        return _hasher.verify(password, password_hash)
    except Exception:
        return False


# ── JWT (asymmetric) ──────────────────────────────────────────────────────────
@lru_cache
def _keys() -> tuple[str, str]:
    if settings.jwt_private_key and settings.jwt_public_key:
        return (
            settings.jwt_private_key.replace("\\n", "\n"),
            settings.jwt_public_key.replace("\\n", "\n"),
        )
    if settings.environment == "production":
        raise RuntimeError("JWT_PRIVATE_KEY / JWT_PUBLIC_KEY must be set in production")
    log.warning("Using ephemeral JWT keypair (dev only): sessions die on restart")
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    public = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode()
    return private, public


def create_access_token(user_id: int) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_access_ttl_minutes),
        "typ": "access",
    }
    return jwt.encode(payload, _keys()[0], algorithm="RS256")


def decode_access_token(token: str) -> int | None:
    try:
        data = jwt.decode(token, _keys()[1], algorithms=["RS256"])
    except jwt.PyJWTError:
        return None
    if data.get("typ") != "access":
        return None
    try:
        return int(data["sub"])
    except (KeyError, ValueError):
        return None


# ── Refresh tokens / CSRF ─────────────────────────────────────────────────────
def new_opaque_token() -> str:
    return secrets.token_urlsafe(48)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def csrf_matches(cookie_value: str | None, header_value: str | None) -> bool:
    return bool(cookie_value) and bool(header_value) and hmac.compare_digest(
        cookie_value, header_value
    )


# ── Signed one-time tokens (email verification, password reset, oauth state) ──
def _serializer(salt: str) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.internal_hmac_secret, salt=salt)


def make_signed_token(payload: dict, salt: str) -> str:
    return _serializer(salt).dumps(payload)


def read_signed_token(token: str, salt: str, max_age_seconds: int) -> dict | None:
    try:
        return _serializer(salt).loads(token, max_age=max_age_seconds)
    except (BadSignature, SignatureExpired):
        return None


# ── Internal HMAC (bots / transcriber callbacks) ──────────────────────────────
def sign_body(secret: str, body: bytes, timestamp: str | None = None) -> str:
    """Signature = hex(hmac_sha256(secret, "<timestamp>." + body))."""
    msg = f"{timestamp}.".encode() + body if timestamp is not None else body
    return hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()


def verify_signature(
    secret: str, body: bytes, timestamp: str | None, signature: str | None, max_skew: int = 300
) -> bool:
    if not timestamp or not signature:
        return False
    try:
        if abs(time.time() - int(timestamp)) > max_skew:
            return False
    except ValueError:
        return False
    return hmac.compare_digest(sign_body(secret, body, timestamp), signature)


def derive_bot_secret(session_id: int) -> str:
    """Per-session callback secret so one bot container cannot forge another session's events."""
    return hmac.new(
        settings.internal_hmac_secret.encode(), f"bot-session:{session_id}".encode(), hashlib.sha256
    ).hexdigest()
