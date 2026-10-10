# Deployment

Everything ships as containers (`backend/Dockerfile` serves API, worker and beat; `frontend/Dockerfile` is Next.js
`output: "standalone"`). The browser only talks to the frontend; `/api/*` is proxied to the backend over the private
network, so the refresh cookie path is `/api/auth` everywhere (`REFRESH_COOKIE_PATH`).

Important: the Next.js rewrite target is baked in at **build** time. Pass `--build-arg BACKEND_INTERNAL_URL=...`
(or `BACKEND_INTERNAL_HOSTPORT=host:port`) when building the frontend image.

## Profiles

| Profile | Files | Notes |
|---|---|---|
| Local compose | `docker-compose.yml` | `docker compose up -d postgres redis minio minio-init` for infra only; `docker compose up -d --build` for the stack; `--profile stt` adds the CPU transcriber (large model download). Ports overridable with `BACKEND_PORT`, `FRONTEND_PORT`. |
| Single server | `docker-compose.prod.yml`, `Caddyfile`, `.env.prod.example` | Caddy terminates TLS (80/443 only), nightly `pg_dump` sidecar, no object store (use S3/R2). Docker-socket access for `BOT_LAUNCHER=docker` is an opt-in with a security caveat (see comments in the file). |
| Render | `render.yaml` | Web: frontend, backend (pre-deploy `alembic upgrade head`); workers: worker, beat (1), optional bot pool; Render Postgres 16 + Key Value. Secrets are `sync: false`. |
| AWS | `infra/aws/` | Terraform skeleton, see its README. |

None of the Render, AWS or single-server profiles has been deployed. Local compose was run (see below).

Local MinIO images: `minio/minio` and `minio/mc` are no longer pullable from Docker Hub/quay.io, so compose uses
the Chainguard images (`cgr.dev/chainguard/minio`, `minio-client:latest-dev`).

## Environment variables

Backend (`backend/.env.example`; all read through `app/core/config.py`):

| Var | Purpose / dev default |
|---|---|
| `ENVIRONMENT` | `development` / `production` |
| `DATABASE_URL` | `postgresql+psycopg2://...` (the image entrypoint rewrites `postgres://` and `postgresql://`) |
| `REDIS_URL` | Celery broker/cache. `rediss://` for TLS (ElastiCache) |
| `CORS_ORIGINS`, `FRONTEND_URL`, `PUBLIC_API_URL` | public URLs; behind the proxy all point at the frontend origin |
| `STORAGE_BACKEND`, `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT_URL`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | S3 API. Empty endpoint/keys on AWS (task role); endpoint for R2/MinIO |
| `OPENAI_API_KEY`, `MODEL_RESUME_PARSE`, `MODEL_ANALYSIS`, `MODEL_RANK`, `EMBEDDING_MODEL` | LLM |
| `INTERNAL_HMAC_SECRET` | signs bot/transcriber callbacks |
| `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` | RS256 PEMs (required outside dev) |
| `TOKEN_ENCRYPTION_KEY` | Fernet key |
| `COOKIE_SECURE`, `REFRESH_COOKIE_PATH` | `true` and `/api/auth` in prod |
| `GOOGLE_CLIENT_ID/SECRET`, `MICROSOFT_CLIENT_ID/SECRET` | OAuth (optional) |
| `EMAIL_BACKEND` (`console`/`smtp`/`ses`), `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT` (+ `SMTP_USERNAME/PASSWORD`) | email |
| `BOT_LAUNCHER` (`docker`/`ecs`/`pool`), `BOT_IMAGE` | notetaker bots |
| `TRANSCRIBER_MODE` (`local`/`api`), `TRANSCRIBER_URL`, `TRANSCRIBER_API_KEY`, `TRANSCRIBER_CALLBACK_SECRET` | transcription |
| `RANK_SHORTLIST_K`, `SENTRY_DSN`, `LOG_LEVEL` | misc |
| `RUN_MIGRATIONS` | image entrypoint only: `true` runs `alembic upgrade head` before the command |

