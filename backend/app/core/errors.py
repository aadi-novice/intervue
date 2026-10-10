"""Domain errors and the uniform `{detail, code}` error envelope."""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class DomainError(Exception):
    status = 400
    code = "bad_request"

    def __init__(self, detail: str, code: str | None = None):
        super().__init__(detail)
        self.detail = detail
        if code:
            self.code = code


class NotFound(DomainError):
    status, code = 404, "not_found"


class Conflict(DomainError):
    status, code = 409, "conflict"


class Invalid(DomainError):
    status, code = 422, "invalid"


class Forbidden(DomainError):
    status, code = 403, "forbidden"


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def _domain(_: Request, exc: DomainError):
        return JSONResponse({"detail": exc.detail, "code": exc.code}, status_code=exc.status)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException):
        d = exc.detail
        if isinstance(d, dict) and "code" in d:
            body = {"detail": str(d.get("detail", "")), "code": d["code"]}
        else:
            body = {"detail": d if isinstance(d, str) else str(d), "code": f"http_{exc.status_code}"}
        return JSONResponse(body, status_code=exc.status_code, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        errors = [
            {"loc": list(e.get("loc", [])), "msg": e.get("msg", "")} for e in exc.errors()
        ]
        return JSONResponse(
            {"detail": "Validation error", "code": "validation_error", "errors": errors},
            status_code=422,
        )
