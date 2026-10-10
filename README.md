# Intervue

Intervue is an interview intelligence workspace for hiring teams. Recruiters manage roles and candidates, collect resumes and interview material, and use AI-assisted analysis and resume ranking to support human hiring decisions.

The product is under active development. This README describes the current implementation; [docs/SPEC.md](docs/SPEC.md) describes the broader target product and milestone acceptance criteria. Some of the larger workflows in the spec are not complete or have not yet been validated end to end.

## What works today

- **Accounts and organizations:** email/password authentication, email verification and password reset flows, Google/Microsoft OAuth hooks, organization membership, invitations, role-based access, and organization-scoped data access.
- **Roles and candidates:** create and manage roles, manage a candidate pipeline, upload resumes and interview transcripts, and view candidate details.
- **Interviews:** create and manage interviews, upload transcript or recording material, view timestamped transcript segments, map speakers, and access interview notes and analysis.
- **AI analysis:** queued resume parsing, interview notes and analysis, resume claim checks, and AI run/cost records. Results are suggestions for a human reviewer.
- **Resume ranking:** rubric editing and generation, bulk resume intake, embedding-based shortlist, rubric scoring, cross-role matches, ranking cards, comparison, and blind-review support in the backend.
- **Notetaker and transcription services:** a Google Meet bot implementation and a separate faster-whisper transcription service, with status callbacks into the backend.
- **Frontend:** Next.js workspace with dashboard, pipeline, candidate, role, interview, comparison, and settings areas, plus a Material 3-inspired component library and light/dark theme support.

Some areas are more complete in the backend than in the UI. The Meet bot is covered by automated fixtures, but its selectors and behavior still need validation against live Meet sessions. See the service READMEs and the milestone acceptance criteria in the spec before treating these capabilities as production ready.

## What remains

The broader spec still includes work such as:

- completing and validating production deployment and infrastructure for the full stack
- validating bot recording, transcription, and analysis on real meetings
- calendar synchronization and auto-join (M6)
- complete Microsoft Teams and Zoom bot support (M7–M8)
- optional hosted Jitsi meetings (M9)
- retention/deletion workflows, billing, exports, webhooks, notifications, and ATS integrations (M10)
- auditing all security, privacy, accessibility, and performance acceptance criteria

For current milestone status, use the acceptance criteria in [docs/SPEC.md](docs/SPEC.md); code presence alone does not mean an item has passed acceptance.

## Architecture

| Part | Technologies |
| --- | --- |
| Frontend | Next.js 16, React 19, Tailwind CSS 4, TanStack Query, Zustand, Radix-based components |
| API | FastAPI, SQLAlchemy 2, Alembic, PostgreSQL 16 with pgvector |
| Background work | Celery and Redis |
| File storage | S3-compatible storage; MinIO for local development |
| AI | OpenAI models for parsing, analysis, ranking, and embeddings |
| Notetaker | Node.js, TypeScript, Playwright, Chromium, PulseAudio, ffmpeg |
| Transcriber | FastAPI and faster-whisper, with an optional hosted transcription mode |

## Repository layout

```text
backend/                 FastAPI API, data models, migrations, AI, and Celery tasks
frontend/                Next.js recruiting workspace
services/notetaker-bot/  Meeting bot and platform adapters
services/transcriber/    Audio transcription service
infra/aws/               AWS infrastructure definitions (in progress)
docs/SPEC.md             Product and engineering target spec
docker-compose.yml       Local development stack
```

## Run locally

### Requirements

- Docker with Compose
- Node.js 22+ and npm (for running the frontend on the host)
- `uv` (for running the backend on the host)
- An OpenAI API key for AI parsing, analysis, and ranking

### Start the backend dependencies

From the repository root, copy the backend example environment file and start PostgreSQL, Redis, and MinIO:

```powershell
if (!(Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
docker compose up -d postgres redis minio minio-init
```

The local Postgres and MinIO credentials in the Compose file are for development only. Do not use them in a deployed environment.

