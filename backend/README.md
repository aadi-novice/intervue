# Intervue Backend

FastAPI backend for the Intervue recruiting workspace.

## Current Scope

Implemented:

- role creation, listing, and guarded deletion
- candidate creation, listing, detail retrieval, stage updates, and deletion
- resume PDF upload
- transcript text upload
- avatar image upload
- manual AI analysis for candidates
- structured resume profile extraction with DB caching
- PostgreSQL persistence via SQLAlchemy
- Alembic migrations
- static serving of uploaded files under `/storage`

Not implemented yet:

- auth
- background jobs
- cloud file storage
- tests
- production-grade config and observability

## Stack

- FastAPI
- SQLAlchemy 2.x
- Alembic
- PostgreSQL
- `pgvector`
- Python 3.11+
- `uv`
- OpenAI Python SDK
- PyMuPDF

## App Layout

```text
app/
|-- ai/         OpenAI-backed parsing, comparison, summarization, transcript helpers
|-- api/        HTTP routes
|-- db/         engine, base, sessions, dependencies
|-- models/     SQLAlchemy models
|-- schemas/    request and response models
|-- services/   analysis orchestration
|-- utils/      file handling and shared helpers
`-- main.py     FastAPI entrypoint
```

## Current Routes

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

## AI Behavior

### Candidate analysis

`POST /analysis/candidates/{candidate_id}`:

- requires an existing candidate
- requires both `resume_path` and `transcript_path`
- extracts resume text from PDF
- loads and chunks transcript text
- generates summary, strengths, weaknesses, scores, and key moments
- compares resume claims against interview transcript
- persists an `analyses` row

### Resume profile extraction

`GET /candidates/{candidate_id}`:

- returns candidate detail plus latest analysis if available
- checks for a cached `resume_profiles` row
- if missing and a resume exists, parses the resume with OpenAI and stores the structured profile
- serves the cached profile on later requests

## Data Model Notes

Core tables currently used by the app:

- `roles`
- `candidates`
- `analyses`
- `resume_profiles`

Candidate rows include:

- identity fields
- role association
- pipeline status
- resume/transcript/avatar paths
- created timestamp

Analysis rows include:

- summary
- strengths
- weaknesses
- key moments
- resume alignment findings
- technical, communication, and confidence scores

## Run Locally

1. Start PostgreSQL from the repo root:

```bash
docker compose up -d
```

2. Create `backend/.env`:

```env
DATABASE_URL=postgresql://intervue:intervue123@localhost:5432/intervue_db
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4.1-mini
```

3. Install dependencies:

```bash
uv sync
```

4. Apply migrations:

```bash
uv run alembic upgrade head
```

5. Start the API:

```bash
uv run fastapi dev app/main.py
```

Alternative:

```bash
uv run uvicorn app.main:app --reload
```

Swagger UI:

- `http://127.0.0.1:8000/docs`

## Notes

- Uploaded files are written to local `storage/` directories.
- CORS currently allows `http://localhost:3000`.
- The delete role endpoint blocks deletion when candidates are still assigned.
- Candidate deletion cascades to analysis and resume-profile records at the ORM level.
- The current API structure is still simple and mostly synchronous by design.
