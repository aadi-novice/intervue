"""Symmetric encryption for secrets stored at rest (OAuth refresh/access tokens)."""

import base64
import hashlib
import logging
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

log = logging.getLogger(__name__)


class DecryptionError(Exception):
    pass


@lru_cache
def _fernet() -> Fernet:
    key = settings.token_encryption_key
    if not key:
        if settings.environment == "production":
            raise RuntimeError("TOKEN_ENCRYPTION_KEY must be set in production (Fernet key)")
        log.warning("TOKEN_ENCRYPTION_KEY not set; deriving a dev key (do not use in production)")
        key = base64.urlsafe_b64encode(
            hashlib.sha256(("dev-token-key:" + settings.internal_hmac_secret).encode()).digest()
        ).decode()
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as e:
        raise DecryptionError("Stored secret cannot be decrypted (key rotated?)") from e


def generate_key() -> str:
    """For operators: `python -c "from app.core.crypto import generate_key; print(generate_key())"`."""
    return Fernet.generate_key().decode()
