# Intervue

Intervue is an AI-assisted recruiting workspace with a FastAPI backend, a PostgreSQL + `pgvector` database, and a Next.js frontend for role management, candidate intake, pipeline tracking, and interview analysis.

The repository is no longer just a UI prototype. The frontend is wired to the backend for the main recruiting flows, and the backend now persists candidate analyses plus structured resume profiles.

## Current Product Surface

Implemented today:

- role creation, listing, and guarded deletion
- candidate creation, listing, detail retrieval, stage updates, and deletion
- resume, transcript, and avatar uploads with local file storage
- manual AI analysis for candidates with both resume and transcript uploaded
- lazy resume parsing with cached structured profile persistence
- dashboard, talent pool, kanban pipeline, candidate profile, compare, role creation, candidate creation, and settings pages

Still incomplete:

- authentication and multi-user workspace support
- production-grade settings/config management
- background jobs and async AI processing
- object storage for uploaded files
- automated test coverage
- deployment hardening and observability

## Architecture

### Backend

- FastAPI
- SQLAlchemy 2.x
- Alembic
- PostgreSQL 16 + `pgvector`
- Python 3.11+
- `uv`
- OpenAI API for resume parsing and candidate analysis
- PyMuPDF for PDF text extraction

### Frontend

- Next.js 16
- React 19
- Tailwind CSS 4
- Framer Motion
- Radix-based UI primitives
- Zustand for pipeline state

## Repository Layout

```text
intervue/
|-- backend/                FastAPI app, models, migrations, AI flows
|-- frontend/               Next.js recruiter workspace
|-- docker-compose.yml      Local PostgreSQL + pgvector
`-- README.md
```

## Main Flows

### Roles

- create a role
- list roles
- delete a role if no candidates are assigned

### Candidates

- create a candidate with name, email, phone, and role
- list all candidates in pipeline-friendly format
- fetch full candidate detail
- update candidate stage
- delete candidate and cascaded analysis/profile records
- upload resume PDF
- upload transcript text file
- upload avatar image

### AI

- `POST /analysis/candidates/{candidate_id}` runs interview analysis
- `GET /candidates/{candidate_id}` lazily parses the resume into a structured `resume_profiles` record if one does not exist yet
- analysis currently requires both resume and transcript files
- AI features require `OPENAI_API_KEY`

## API Snapshot

Routers currently mounted:

- `GET /`
- `POST /roles/`
- `GET /roles/`
- `DELETE /roles/{role_id}`
- `POST /candidates/`
- `GET /candidates/`
- `GET /candidates/{candidate_id}`
- `GET /candidates/role/{role_id}`
- `PATCH /candidates/{candidate_id}/status`
- `DELETE /candidates/{candidate_id}`
- `POST /candidates/{candidate_id}/resume`
- `POST /candidates/{candidate_id}/transcript`
- `POST /candidates/{candidate_id}/avatar`
- `GET /candidates/{candidate_id}/resume-text`
- `GET /candidates/{candidate_id}/transcript-chunks`
- `POST /analysis/candidates/{candidate_id}`

Uploaded files are served from:

- `/storage`

## Local Development

### 1. Start PostgreSQL

From the repo root:

```bash
docker compose up -d
```

### 2. Configure backend env

Create `backend/.env`:

```env
DATABASE_URL=postgresql://intervue:intervue123@localhost:5432/intervue_db
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4.1-mini
```

`OPENAI_MODEL` is optional; the backend defaults to `gpt-4.1-mini`.

### 3. Install backend dependencies

From `backend/`:

```bash
uv sync
```

### 4. Apply migrations

From `backend/`:

```bash
uv run alembic upgrade head
```

### 5. Run the backend

From `backend/`:

```bash
uv run fastapi dev app/main.py
```

Alternative:

```bash
uv run uvicorn app.main:app --reload
```

Backend URLs:

- API: `http://127.0.0.1:8000`
- Swagger UI: `http://127.0.0.1:8000/docs`

### 6. Run the frontend

From `frontend/`:

```bash
npm install
npm run dev
```

Frontend URL:

- `http://localhost:3000`

Note: the frontend API client is currently hardcoded to `http://localhost:8000`.

## Database Notes

The schema now includes:

- `roles`
- `candidates`
- `analyses`
- `resume_profiles`

Candidate records also store:

- `phone`
- `status`
- `resume_path`
- `transcript_path`
- `avatar_path`

Analysis records store:

- summary
- strengths and weaknesses
- technical, communication, and confidence scores
- key moments
- resume-to-transcript alignment findings

## Important Behavior

- Candidate analysis is manually triggered through the analysis endpoint or the candidate detail UI.
- Resume parsing is triggered on first candidate-detail fetch when a resume exists but no cached `resume_profiles` row exists yet.
- Uploaded files are stored on the local filesystem under `storage/`.
- CORS is currently configured for `http://localhost:3000`.

## Status Summary

Intervue now has a working end-to-end recruiting workflow for local development: create roles, add candidates, upload documents, run AI analysis, inspect candidate profiles, move candidates through the pipeline, and compare candidates within a role. The main remaining work is around production readiness rather than basic feature existence.
