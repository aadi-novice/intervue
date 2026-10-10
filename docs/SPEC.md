# Intervue — Product & Engineering Spec

> **Audience:** engineers and AI coding agents (Claude Code, Cursor, etc.) building Intervue.
> **How to use:** work milestone by milestone. Each task has an ID (`M1.3`), the files it touches,
> and acceptance criteria. One task ≈ one PR. A task is done only when its acceptance criteria and
> tests pass. When this spec and the code disagree, the code is the truth for *current* behaviour
> and this spec is the truth for *target* behaviour — update the spec in the same PR if you deviate.

---

## 1. Product

### 1.1 What Intervue is
An **interview-intelligence service for hiring teams**. Any company (an *organization*) signs up,
opens roles, drops in resumes, and runs interviews on whatever meeting tool they already use.
Intervue:

1. **Ranks** any number of resumes against each open role (and across roles).
2. **Captures** interviews automatically with a Fathom-style **notetaker bot** that joins
   Google Meet / Teams / Zoom and produces a speaker-labelled transcript + notes.
3. **Analyses** each interview — summary, strengths, weaknesses, scores, resume-vs-interview claim checks.
4. **Compares** candidates per role through summary cards and a comparison matrix.

Humans run the interviews and make the decisions. Intervue is the analysis layer.

### 1.2 Non-goals (do not build)
- **AI interviewer** / autonomous screening rounds. Interviews are conducted by humans.
- Live in-call copilot / question prompting.
- A full ATS replacement (offers, onboarding, payroll). We integrate with ATSs later instead.
- Automated hire/reject decisions. AI output is always a *suggestion*, labelled as such.

### 1.3 Personas & org roles
| Membership role | Can do |
|---|---|
| `admin` | everything + members, billing, integrations, data retention |
| `recruiter` | roles, candidates, uploads, ranking, schedule interviews, view all analyses |
| `hiring_manager` | view roles/candidates/analyses they're assigned to, comment, move stages |
| `interviewer` | view their own interviews, transcripts and the candidate's resume |

### 1.4 Glossary
- **Organization (org):** a customer company. Every business row belongs to exactly one org.
- **Role:** an open position (existing `roles` table).
- **Rubric:** weighted criteria for a role, used for resume scoring and interview analysis.
- **Role match:** a candidate's fit score against a role (a candidate can be matched to many roles).
- **Interview:** one scheduled conversation between candidate and interviewer(s).
- **Bot session:** one notetaker bot's lifecycle inside one interview.
- **Transcript segment:** one utterance `{speaker, start_ms, end_ms, text}`.
- **Summary card:** the per-candidate-per-role composite view (resume fit + interview analysis + claim checks).

---

## 2. Current state (as of commit `ec43f78`)

### 2.1 Stack
- **Backend:** FastAPI, SQLAlchemy 2.x, Alembic, PostgreSQL 16 + pgvector (currently hosted on Supabase), Python 3.11+, `uv`,
  OpenAI (`gpt-4.1-mini` default), PyMuPDF, Azure Blob Storage (**to be removed**, see M0.2). 72 pytest tests.
- **Frontend:** Next.js **16** (breaking changes vs. older Next — read `frontend/AGENTS.md` and
  `node_modules/next/dist/docs/` before writing Next code), React 19, Tailwind 4, Radix, framer-motion,
  TanStack Query, Zustand, dnd-kit, lucide icons. Currently deployed on Vercel (moving to AWS or Render, see §3.3).

### 2.2 What exists
- `roles`: create / list / delete (name, experience_level, experience_required_years).
- `candidates`: CRUD, `status` (pipeline stage), uploads for resume PDF / transcript `.txt` / avatar.
- `resume_profiles`: cached structured extraction of the resume (one LLM call per resume).
- `analyses`: summary, strengths, weaknesses, key_moments, technical/communication/confidence scores,
  resume_alignment (claim comparisons).
- `POST /analysis/candidates/{id}` runs analysis **synchronously** inside an async route.
- Frontend pages: dashboard, pipeline (kanban), talent pool, candidate detail, compare, new role,
  new candidate, settings (not persisted).

### 2.3 Known problems to fix (addressed in M0/M1)
| # | Problem | Where |
|---|---|---|
| P1 | Blob containers are created with `public_access="blob"` — resumes are publicly readable by URL | `backend/app/core/storage.py` |
| P2 | No auth, no tenancy — everyone sees everything | whole app |
| P3 | `Role.name` and `Candidate.email` are globally unique — breaks multi-tenant | models |
| P4 | Sync LLM calls inside `async def` routes block the event loop | `app/api/analysis.py`, `app/api/candidate.py` |
| P5 | CORS origins and model names hardcoded / read ad-hoc with `os.getenv` | `app/main.py`, `app/ai/*` |
| P6 | `models/interview.py`, `services/memory_service.py`, `ai/embeddings.py` are empty stubs | — |
| P7 | No cost tracking for LLM calls | `app/ai/*` |
| P8 | Vendor lock-in: Azure Blob SDK (`azure-storage-blob`), Supabase-hosted DB, Vercel. Target is AWS **or** Render with no Azure/Supabase/Vercel dependency | `app/core/storage.py`, `pyproject.toml`, deploy config |

---

## 3. Target architecture

```
                         ┌──────────────── AWS or Render (Node web service) ────────────┐
                         │  frontend/ (Next.js 16, Material 3 design system)            │
                         └──────────────▲───────────────────────────────────────────────┘
                                        │ HTTPS + Intervue JWT (httpOnly cookie)
┌───────────────────────────────────────┴─────────────────────────────────────────────────┐
│ backend/ (FastAPI)                                                                       │
│   api/  → services/ → models/          auth: verify Intervue JWT → org context          │
│   /internal/* (HMAC)  ← callbacks from bots & transcriber                               │
└──────┬──────────────────────┬──────────────────────────┬───────────────────────────────┘
       │ enqueue              │ SQL                      │ objects (private, presigned)
┌──────▼──────┐        ┌──────▼────────┐          ┌──────▼──────────┐
│ Redis       │        │ Postgres 16   │          │ S3 (or S3-API)  │
│ (broker)    │        │ + pgvector    │          │ resumes/        │
└──────┬──────┘        │ (RDS/Render)  │          │ recordings/ ... │
       │               └───────────────┘          └─────────────────┘
┌──────▼───────────────────────────────────────┐
│ backend worker (Celery): parse, embed, rank, │
│ analyse, transcript alignment, bot launcher  │
└──────┬─────────────────────────┬─────────────┘
       │ launch container        │ POST audio URL
┌──────▼───────────────────┐  ┌──▼──────────────────────────────┐
│ services/notetaker-bot/  │  │ services/transcriber/           │
│ Node + Playwright        │  │ Python + faster-whisper (GPU)   │
│ 1 container per meeting  │  │ batch transcription w/ words    │
└──────────────────────────┘  └─────────────────────────────────┘
```

