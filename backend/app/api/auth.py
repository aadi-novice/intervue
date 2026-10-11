from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.api.deps import api_error, get_current_user
from app.core import security
from app.core.config import settings
from app.db.dependencies import get_db
from app.models.tenancy import User
from app.schemas.auth import (
    ForgotPasswordRequest,
    LoginRequest,
    MeResponse,
    OrgSummary,
    RegisterRequest,
    ResetPasswordRequest,
    TokenRequest,
    UserResponse,
)
from app.services import auth_service, org_service
from app.services.auth_service import AuthError

router = APIRouter(prefix="/auth", tags=["Auth"])


def _raise(e: AuthError):
    raise api_error(e.status, e.detail, e.code)


def _set_cookies(response: Response, access: str, refresh: str) -> None:
    common = dict(
        httponly=True, secure=settings.cookie_secure, samesite="lax", domain=settings.cookie_domain
    )
    response.set_cookie(
        "access_token", access, max_age=settings.jwt_access_ttl_minutes * 60, path="/", **common
    )
    response.set_cookie(
        "refresh_token", refresh, max_age=settings.jwt_refresh_ttl_days * 86400,
        path=settings.refresh_cookie_path, **common,
    )
    response.set_cookie(
        "csrf_token", security.new_csrf_token(), max_age=settings.jwt_refresh_ttl_days * 86400,
        path="/", httponly=False, secure=settings.cookie_secure, samesite="lax",
        domain=settings.cookie_domain,
    )


def _clear_cookies(response: Response) -> None:
    for name, path in (("access_token", "/"), ("refresh_token", settings.refresh_cookie_path), ("csrf_token", "/")):
        response.delete_cookie(name, path=path, domain=settings.cookie_domain)


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _me(db: Session, user: User) -> MeResponse:
    orgs = [
        OrgSummary(id=o.id, name=o.name, slug=o.slug, role=role, settings=org_service.public_settings(o.settings))
        for o, role in org_service.list_user_orgs(db, user)
    ]
    return MeResponse(user=UserResponse.from_user(user), orgs=orgs)


@router.post("/register", status_code=201, response_model=MeResponse)
def register(
    body: RegisterRequest, request: Request, response: Response, db: Session = Depends(get_db)
):
    try:
        user = auth_service.register(db, body.email, body.password, body.full_name)
    except AuthError as e:
        _raise(e)
    access, refresh = auth_service.issue_session(
        db, user, request.headers.get("user-agent"), _client_ip(request)
    )
    _set_cookies(response, access, refresh)
    return _me(db, user)


@router.post("/login", response_model=MeResponse)
def login(body: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    try:
        user = auth_service.authenticate(db, body.email, body.password, _client_ip(request))
    except AuthError as e:
        _raise(e)
    access, refresh = auth_service.issue_session(
        db, user, request.headers.get("user-agent"), _client_ip(request)
    )
    _set_cookies(response, access, refresh)
    return _me(db, user)


@router.post("/refresh", response_model=MeResponse)
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get("refresh_token")
    if not token:
        raise api_error(401, "No refresh token", "not_authenticated")
    if not security.csrf_matches(
        request.cookies.get("csrf_token"), request.headers.get("x-csrf-token")
    ):
        raise api_error(403, "CSRF token missing or invalid", "csrf_failed")
    try:
        user, access, new_refresh = auth_service.rotate_refresh(
            db, token, request.headers.get("user-agent"), _client_ip(request)
        )
    except AuthError as e:
        _clear_cookies(response)
        _raise(e)
    _set_cookies(response, access, new_refresh)
    return _me(db, user)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    auth_service.revoke_refresh(db, request.cookies.get("refresh_token"))
    _clear_cookies(response)
    response.status_code = 204
    return response


@router.get("/me", response_model=MeResponse)
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _me(db, user)


@router.post("/verify-email", response_model=UserResponse)
def verify_email(body: TokenRequest, db: Session = Depends(get_db)):
    try:
        return UserResponse.from_user(auth_service.verify_email(db, body.token))
    except AuthError as e:
        _raise(e)


@router.post("/resend-verification", status_code=202)
def resend_verification(user: User = Depends(get_current_user)):
    if user.email_verified_at is None:
        auth_service.send_verification_email(user)
    return {"status": "sent"}


@router.post("/forgot-password", status_code=202)
def forgot_password(body: ForgotPasswordRequest, db: Session = Depends(get_db)):
    auth_service.request_password_reset(db, body.email)
    return {"status": "ok"}


@router.post("/reset-password", status_code=204)
def reset_password(body: ResetPasswordRequest, db: Session = Depends(get_db)):
    try:
        auth_service.reset_password(db, body.token, body.password)
    except AuthError as e:
        _raise(e)
    return Response(status_code=204)


# ── OAuth (Google / Microsoft) ────────────────────────────────────────────────
_PROVIDERS = {
    "google": dict(
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    ),
    "microsoft": dict(
        server_metadata_url=(
            "https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration"
        ),
        client_kwargs={"scope": "openid email profile"},
    ),
}


def _oauth_client(provider: str):
    from authlib.integrations.starlette_client import OAuth

    if provider not in _PROVIDERS:
        raise HTTPException(404, "Unknown provider")
    cid = getattr(settings, f"{provider}_client_id")
    secret = getattr(settings, f"{provider}_client_secret")
    if not cid or not secret:
        raise api_error(501, f"{provider} sign-in is not configured", "oauth_not_configured")
    oauth = OAuth()
    oauth.register(name=provider, client_id=cid, client_secret=secret, **_PROVIDERS[provider])
    return getattr(oauth, provider)


@router.get("/oauth/{provider}/login")
async def oauth_login(provider: str, request: Request):
    client = _oauth_client(provider)
    redirect_uri = f"{settings.public_api_url}/auth/oauth/{provider}/callback"
    return await client.authorize_redirect(request, redirect_uri)


@router.get("/oauth/{provider}/callback")
async def oauth_callback(provider: str, request: Request, db: Session = Depends(get_db)):
    from fastapi.responses import RedirectResponse

    client = _oauth_client(provider)
    token = await client.authorize_access_token(request)
    info = token.get("userinfo") or {}
    email = info.get("email")
    # Only trust provider emails that the provider says are verified.
    verified = info.get("email_verified", provider == "microsoft" and bool(email))
    if not email or not verified:
        raise api_error(400, "Provider did not return a verified email", "oauth_email")
    user = auth_service.login_or_create_oauth_user(
        db, provider, info["sub"], email, info.get("name") or email, info.get("picture")
    )
    access, refresh = auth_service.issue_session(
        db, user, request.headers.get("user-agent"), _client_ip(request)
    )
    resp = RedirectResponse(f"{settings.frontend_url}/dashboard")
    _set_cookies(resp, access, refresh)
    return resp
