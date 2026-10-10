#!/bin/sh
set -e

# Managed Postgres providers (Render, Heroku-style) hand out postgres:// or postgresql:// URLs;
# SQLAlchemy needs the psycopg2 driver spelled out.
case "${DATABASE_URL:-}" in
  postgres://*)   DATABASE_URL="postgresql+psycopg2://${DATABASE_URL#postgres://}" ;;
  postgresql://*) DATABASE_URL="postgresql+psycopg2://${DATABASE_URL#postgresql://}" ;;
esac
export DATABASE_URL

# Run migrations first when asked (set on exactly one service, normally the API).
if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  echo "Running alembic upgrade head"
  alembic upgrade head
fi
exec "$@"