### 3.1 Repository layout (target)
```
intervue/
├── backend/                  FastAPI app + Celery worker (same codebase)
│   └── app/
│       ├── api/              routers (thin: validate, authorize, call service)
│       ├── core/             config.py (pydantic-settings), security.py, storage.py, logging.py
│       ├── db/
│       ├── models/
│       ├── schemas/
│       ├── services/         business logic (all org-scoped)
│       ├── ai/               LLM + embedding calls only, no DB access
│       └── worker/           celery_app.py, tasks/*.py
├── frontend/                 Next.js app
├── services/
│   ├── notetaker-bot/        Node 22 + TypeScript + Playwright
│   └── transcriber/          Python + faster-whisper + FastAPI
├── docs/SPEC.md              this file
└── docker-compose.yml        postgres, redis, worker, transcriber (local dev)
```

### 3.2 Conventions (all code)
- **Every business table has `org_id`** (FK `organizations.id`, indexed, NOT NULL). Every service function
  takes an `OrgContext` and filters by `org_id`. A query without an org filter is a bug.
- **Routers stay thin.** No business logic or LLM calls in `api/`.
- **No LLM / network / CPU-heavy work in request handlers.** Enqueue a Celery task, return `202` with a job/status
  resource, and the frontend polls (TanStack Query `refetchInterval`) or later uses SSE.
- **Config only via `app/core/config.py`** (`pydantic-settings`). No `os.getenv` / `load_dotenv` elsewhere.
- **Every LLM call goes through `app/ai/llm.py`**, which records an `ai_runs` row (org, purpose, model,
  tokens, cost, latency, prompt_version). Prompts live in `app/ai/prompts/` with a version string.
- **Structured outputs:** use JSON-schema response formats and validate with Pydantic; never regex-parse JSON.
- **Migrations:** one Alembic migration per schema change, reversible `downgrade()`. Never edit old migrations.
- **Tests:** each task adds tests. Backend: pytest (mock LLMs — no real API calls in tests). Bot: Playwright
  tests against recorded fixtures. Frontend: component tests where logic exists.
- **Timestamps:** timezone-aware UTC (`DateTime(timezone=True)`, `datetime.now(UTC)`). Replace `datetime.utcnow`.


### 3.3 Hosting & deployment (no Azure, no Supabase, no Vercel)
Everything ships as containers, so the same images deploy to **AWS** (for scale) or **Render** (for simplicity).
Each service has a `Dockerfile`; local dev runs everything through `docker-compose.yml`
(postgres + pgvector, redis, minio, backend, worker, transcriber).

| Component | AWS profile (recommended for scale) | Render profile (fastest to run) |
|---|---|---|
| Frontend (Next.js) | ECS Fargate service behind ALB + CloudFront | Render Web Service (Node) |
| Backend API | ECS Fargate service behind ALB (autoscale on CPU/requests) | Render Web Service (Docker) |
| Celery worker + beat | ECS Fargate services (worker scales on queue depth; beat = 1 task) | Render Background Workers (beat = 1 instance) |
| Postgres 16 + pgvector | RDS for PostgreSQL (Multi-AZ in prod) | Render Postgres (pgvector supported) |
| Redis | ElastiCache (Redis/Valkey) | Render Key Value |
| Object storage | S3 | S3 or Cloudflare R2 (Render has no object store) |
| Notetaker bots | ECS Fargate `RunTask` per meeting | Background Worker pool (`PoolLauncher`) |
| Transcriber | ECS on GPU EC2 (g4dn/g6) | CPU worker, or hosted STT API |
| Email | SES | any SMTP provider |
| Secrets | Secrets Manager / SSM Parameter Store | Render env groups |
| Logs / errors | CloudWatch + Sentry | Render logs + Sentry |
| IaC | Terraform in `infra/aws/` | `render.yaml` blueprint |

**Single dedicated server option** (cheapest start: one EC2 instance or similar): `docker compose -f docker-compose.prod.yml up`
with Caddy for TLS, the same containers, and `DockerLauncher` for bots. Even then, use managed Postgres or automated backups to S3.

Rules: no vendor SDK outside its adapter (`core/storage.py`, `worker/bot_launchers/`, `core/email.py`); vendor choice is
config only (`STORAGE_BACKEND`, `BOT_LAUNCHER`, `TRANSCRIBER_MODE`, `EMAIL_BACKEND`).

---

## 4. Data model

New / changed tables. Types are Postgres. All new tables have `id`, `created_at`, `updated_at`.

### 4.1 Tenancy & auth
```
organizations      id, name, slug UNIQUE, settings JSONB, data_retention_days INT DEFAULT 365
users              id, email UNIQUE, password_hash NULL (argon2), full_name, avatar_url,
                   email_verified_at NULL, last_login_at
oauth_accounts     id, user_id, provider ENUM(google, microsoft), provider_user_id,
                   UNIQUE(provider, provider_user_id)
refresh_tokens     id, user_id, token_hash UNIQUE, expires_at, revoked_at NULL, user_agent, ip
memberships        id, org_id, user_id, role ENUM(admin, recruiter, hiring_manager, interviewer),
                   UNIQUE(org_id, user_id)
invitations        id, org_id, email, role, token UNIQUE, expires_at, accepted_at
audit_logs         id, org_id, user_id NULL, action TEXT, entity_type, entity_id, metadata JSONB
ai_runs            id, org_id, purpose TEXT, model, prompt_version, input_tokens, output_tokens,
                   cost_usd NUMERIC(10,5), latency_ms, status, error TEXT NULL
```

