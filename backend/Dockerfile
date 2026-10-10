# One image for API, Celery worker and Celery beat; the command is chosen by compose / Render / ECS.
#   api:    (default)  uvicorn app.main:app --host 0.0.0.0 --port 8000
#   worker: celery -A app.worker.celery_app.celery_app worker -l info -Q default --concurrency 2
#   beat:   celery -A app.worker.celery_app.celery_app beat -l info
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /uvx /usr/local/bin/

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN useradd --create-home --uid 10001 intervue \
    && chmod +x /usr/local/bin/docker-entrypoint.sh \
    && chown -R intervue /app
USER intervue

EXPOSE 8000
# The healthcheck only applies to the API; worker/beat override it in compose / render.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://localhost:8000/healthz || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
