"""Authentication: registration, login, refresh rotation, verification, password reset."""

import re
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.core import email as mailer
from app.core import rate_limit, security
from app.core.config import settings
from app.models.tenancy import OAuthAccount, RefreshToken, User

VERIFY_SALT = "email-verify"
RESET_SALT = "password-reset"


class AuthError(Exception):
    def __init__(self, status: int, detail: str, code: str):
        self.status, self.detail, self.code = status, detail, code


def _norm(email: str) -> str:
    return email.strip().lower()


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def validate_password(password: str) -> None:
    if len(password) < 10 or not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        raise AuthError(422, "Password must be 10+ characters with letters and digits", "weak_password")


def send_verification_email(user: User) -> None:
    token = security.make_signed_token({"uid": user.id}, VERIFY_SALT)
    link = f"{settings.frontend_url}/verify-email?token={token}"
    mailer.send_email(user.email, "Verify your Intervue email", f"Confirm your email: {link}")


def register(db: Session, email: str, password: str, full_name: str) -> User:
    email = _norm(email)
    validate_password(password)
    if db.query(User).filter(User.email == email).first():
        raise AuthError(409, "Email already registered", "email_taken")
    user = User(email=email, password_hash=security.hash_password(password), full_name=full_name)
    db.add(user)
    db.commit()
    db.refresh(user)
    send_verification_email(user)
    return user


def verify_email(db: Session, token: str) -> User:
    data = security.read_signed_token(token, VERIFY_SALT, 60 * 60 * 24 * 3)
    user = db.get(User, data["uid"]) if data else None
    if user is None:
        raise AuthError(400, "Invalid or expired token", "invalid_token")
    if user.email_verified_at is None:
        user.email_verified_at = _now()
        db.commit()
    return user


def authenticate(db: Session, email: str, password: str, ip: str | None) -> User:
    email = _norm(email)
    # rate limit per IP and per email (10 / 5 min each)
    ok_ip = rate_limit.hit(f"login:ip:{ip}", 10, 300)
    ok_email = rate_limit.hit(f"login:email:{email}", 10, 300)
    if not (ok_ip and ok_email):
        raise AuthError(429, "Too many login attempts, try again later", "rate_limited")
    user = db.query(User).filter(User.email == email).first()
    if user is None or not security.verify_password(password, user.password_hash):
        raise AuthError(401, "Invalid email or password", "invalid_credentials")
    user.last_login_at = _now()
    db.commit()
    return user


def issue_session(
    db: Session, user: User, user_agent: str | None, ip: str | None
) -> tuple[str, str]:
    """Create access JWT + rotating refresh token. Returns (access, refresh)."""
    refresh = security.new_opaque_token()
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=security.hash_token(refresh),
            expires_at=_now() + timedelta(days=settings.jwt_refresh_ttl_days),
            user_agent=(user_agent or "")[:500],
            ip=ip,
        )
    )
    db.commit()
    return security.create_access_token(user.id), refresh


def rotate_refresh(
    db: Session, refresh: str, user_agent: str | None, ip: str | None
) -> tuple[User, str, str]:
    row = (
        db.query(RefreshToken)
        .filter(RefreshToken.token_hash == security.hash_token(refresh))
        .first()
    )
    if row is None:
        raise AuthError(401, "Invalid refresh token", "invalid_token")
    if row.revoked_at is not None:
        # Reuse of a rotated token => assume theft, revoke the whole family for this user.
        now = _now()
        for t in db.query(RefreshToken).filter(
            RefreshToken.user_id == row.user_id, RefreshToken.revoked_at.is_(None)
        ):
            t.revoked_at = now
        db.commit()
        raise AuthError(401, "Refresh token reuse detected", "token_reuse")
    if _aware(row.expires_at) < _now():
        raise AuthError(401, "Refresh token expired", "invalid_token")
    row.revoked_at = _now()
    user = db.get(User, row.user_id)
    db.commit()
    access, new_refresh = issue_session(db, user, user_agent, ip)
    return user, access, new_refresh


def revoke_refresh(db: Session, refresh: str | None) -> None:
    if not refresh:
        return
    row = (
        db.query(RefreshToken)
        .filter(RefreshToken.token_hash == security.hash_token(refresh))
        .first()
    )
    if row and row.revoked_at is None:
        row.revoked_at = _now()
        db.commit()


def request_password_reset(db: Session, email: str) -> None:
    """Always succeeds silently (no account enumeration)."""
    user = db.query(User).filter(User.email == _norm(email)).first()
    if user is None:
        return
    token = security.make_signed_token(
        {"uid": user.id, "pw": (user.password_hash or "")[-12:]}, RESET_SALT
    )
    link = f"{settings.frontend_url}/reset-password?token={token}"
    mailer.send_email(user.email, "Reset your Intervue password", f"Reset your password: {link}")


def reset_password(db: Session, token: str, new_password: str) -> None:
    validate_password(new_password)
    data = security.read_signed_token(token, RESET_SALT, 60 * 60)
    user = db.get(User, data["uid"]) if data else None
    # token is bound to the current password hash => single use
    if user is None or (user.password_hash or "")[-12:] != data["pw"]:
        raise AuthError(400, "Invalid or expired token", "invalid_token")
    user.password_hash = security.hash_password(new_password)
    now = _now()
    for t in db.query(RefreshToken).filter(
        RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None)
    ):
        t.revoked_at = now
    db.commit()


def login_or_create_oauth_user(
    db: Session, provider: str, provider_user_id: str, email: str, full_name: str, avatar: str | None
) -> User:
    link = (
        db.query(OAuthAccount)
        .filter(OAuthAccount.provider == provider, OAuthAccount.provider_user_id == provider_user_id)
        .first()
    )
    if link:
        user = db.get(User, link.user_id)
    else:
        email = _norm(email)
        user = db.query(User).filter(User.email == email).first()
        if user is None:
            user = User(
                email=email, full_name=full_name, avatar_url=avatar, email_verified_at=_now()
            )
            db.add(user)
            db.flush()
        db.add(OAuthAccount(user_id=user.id, provider=provider, provider_user_id=provider_user_id))
    user.last_login_at = _now()
    if user.email_verified_at is None:
        user.email_verified_at = _now()  # provider-verified email
    db.commit()
    return user