### 4.2 Hiring
```
roles              + org_id, + description TEXT (full JD), + status ENUM(open, paused, closed),
                   + jd_embedding VECTOR(1536) NULL
                   UNIQUE(org_id, name)            -- replaces global unique on name
rubric_criteria    id, org_id, role_id, name, description, weight FLOAT (0..1), must_have BOOL,
                   position INT
candidates         + org_id, + source TEXT NULL (upload, bulk, ats, manual)
                   UNIQUE(org_id, email)           -- replaces global unique on email
resume_profiles    + org_id, + embedding VECTOR(1536) NULL, + content_hash TEXT
role_matches       id, org_id, candidate_id, role_id, vector_similarity FLOAT,
                   rubric_scores JSONB  -- [{criterion_id, score 0-5, evidence: [quote], reasoning}]
                   overall_score FLOAT (0-100), must_have_failed BOOL, explanation TEXT,
                   model, prompt_version, status ENUM(pending, shortlisted, scored, failed)
                   UNIQUE(candidate_id, role_id)
```
`candidates.role_id` stays as the **primary role / pipeline the candidate is in**. `role_matches` is how a
candidate is evaluated against *other* roles too.

### 4.3 Interviews & transcripts
```
interviews         id, org_id, candidate_id, role_id, title, scheduled_start TIMESTAMPTZ, scheduled_end,
                   meeting_url TEXT NULL,
                   platform ENUM(google_meet, teams, zoom, jitsi, upload),
                   status ENUM(scheduled, in_progress, processing, completed, failed, cancelled),
                   created_by_user_id
interview_participants  id, interview_id, user_id NULL, display_name, email NULL,
                   kind ENUM(interviewer, candidate, other)
bot_sessions       id, org_id, interview_id, status ENUM(scheduled, launching, joining,
                   waiting_admission, in_call, leaving, completed, failed),
                   failure_reason TEXT NULL, container_ref TEXT NULL,
                   joined_at, left_at, consent_message_sent_at
recordings         id, org_id, interview_id, blob_path, mime_type, duration_ms, size_bytes
speaker_events     id, interview_id, t_ms INT, speaker_name TEXT   -- from bot DOM observation
transcript_segments id, org_id, interview_id, speaker_label TEXT, participant_id NULL,
                   speaker_kind ENUM(interviewer, candidate, unknown),
                   start_ms, end_ms, text, confidence FLOAT NULL, position INT
interview_notes    id, org_id, interview_id UNIQUE, summary TEXT, key_points JSONB,
                   topics JSONB, follow_ups JSONB, model, prompt_version
analyses           + org_id, + interview_id NULL, + role_id, + model, + prompt_version
```
Existing transcript `.txt` uploads become an `interview` with `platform=upload` and parsed `transcript_segments`.
Analysis always reads from `transcript_segments` (one code path).

---

## 5. Milestones

Order: **M0 → M1 → (M2 ∥ M3) → M4 → M5 → M6 → M7+**. M2 (design system) can run in parallel with backend work.

### M0 — Hardening (prerequisite)

**M0.1 Settings module.** Add `pydantic-settings`; create `app/core/config.py` with all env vars
(DB URL, S3 bucket/region/endpoint/credentials, OpenAI key + model names, CORS origins list, Redis URL,
internal HMAC secret, JWT signing key, OAuth client ids/secrets). Replace every `os.getenv`/`load_dotenv` in `app/`. Add `backend/.env.example`.
*Accept:* `grep -r "os.getenv" backend/app` returns nothing; CORS origins come from env.

**M0.2 Replace Azure with S3-compatible object storage.** Remove `azure-storage-blob` from `pyproject.toml` and
rewrite `app/core/storage.py` on `boto3` against the S3 API, so the same code works with **AWS S3** and any
S3-compatible store (Cloudflare R2, Backblaze B2, MinIO for local dev; Render has no object storage of its own,
so a Render deployment uses S3 or R2).
- One private bucket per environment, prefixes `resumes/`, `transcripts/`, `avatars/`, `recordings/`, `exports/`;
  Block Public Access on; SSE-S3 (or SSE-KMS) encryption at rest.
- Store **object keys** (not URLs) in the DB: `{org_id}/{prefix}/{uuid}.{ext}`.
- `storage.put(key, fileobj, content_type)`, `storage.get(key)`, `storage.delete(key)`,
  `storage.presigned_get(key, ttl=900)`, `storage.presigned_put(key, ttl, content_type)`.
- API responses return short-lived presigned GET URLs. Large uploads (audio/video, bulk resumes) go
  browser → S3 through presigned PUT.
- Add MinIO to `docker-compose.yml` for local dev (`S3_ENDPOINT_URL=http://localhost:9000`).
- One-off script `scripts/migrate_azure_to_s3.py` copies existing blobs and rewrites DB paths to keys;
  delete it after it has run.
*Accept:* `grep -ri azure backend/` returns nothing; anonymous GET on an object returns 403; the frontend still
shows resumes and avatars; storage tests use `moto` (no network).

**M0.3 Celery worker.** Add Redis to `docker-compose.yml`; `app/worker/celery_app.py`; move resume parsing and
analysis into tasks. `POST /analysis/candidates/{id}` returns `202 {status: "queued"}`; add
`GET /analysis/candidates/{id}/status`. Frontend shows "Analysing…" and polls.
*Accept:* analysis endpoint responds in < 200 ms; the task retries up to 3× with backoff on LLM errors.

**M0.4 LLM gateway + cost tracking.** `app/ai/llm.py` with `complete_json(purpose, prompt_version, messages,
schema, org_id)`; writes `ai_runs`. Port `summarizer.py`, `comparator.py`, `resume_parser.py` to it and to
JSON-schema structured outputs; delete the `_parse_json` regex helpers.
*Accept:* every LLM call creates an `ai_runs` row; tests mock the gateway.

**M0.5 Observability.** Structured JSON logging with request id; Sentry for backend, worker and frontend;
`/healthz` and `/readyz`.

**M0.6 Move off Supabase and Vercel.** Provision Postgres 16 (RDS or Render Postgres), `CREATE EXTENSION vector`,
`pg_dump` from Supabase → `pg_restore`, run `alembic upgrade head`, switch `DATABASE_URL`. Remove any Supabase-specific
code/config. Add Dockerfiles for frontend (Next.js `output: "standalone"`), backend, worker; `docker-compose.prod.yml`;
`render.yaml` and `infra/aws/` (Terraform) skeletons per §3.3.
*Accept:* `grep -ri "supabase\|vercel" --exclude-dir=node_modules .` only matches docs; the whole stack starts with
`docker compose up` locally and deploys from the Render blueprint.

### M1 — Multi-tenancy & auth

**M1.1 Tenancy tables** (`organizations`, `users`, `memberships`, `invitations`, `audit_logs`) + migration that
creates a "Default Org" and backfills `org_id` on all existing rows; replace global uniques with per-org uniques (P3).