Frontend: `BACKEND_INTERNAL_URL` / `BACKEND_INTERNAL_HOSTPORT` (build args), `NEXT_PUBLIC_API_URL` (build arg; empty = same-origin `/api`), `PORT` (3000).

Transcriber (`services/transcriber/README.md`): `TRANSCRIBER_API_KEY`, `TRANSCRIBER_CALLBACK_SECRET` (must match the backend),
`TRANSCRIBER_MODE`, `WHISPER_MODEL` (`large-v3`; compose uses `small` by default), `WHISPER_DEVICE`, `WHISPER_COMPUTE_TYPE`,
`WHISPER_CPU_FALLBACK_MODEL`, `MAX_CONCURRENT_JOBS`, `DOWNLOAD_MAX_BYTES`, `STT_API_PROVIDER`/`STT_API_MODEL`, `OPENAI_API_KEY`
(api mode), `CALLBACK_INLINE_MAX_BYTES`, `HF_HOME`, `PORT` (8080; compose sets 8100).

Notetaker bot (`services/notetaker-bot/README.md`): `BOT_MODE` (`single`/`pool`), `REDIS_URL`, `BOT_QUEUE_NAME`, and per session
`BOT_SESSION_ID`, `MEETING_URL`, `CALLBACK_URL`, `CALLBACK_SECRET`, `UPLOAD_PREFIX`, `CONSENT_MESSAGE`, `BOT_NAME`,
`MAX_DURATION_MIN`, `ADMISSION_TIMEOUT_MIN`, `ALONE_TIMEOUT_SEC`, `CHUNK_SECONDS`, `HEADLESS`, `LOG_LEVEL`.

Known local-compose limits: presigned URLs are signed against `S3_ENDPOINT_URL` (`http://minio:9000` inside compose),
which a browser or the transcriber container cannot necessarily reach; and callbacks use `PUBLIC_API_URL`
(`localhost:8000`), unreachable from inside the transcriber container. Fine for API/worker checks, not an end-to-end STT run.

## Runbook: Supabase to a new Postgres 16 (run by a human)

Nothing here was run by the automation; it never connected to Supabase or any cloud account.

1. Provision Postgres 16 with pgvector (RDS, Render Postgres, or the compose `pgvector/pgvector:pg16` image). Stop writes
   to the old app (maintenance window).
2. Dump from Supabase (use the direct connection or session pooler, not the transaction pooler). Only the `public` schema:
   ```
   pg_dump "$SUPABASE_DB_URL" --schema=public --no-owner --no-privileges --format=custom -f intervue.dump
   ```
3. Create the extension on the target before restoring (needs a privileged user):
   ```
   psql "$NEW_DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS vector;"
   ```
4. Restore: `pg_restore --no-owner --no-privileges --dbname "$NEW_DATABASE_URL" intervue.dump`
   (ignore errors about Supabase-only roles/extensions; check `\dx` shows `vector`).
5. Bring the schema to the current revision. If the dump already contains `alembic_version`, this applies only the missing
   migrations; with an empty database it builds everything:
   ```
   DATABASE_URL=postgresql+psycopg2://... alembic upgrade head      # or start the backend with RUN_MIGRATIONS=true
   ```
6. Sanity checks: row counts per table versus the source, `SELECT count(*) FROM resume_profiles WHERE embedding IS NOT NULL`,
   and `GET /readyz`.
7. Switch `DATABASE_URL` in the target environment (compose env, Render dashboard, or Secrets Manager
   `.../DATABASE_URL`), redeploy backend, worker and beat, then verify login and a resume upload.
8. Keep the Supabase project read-only for a while as a rollback; delete it after the retention window.
9. Files stored in Supabase Storage (if any were used) are not part of `pg_dump`; copy them to the S3 bucket under the
   same keys (`aws s3 sync` or `rclone`).