Add your `OPENAI_API_KEY` to `backend/.env` if you want AI features. The example config uses local Postgres, Redis, and MinIO addresses suitable for running the API on your host.

### Run the API and worker

In one terminal:

```powershell
cd backend
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

In another terminal, from `backend/`:

```powershell
uv run celery -A app.worker.celery_app.celery_app worker -l info -Q default --concurrency 2
```

The worker is needed for queued analysis, resume parsing, ranking, and other background jobs. Celery Beat handles scheduled jobs; start it in another `backend/` terminal when needed:

```powershell
uv run celery -A app.worker.celery_app.celery_app beat -l info
```

### Run the frontend

In another terminal:

```powershell
cd frontend
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The frontend calls the API through its same-origin `/api` proxy; the development proxy targets `http://localhost:8000`.

### Optional: transcriber service

The Compose `stt` profile starts the CPU transcriber and downloads a Whisper model. The first start can take a while:

```powershell
docker compose --profile stt up -d --build
```

Set `WHISPER_MODEL` in the environment to select the local model. For the bot, build its image with `docker build -t intervue-notetaker services/notetaker-bot`; live bot launches also require a working Docker launcher configuration and a reachable backend callback URL.

### Run the full app with Compose

To build and run the containerized API, worker, scheduler, frontend, Postgres, Redis, and MinIO:

```powershell
docker compose up -d --build
```

The frontend is at [http://localhost:3000](http://localhost:3000), and the API docs are at [http://localhost:8000/docs](http://localhost:8000/docs). Add `--profile stt` to include the CPU transcription service. View logs with `docker compose logs -f backend worker frontend` and stop the stack with `docker compose down`.

## API overview

Interactive OpenAPI documentation is available at `/docs` while the API is running. Major route groups include:

- `/auth/*` — registration, login, session refresh, email verification, password reset, and OAuth
- `/orgs/*` — organizations, member invitations, and organization settings
- `/roles/*` and `/candidates/*` — role and candidate management
- `/interviews/*` — interview scheduling, transcript/recording upload, speaker mapping, and analysis
- `/roles/{id}/rubric`, `/roles/{id}/rankings`, `/batches/*` — rubric, resume intake, and ranking workflows
- `/analysis/*` — analysis requests and job status
- `/internal/*` — signed callbacks and controls for bot/transcriber services
- `/healthz` and `/readyz` — liveness and readiness probes

Most application routes require an authenticated user and an organization context. The frontend stores session state in secure HTTP-only cookies and sends the selected organization with API requests.

## Configuration and data

Backend settings are centralized in `backend/app/core/config.py`; start from [`backend/.env.example`](backend/.env.example). The local Compose stack uses PostgreSQL with pgvector, Redis for Celery, and private MinIO storage. Uploaded objects are stored in S3-compatible storage and served using short-lived signed URLs.

AI features need `OPENAI_API_KEY`. Google and Microsoft OAuth require their corresponding client credentials. Local email defaults to console output; configure SMTP or SES for email delivery. Production deployments must provide secure signing/encryption keys and production credentials rather than the development defaults.

## Tests and quality checks

The repository includes backend tests, bot unit and fixture-based browser tests, and transcriber tests. The spec's definition of done calls for backend tests, frontend lint/build checks, and reversible migrations for applicable changes. The live Google Meet behavior and full-stack production deployment require separate end-to-end validation.

Run the backend tests from `backend/`:

```powershell
uv run pytest
```

For bot and transcriber test commands and setup, see [`services/notetaker-bot/README.md`](services/notetaker-bot/README.md) and [`services/transcriber/README.md`](services/transcriber/README.md).

## Project status

Intervue has progressed beyond the original CRUD prototype: authentication, organization scoping, async processing, interviews, transcript handling, bot/transcriber services, and ranking foundations are present. It is still an actively developed project, and the broader product spec is not complete. Refer to [docs/SPEC.md](docs/SPEC.md) for the target architecture, detailed milestones, and acceptance criteria.