**M1.2 Auth (self-hosted, no third-party auth vendor).** The backend owns auth:
email + password (argon2 via `pwdlib`), email verification + password reset (email via AWS SES or any SMTP),
Google + Microsoft OAuth (`authlib`). Short-lived access JWT (15 min, asymmetric signing key) + rotating
refresh token (30 days, stored hashed in `refresh_tokens`), both in `httpOnly; Secure; SameSite=Lax` cookies;
CSRF token on state-changing requests; login rate limiting per IP + email. Backend dependency `get_org_context()`:
verify the access JWT → load user → read `X-Org-Id` header → check membership → return
`OrgContext(user, org, role)`. Decorator/dependency `require_role("recruiter", ...)`.
*Accept:* every non-public route returns 401 without a token and 403 for the wrong org; tests cover cross-org access
on every router (user A can never read org B's candidate).

**M1.3 Org scoping everywhere.** All services take `OrgContext`; all queries filter by `org_id`.
Add a pytest fixture with two orgs and a parametrized cross-tenant leak test across all list/detail endpoints.

**M1.4 Frontend auth.** Sign in / sign up, org creation on first login, org switcher, invite members (Settings → Members),
route protection. `lib/api.ts` attaches the bearer token + `X-Org-Id`.

**M1.5 Audit log** writes for: candidate view/create/delete, analysis run, recording access, member changes, export.

### M2 — Material 3 design system & redesign (see §7 for full design spec)

**M2.1 Tokens.** Generate M3 color schemes (light + dark) from a seed color with
`@material/material-color-utilities`; expose as CSS variables and Tailwind 4 `@theme` tokens; type scale,
shape scale, elevation, state layers, motion tokens.
**M2.2 Component library** in `frontend/components/m3/` (list in §7.4) built on Radix primitives + `motion`.
**M2.3 App shell:** navigation rail (desktop) / navigation bar (mobile) / modal drawer, top app bar with search.
**M2.4 Page redesigns:** dashboard, pipeline, talent pool, candidate detail, compare, roles, settings.
**M2.5 Light/dark/system theme toggle**, persisted per user.
*Accept:* no page uses raw hex colors or the old `nh-*` tokens; Lighthouse accessibility ≥ 95 on all pages;
`prefers-reduced-motion` disables non-essential motion.

### M3 — Unified transcript model

**M3.1** Tables `interviews`, `interview_participants`, `transcript_segments`, `interview_notes`, `recordings`.
**M3.2** Transcript upload creates an `interview(platform=upload)` and parses `.txt`/`.vtt`/`.srt`/`.docx` into segments
(detect `Name:` prefixes and VTT/SRT cues). Also accept **audio/video upload** → transcriber service (M4.4).
**M3.3** Speaker mapping UI: on the interview page, the user maps each `speaker_label` to a participant
(interviewer/candidate). Auto-map when the label matches a participant name.
**M3.4** Rewrite analysis to consume segments: claim checks use **only candidate segments** as evidence and
cite `segment_id`s; key moments link to timestamps. Analysis is per interview; the candidate view aggregates across interviews.
**M3.5** `interview_notes` generation: summary, key points, topics, suggested follow-ups for the next round.
*Accept:* old candidates with `transcript_path` are migrated into interviews + segments; candidate detail
shows an Interviews tab with a transcript viewer (speaker-coloured, timestamped, searchable).

### M4 — Notetaker bot (Google Meet first)

See §6 for the full bot spec.

**M4.1** `services/notetaker-bot/` scaffold: Node 22 + TypeScript + Playwright + Xvfb + PulseAudio Docker image.
**M4.2** Google Meet adapter: join as guest, wait for admission, post the consent chat message, observe speakers,
detect the end of the meeting, leave.
**M4.3** Audio capture → chunked upload to blob → final recording file.
**M4.4** `services/transcriber/`: faster-whisper `large-v3` (GPU, `int8_float16`), CPU fallback (`medium`, int8);
`POST /jobs {audio_url, language?}` → word-level segments → callback to the backend.
**M4.5** Backend: `POST /interviews/{id}/bot` (send the bot now) and scheduled send at `scheduled_start - 1 min`
(Celery beat / ETA task); bot launcher behind a `BotLauncher` interface (local: Docker API; AWS: ECS Fargate `RunTask`; Render: see §6.5);
`/internal/bots/{session_id}/events` callback endpoint (HMAC-signed).
**M4.6** Speaker alignment task: assign each transcript segment the speaker active for the largest overlap
in `speaker_events`; map names to participants; fall back to `unknown` + manual mapping UI (M3.3).
**M4.7** Frontend: "Interviews" page + candidate Interviews tab: schedule an interview, paste a meeting link,
"Send notetaker" button, live bot status chip (Joining → Waiting to be admitted → Recording → Processing → Done),
transcript + notes when done.
*Accept:* end-to-end on a real Google Meet: bot joins, gets admitted, records 10+ minutes, leaves on its own,
and transcript + notes + analysis appear in under 5 minutes after the call ends.

### M5 — Resume ranking & multi-role matching

**M5.1 JD + rubric:** role create/edit gets a full JD and rubric editor; "Suggest rubric from JD" (LLM) that the
user edits and saves.
**M5.2 Bulk resume intake:** `POST /roles/{id}/resumes/bulk` (multiple PDFs/DOCX or a ZIP, ≤ 500 files).
Each file → task: extract text → parse profile → dedupe by email within the org (or by `content_hash`) → create/update candidate.
Progress shown in the UI.
**M5.3 Embeddings:** `app/ai/embeddings.py` (`text-embedding-3-small`, 1536 dims). Embed the role (JD + rubric) and
each resume profile (canonical text: summary + experience + skills + projects). HNSW index on both vector columns.
**M5.4 Two-stage ranking task** `rank_role(role_id)`:
  1. **Shortlist:** cosine similarity over the org's candidates → top `K` (default 50, configurable) → `role_matches(status=shortlisted)`.
  2. **Score:** for each shortlisted candidate, LLM scores each rubric criterion 0–5 **with verbatim evidence quotes from
     the resume** and reasoning; `overall_score = Σ(weight × score/5) × 100`; `must_have_failed` if any must-have scores ≤ 1.
  Re-rank automatically when a resume is added or the rubric changes (debounced).
**M5.5 Cross-role matching:** for each new resume, compute similarity against all *open* roles in the org; surface
"Also a strong fit for: …" on the candidate and on the role ranking page.
**M5.6 Summary card:** per candidate × role — resume fit score + per-criterion bars, interview scores (if interviewed),
claim-check flags (verified / unclear / contradicted), notes excerpt, AI suggestion label
(`Strong yes / Yes / Lean no / No`, captioned "AI suggestion — final decision by your team").
**M5.7 Role ranking page:** ranked list of summary cards, filters (must-haves met, score range, stage, interviewed),
select 2–4 candidates → compare matrix.
**M5.8 Blind review mode** (org setting): hide name, photo, email and university names on ranking/cards until a user reveals them (logged).
*Accept:* ranking 200 resumes for one role completes in < 10 min with total LLM cost shown on the page (from `ai_runs`);
every score shows its evidence quotes.

### M6 — Calendar auto-join
**M6.1** Google Calendar + Microsoft Graph OAuth per user (`calendar_connections` table, encrypted tokens).
**M6.2** Sync every 5 min + push notifications; find events with Meet/Teams/Zoom links whose attendees include a known
candidate email (or that the user tags) → create an `interview` → schedule the bot.
**M6.3** Per-user setting: auto-join all interviews / only tagged ones / never.

### M7 — Microsoft Teams bot
Teams adapter for the same bot (guest join through Teams web; lobby handling; speaker detection from the active-speaker UI).

### M8 — Zoom
Zoom Meeting SDK (Linux) bot, which gives per-participant raw audio and needs Zoom Marketplace approval. Until then, Zoom
users use upload or calendar + manual recording upload.

### M9 — Optional hosted meetings (Jitsi)
Self-hosted Jitsi with JWT auth, rooms `/{org_slug}/{interview_id}`, per-participant audio via Jigasi → transcriber.
Org setting: "Host interviews on Intervue". Lower priority than M4–M7.

### M10 — Compliance, billing, integrations
- **Retention:** nightly job deletes recordings/transcripts older than `organizations.data_retention_days`;
  candidate "delete my data" endpoint; full org data export.
- **Consent:** consent message is mandatory and logged; per-org custom consent text; the candidate invite email
  includes a recording notice.
- **Billing:** Stripe, seat-based plan + metered usage (interview hours, resumes ranked) from `ai_runs` and `recordings`.
- **Integrations:** outbound webhooks (`interview.completed`, `analysis.completed`, `ranking.completed`), public API keys,
  Slack notifications, ATS sync (Greenhouse/Lever/etc. via Merge.dev) — later.

---

## 6. Notetaker bot — detailed spec

### 6.1 Behaviour
1. Created by the backend with env: `BOT_SESSION_ID`, `MEETING_URL`, `BOT_NAME` (default `"Intervue Notetaker"`),
   `CONSENT_MESSAGE`, `CALLBACK_URL`, `CALLBACK_SECRET`, `UPLOAD_PREFIX` (the bot asks the backend for a presigned PUT URL per chunk, so it holds no long-lived cloud credentials),
   `MAX_DURATION_MIN` (default 180), `ADMISSION_TIMEOUT_MIN` (default 10), `ALONE_TIMEOUT_SEC` (default 120).
2. Launches Chromium (headful inside Xvfb, so meeting sites behave normally) with fake media devices: the camera is
   off and the mic is muted.
3. Joins → sends `joining` → if in the lobby, sends `waiting_admission` → on admission sends `in_call`.
4. Posts `CONSENT_MESSAGE` to the meeting chat within 10 s of admission, then sends `consent_sent`.
5. Records the audio of the meeting tab (PulseAudio null sink → ffmpeg → 16 kHz mono Opus, 30 s chunks uploaded as they
   complete, so a crash loses at most 30 s).
6. Observes the active speaker every 250 ms and emits `speaker_events` in batches: `{t_ms, speaker_name}` (relative to recording start).
7. Leaves when: the meeting ends, the bot is removed, the bot is alone for `ALONE_TIMEOUT_SEC`, the max duration is hit, or the backend
   sends a stop request. Then uploads the final chunk + manifest and sends `completed`.
8. On any unrecoverable error: take a screenshot (uploaded for debugging), send `failed` with a reason
   (`admission_timeout`, `blocked_by_host`, `guests_not_allowed`, `meeting_not_found`, `ui_changed`, `crash`).

### 6.2 Platform adapter interface
```ts
interface MeetingAdapter {
  platform: "google_meet" | "teams" | "zoom";
  matches(url: string): boolean;
  join(page: Page, opts: { botName: string }): Promise<void>;
  waitForAdmission(page: Page, timeoutMs: number): Promise<"admitted" | "denied" | "timeout">;
  sendChatMessage(page: Page, text: string): Promise<void>;
  observeActiveSpeakers(page: Page, onEvent: (e: { tMs: number; name: string }) => void): Promise<() => void>;
  participantCount(page: Page): Promise<number>;
  isMeetingEnded(page: Page): Promise<boolean>;
  leave(page: Page): Promise<void>;
}
```
- **All CSS/ARIA selectors for a platform live in one file** (`adapters/google-meet/selectors.ts`), so UI changes are fixed in one place.
  Prefer ARIA roles/labels over class names.
- A **synthetic monitor** (scheduled CI job) joins a test meeting every few hours per platform and alerts when join/record fails.

### 6.3 Callback protocol (bot → backend)
`POST {CALLBACK_URL}/internal/bots/{session_id}/events`, header `X-Signature: hex(hmac_sha256(secret, body))`
```json
{ "type": "status", "status": "in_call", "at": "2026-10-10T10:00:00Z" }
{ "type": "speaker_events", "events": [{ "t_ms": 1250, "name": "Priya Sharma" }] }
{ "type": "chunk_uploaded", "index": 12, "blob": "recordings/<session>/0012.opus" }
{ "type": "completed", "manifest_blob": "recordings/<session>/manifest.json", "duration_ms": 2712000 }
{ "type": "failed", "reason": "admission_timeout", "screenshot_blob": "..." }
```
Backend → bot control: `GET /internal/bots/{session_id}/control` (polled every 5 s) → `{ "action": "none" | "stop" }`.

### 6.4 Post-call pipeline (Celery chain)
`concat_chunks → transcribe (transcriber service) → align_speakers → map_participants → generate_notes → run_analysis → update role_matches/summary card → notify (email/in-app)`

### 6.5 Infrastructure
- Image: `mcr.microsoft.com/playwright` base + Xvfb + PulseAudio + ffmpeg. About 1–2 vCPU and 2 GB RAM per bot.
- `BotLauncher` interface with implementations:
  - `DockerLauncher` (local dev / a single dedicated server): Docker Engine API, one container per session.
  - `EcsLauncher` (AWS): ECS Fargate `RunTask`, one task per session, scales to zero. **Default for production.**
  - `PoolLauncher` (Render, or a fixed server fleet): N always-on bot workers (Render Background Worker with
    instance count = N) that pull sessions from a Redis queue, one meeting per worker at a time. Simpler,
    but you pay for idle workers.
- Concurrency limit per org (plan-based) and globally; queue when exceeded.
- Reference open-source projects to study before building (check licences before copying code): Vexa, Attendee, MeetingBot.

### 6.6 Transcriber service
- `POST /jobs { job_id, audio_url, language: "auto" | "en" | ..., callback_url }` → 202.
- faster-whisper `large-v3` with VAD filter, `word_timestamps=True`. Output segments `{start_ms, end_ms, text, words[], avg_logprob}`.
- Callback with the segments JSON (or a blob path if large). Idempotent by `job_id`.
- Scale on queue depth. A GPU node (e.g. T4/L4) handles about 20–40× real-time.
- **Render has no GPUs.** On Render, run the transcriber CPU-only (`medium`/`small`, int8, about 1–3× real-time,
  fine at low volume), or set `TRANSCRIBER_MODE=api` to send audio to a hosted speech-to-text API. On AWS, run it on GPU
  instances (`g4dn.xlarge` / `g6.xlarge`) in an ECS capacity provider that scales on queue depth. The backend only
  talks to the transcriber through the HTTP contract above, so the backend code is the same in every mode.

---

## 7. Frontend — Material 3 design system

### 7.1 Approach
Follow the **Material Design 3** spec (m3.material.io): color system, typography, shape, elevation, state layers,
motion and component guidelines, implemented **natively in our React + Tailwind 4 + Radix stack**:

- **Do not** adopt `@material/web` (Lit web components) as the component layer. It is in maintenance mode
  (verify on GitHub before revisiting), and web components inside React Server Components and Radix-based overlays add friction.
- **Do not** adopt MUI. It is built on Material Design 2 with partial M3 support, and its styling engine fights Tailwind.
- **Do** use `@material/material-color-utilities` for dynamic color, Radix for accessible behaviour, and `motion`
  (framer-motion) for M3 motion. Existing `nh-*` tokens already use M3 role names, so migration is mostly mechanical.

### 7.2 Tokens (`frontend/app/theme/`)
**Color:** `generateTheme(seedHex)` → `Scheme` light + dark via `material-color-utilities` (scheme variant
`TonalSpot`, or `Expressive` for marketing pages). Emit CSS variables on `:root` / `.dark`:
```
--md-sys-color-primary, on-primary, primary-container, on-primary-container,
secondary(+on/container), tertiary(+on/container), error(+on/container),
surface, on-surface, on-surface-variant, surface-dim, surface-bright,
surface-container-lowest, -low, (base), -high, -highest,
outline, outline-variant, inverse-surface, inverse-on-surface, inverse-primary, scrim, shadow
```
Map them to Tailwind via `@theme inline { --color-primary: var(--md-sys-color-primary); ... }` so classes read
`bg-surface-container-high text-on-surface`. Seed color is an org setting (white-label later).

**Semantic extension colors** (harmonised to the seed with `Blend.harmonize`): `ai` (AI-generated content),
`match-strong`, `match-medium`, `match-weak`, each with `on-*` and `*-container` variants.

**Typography:** font **Roboto Flex** (variable) via `next/font`; M3 type scale as Tailwind utilities:
`display-{l,m,s}`, `headline-{l,m,s}`, `title-{l,m,s}`, `body-{l,m,s}`, `label-{l,m,s}` (size / line-height /
weight / tracking per the M3 spec). Numbers in scores use `tabular-nums`.

**Shape:** `none 0`, `xs 4px`, `sm 8px`, `md 12px`, `lg 16px`, `xl 28px`, `full 9999px`.
Cards `md`, dialogs `xl`, FAB `lg`, chips `sm`, buttons `full`.

**Elevation:** levels 0–5. Express elevation primarily with **surface-container tone** and only lightly with shadow.

**State layers:** an overlay of the content color at hover 8%, focus 10%, pressed 10%, dragged 16%.
Build them as one `.state-layer` utility, plus a ripple on press for buttons, cards, chips and list items.

**Motion tokens:**
```
easing.emphasized            cubic-bezier(0.2, 0, 0, 1)
easing.emphasized-decelerate cubic-bezier(0.05, 0.7, 0.1, 1)
easing.emphasized-accelerate cubic-bezier(0.3, 0, 0.8, 0.15)
easing.standard              cubic-bezier(0.2, 0, 0, 1)
easing.standard-decelerate   cubic-bezier(0, 0, 0, 1)
easing.standard-accelerate   cubic-bezier(0.3, 0, 1, 1)
duration short1-4  50/100/150/200ms   medium1-4 250/300/350/400ms
         long1-4   450/500/550/600ms  extra-long1-4 700/800/900/1000ms
```
Export them from `theme/motion.ts` for `motion` components; also define spring presets (`spatialFast`,
`spatialDefault`, `effects`) tuned to feel like M3 Expressive. Keep spatial springs slightly bouncy and effect springs (opacity/color) critically damped.

### 7.3 Motion patterns (where to use what)
| Pattern | Use for | Implementation |
|---|---|---|
| **Container transform** | candidate card → candidate detail; summary card → expanded card | `motion` shared `layoutId` |
| **Shared axis (X)** | stepper flows (new role, bulk upload), tabs | slide 30px + fade, emphasized easing |
| **Shared axis (Y)** | moving between list and details on mobile | |
| **Fade through** | switching top-level destinations in the nav rail | fade out 90ms → fade in 210ms + scale 0.92→1 |
| **Stagger enter** | ranked lists, kanban columns on load | 30ms stagger, cap 10 items |
| **Skeleton shimmer** | every async load (no spinners for page content) | |
| **Live status** | bot status chip, analysis progress | linear progress + chip color transition |
`prefers-reduced-motion: reduce` replaces spatial motion with opacity-only fades (or none).

### 7.4 Components (`frontend/components/m3/`)
Each component has typed variants (via `cva`), uses tokens only (no raw colors), handles keyboard focus and has a focus ring, and works in both themes.
- **Actions:** Button (`filled`, `tonal`, `outlined`, `text`, `elevated`), IconButton (`standard`, `filled`, `tonal`, `outlined`, toggle),
  FAB + Extended FAB, Segmented button, Split button.
- **Communication:** Badge, Progress (linear + circular, determinate/indeterminate), Snackbar (queue, with action), Tooltip (plain + rich).
- **Containment:** Card (`elevated`, `filled`, `outlined`), Dialog (basic + full-screen on mobile), Bottom sheet, Side sheet, Divider, List + ListItem.
- **Navigation:** Navigation rail, Navigation bar, Navigation drawer (modal), Top app bar (small / medium / large, collapses on scroll), Tabs (primary/secondary).
- **Selection & input:** Chips (assist, filter, input, suggestion), Checkbox, Radio, Switch, Slider, TextField (`filled`, `outlined`),
  Select/Menu, Search bar + search view, Date/time picker (for interview scheduling).
- **Domain components** (built from the above): `ScoreRing`, `CriterionBar`, `ClaimCheckBadge`, `SummaryCard`, `BotStatusChip`,
  `TranscriptViewer` (virtualised, speaker colours, click timestamp → audio seek), `AudioPlayer`, `KanbanColumn`, `CandidateAvatar`.
- **Icons:** Material Symbols Rounded (variable font, `FILL` axis toggled for active states) replaces lucide.
- Add a `/dev/components` gallery route (dev-only) that shows every component in every state, in both themes.

### 7.5 Layout & pages
- **Window size classes:** compact < 600, medium 600–839, expanded 840–1199, large 1200–1599, extra-large ≥ 1600.
  Compact uses the nav bar; medium uses the nav rail; expanded and up use the nav rail plus list-detail panes where useful.
- **Shell:** nav rail (Dashboard, Roles, Candidates, Interviews, Compare) + FAB ("New" → role / candidate / interview / bulk upload);
  top app bar with global search, org switcher, notifications and avatar menu.
- **Dashboard:** open roles with ranking progress, upcoming interviews (with bot toggle), recently completed analyses, AI cost this month (admin).
- **Roles → Role detail:** tabs Ranking (summary cards) · Pipeline (kanban) · Rubric · Settings. The bulk upload drop zone is always visible on Ranking.
- **Candidates (talent pool):** list/grid toggle, filter chips (role, stage, score, source, interviewed), "best matching role" column.
- **Candidate detail:** a hero summary card, then tabs Overview · Resume · Interviews · Analysis · Activity. The Interviews tab
  shows the transcript viewer + notes + audio player + speaker-mapping UI.
- **Interviews:** a calendar/list of scheduled interviews, a "Paste meeting link" dialog, live bot status, history.
- **Compare:** 2–4 candidates side by side, rows = rubric criteria + interview scores + claim checks; highlight the best per row.
- **Settings:** Organization (name, logo, seed color, retention, blind review), Members & invites, Notetaker
  (bot name, consent message, auto-join defaults), Integrations (calendar), Billing, Profile.

### 7.6 Frontend engineering rules
- Read `frontend/AGENTS.md` first (Next.js 16 differs from older versions).
- Data fetching: TanStack Query hooks per resource in `lib/queries/` and a typed API client in `lib/api.ts`.
  Generate TS types from the backend OpenAPI schema (`openapi-typescript`) instead of hand-writing interfaces.
- Server state lives in TanStack Query; Zustand only for UI state (e.g. kanban drag).
- Accessibility: WCAG 2.2 AA, every interactive element reachable by keyboard, visible focus, ARIA live region for bot status.
- Performance: route-level code splitting; virtualise lists over 100 rows; images through `next/image`.

---

## 8. API surface (new / changed, all under auth + org scope)

```
# Org & members
POST   /orgs                         create org (current user becomes admin)
GET    /orgs/me                      orgs the user belongs to
GET    /orgs/{id}/members            POST /orgs/{id}/invitations     DELETE /orgs/{id}/members/{user_id}
PATCH  /orgs/{id}/settings

# Roles & ranking
PATCH  /roles/{id}                   JD, status
GET    /roles/{id}/rubric            PUT /roles/{id}/rubric          POST /roles/{id}/rubric/suggest
POST   /roles/{id}/resumes/bulk      → 202 {batch_id}
GET    /batches/{batch_id}           progress
POST   /roles/{id}/rank              → 202
GET    /roles/{id}/rankings          ranked role_matches + summary card data
GET    /candidates/{id}/matches      the candidate's fit across all open roles

# Interviews & notetaker
POST   /interviews                   GET /interviews?from&to&role_id&candidate_id
GET    /interviews/{id}              (includes participants, bot session, notes)
POST   /interviews/{id}/bot          send notetaker now
DELETE /interviews/{id}/bot          stop notetaker
POST   /interviews/{id}/upload       audio/video/transcript file
GET    /interviews/{id}/transcript   segments (paginated)
PATCH  /interviews/{id}/speakers     map speaker_label → participant
GET    /interviews/{id}/recording    → short-lived presigned URL (audited)

# Analysis
POST   /interviews/{id}/analysis     → 202
GET    /candidates/{id}/summary-card?role_id=

# Internal (HMAC, not exposed through the public gateway)
POST   /internal/bots/{session_id}/events
GET    /internal/bots/{session_id}/control
POST   /internal/transcriber/callback
```
Status codes: `202` for enqueued work, `409` for state conflicts (e.g. bot already in call), `422` validation errors.
Errors use `{ "detail": str, "code": str }`.

---

## 9. AI & quality

- **Prompt versioning:** `app/ai/prompts/<name>_v<N>.py`, and the `prompt_version` is stored on every output row.
- **Evaluation set:** `backend/tests/evals/` holds 20+ anonymised resume/transcript fixtures with expected outcomes
  (e.g. "claim X should be *contradicted*"). `uv run pytest -m eval` runs against the real model (manual / nightly only).
  Run it before changing any prompt or model.
- **Evidence or it didn't happen:** every score and claim check must cite resume quotes or transcript `segment_id`s.
  The UI links each citation to its source.
- **Bias guardrails:** scoring prompts exclude name, gender, age, photo, nationality and university prestige; blind mode (M5.8);
  a periodic report on score distribution by stage for admins.
- **Caching:** never re-run an LLM call for identical input (`content_hash` + `prompt_version` + `model`).
- **Model config:** models are set per purpose in config (`MODEL_RESUME_PARSE`, `MODEL_ANALYSIS`, `MODEL_RANK`,
  `EMBEDDING_MODEL`) so they can be swapped without code changes.

## 10. Security & privacy checklist (applies to every milestone)
- [ ] No public objects (S3 Block Public Access on); presigned URLs ≤ 15 min; recording access audited.
- [ ] Every query is org-scoped; the cross-tenant test suite passes.
- [ ] Internal endpoints verify HMAC and are not routed publicly.
- [ ] Secrets only in env (AWS Secrets Manager / SSM, or Render env groups); OAuth tokens encrypted at rest (Fernet / pgcrypto).
- [ ] Rate limits per user and per org on upload, rank and analysis endpoints.
- [ ] Recording consent message is always sent and logged; it can't be disabled, only re-worded.
- [ ] Retention job runs nightly; candidate data deletion removes blobs too.
- [ ] Uploads: MIME + magic-byte validation, size limits, filename never trusted.

## 11. Definition of done (every PR)
1. Acceptance criteria of the task are met.
2. Tests are added/updated and `uv run pytest` passes; frontend `npm run lint` and `npm run build` pass.
3. Migration included and reversible (if schema changed).
4. New env vars added to `.env.example` and to `config.py`.
5. No raw colors / non-token styles in the frontend; works in light + dark; keyboard accessible.
6. This spec is updated if the implementation deviates from it.

---

## 12. Implementation status & deviations (branch `build/spec-m0-m5`)

**Built:** M0 (all), M1 (all), M2, M3, M4 (backend + bot + transcriber + UI), M5 (all), M6 (calendar auto-join).
**Not built:** M7 Teams, M8 Zoom, M9 Jitsi, M10 retention/consent/export/billing/integrations.
Backend: 485 unit/API tests + 7 PostgreSQL/pgvector integration tests
(`PG_TEST_ADMIN_URL=... uv run pytest -m integration`), all migrations reversible and verified on
real Postgres (`alembic check` clean).

### Deviations from the spec (code is the truth)
| Area | Spec | Implemented |
|---|---|---|
| Enums | Postgres ENUM | `String` columns validated in schemas (avoids enum migrations) |
| Auth transport | cookies **and** bearer in `api.ts` | httpOnly cookies + CSRF via the Next `/api` proxy; `Authorization: Bearer` also accepted (no CSRF) for API clients. Refresh cookie path is `REFRESH_COOKIE_PATH` (`/api/auth` behind the proxy). |
| Email verification | supported | sent and verifiable, **not enforced** for login |
| Rate limiting | per IP + email on login; per user/org on upload/rank/analysis | Redis-backed sliding window with in-process fallback when Redis is unreachable (so limits are per-process in that case) |
| hiring_manager | "assigned to" | no assignment table: sees all org candidates; `interviewer` is scoped to interviews they participate in |
| Bot callback secret | one shared secret | per-session secret derived from `INTERNAL_HMAC_SECRET`; signature is `hex(hmac_sha256(secret, "<ts>." + body))`, 5 min skew; extra endpoint `POST /internal/bots/{id}/upload-url` (presigned PUT, bot holds no cloud credentials) |
| Bot platforms | Meet first | Google Meet only; Teams/Zoom links are rejected with `platform_unsupported` |
| Scheduled bot | ETA task | `bot_sessions.launch_at` + a 30 s Celery beat sweep (restart-safe); capacity over `BOT_CONCURRENCY_*` queues the session |
| Audio/video upload | → transcriber | works via presigned PUT, but Whisper has no diarization: uploaded audio yields one speaker label that must be mapped manually |
| Legacy transcripts | migrate `transcript_path` | candidate transcript upload now creates an `interview(platform=upload)`; `transcript_path` kept as a legacy pointer; the `/transcript-chunks` endpoint and old parser were removed. No data migration script (existing data was declared disposable). |
| Rubric weights | 0..1 | accepted as relative numbers and normalised to sum to 1 on save |
| Ranking universe | org candidates | all embedded resumes in the org, top `RANK_SHORTLIST_K` (50); cross-role similarity floor `CROSS_ROLE_MIN_SIMILARITY` (0.30) is a tunable guess, not calibrated |
| AI suggestion label | unspecified | interview recommendation wins, else resume score (≥80 Strong yes, ≥65 Yes, ≥45 Lean no, else No); failed must-have caps at Lean no; each high-severity contradicted claim lowers one step (`card_service.suggest`) |
| Evidence | cite or it didn't happen | enforced in code: resume quotes must appear verbatim in the redacted resume (else score capped at 1); analysis points must cite real **candidate** segment ids (else dropped); claim verdicts without a cited candidate line become `unclear` |
| Notifications | email / in-app | email only (in-app notifications not built) |
| New tables | — | `jobs` (async status), `intake_batches`, `candidate_reveals`; extra columns `ai_runs.{cache_key,result,job_id}`, `resume_profiles.raw_text`, `bot_sessions.launch_at` |
| Extra endpoints | — | `GET /dashboard/summary`, `GET /orgs/{id}/usage` (admin), `GET /candidates/{id}/activity`, `GET /roles/{id}/compare`, `POST /candidates/{id}/reveal`, `/interviews/{id}/recording-upload[/complete]`, `/interviews/{id}/cancel` |
| Backend image | — | needs `ffmpeg` (chunk concat in the post-call pipeline) |
| Calendar scopes | read events | Google `calendar.events.readonly`, Microsoft `Calendars.Read` (read-only, never write). Google classes the Google scope as *sensitive*: production needs Google's OAuth app verification, and until then unverified apps show a warning and are capped at 100 users. |
| Calendar sync | sync every 5 min + push | polling window is the next 14 days (no incremental sync tokens); push (Google channels, Graph subscriptions) only activates when `PUBLIC_API_URL` is a public https URL, and is renewed hourly; webhooks are authenticated with a per-connection secret |
| Calendar auto-join | all / tagged / never | connections are strictly personal (even admins cannot see another user's); `never` still creates interviews; the bot is scheduled 1 min before start, launched immediately if the meeting is already in progress, never auto-retried after a failure, and skipped for Teams/Zoom links and for `interviewer`-role owners |
| Calendar tags | tag an event | tagging an event with no matched candidate requires choosing one; deleting a connection cancels not-yet-launched bots it scheduled but keeps the interviews |

### Not verified end-to-end (needs real accounts / hardware)
Real Google/Microsoft calendar OAuth and push delivery (the calendar adapters are tested against a fake provider only; also needs OAuth clients with the callback URIs registered). A real Google Meet join (selectors and the active-speaker heuristic were only tested against HTML
fixtures); real OpenAI calls (all LLM paths are tested with mocks; prompts are untuned — run the
eval set before relying on scores); Docker image builds for the bot and transcriber on GPU; Render
blueprint and Terraform skeleton were not deployed/applied.
