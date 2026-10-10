#!/bin/sh
set -e
# Run migrations first when asked (set on exactly one service, normally the API).
if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  echo "Running alembic upgrade head"
  alembic upgrade head
fi
exec "$@"
