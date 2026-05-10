# Intervue

Intervue is an AI-assisted recruiting platform in active development. The repository currently contains a functional FastAPI backend for role and candidate management, a PostgreSQL + `pgvector` database setup, and a polished Next.js frontend prototype that models the intended hiring workflow.

This README documents the project as it exists today, with emphasis on the implemented backend surface and the current delivery status.

## Current Status

The codebase is in an early product-build phase.

Implemented today:

- FastAPI application bootstrapped and running
- PostgreSQL setup via Docker Compose
- SQLAlchemy models and Alembic migration history
- Role creation and role listing APIs
- Candidate creation and candidate listing by role
- Resume and transcript upload endpoints with local file persistence
- Frontend product prototype covering dashboard, candidate intake, pipeline, and comparison flows

Partially scaffolded or not yet wired end-to-end:

- AI extraction, summarization, comparison, and embeddings modules
- Analysis and interview domain models
- Service layer orchestration
- Persistent frontend-to-backend integration
- Automated tests, auth, background jobs, and production hardening

## Product Direction

Intervue is being built as a recruiter workflow system that combines:

- role intake and hiring pipeline management
- candidate profile ingestion
- resume and transcript processing
- AI-assisted scoring, comparison, and insights

The current backend supports the foundational data model for roles and candidates. The frontend already reflects the intended UX for a richer AI recruitment workflow, but much of that experience is still backed by static/demo data rather than live API integrations.

## Repository Layout

```text
intervue/
|-- backend/                FastAPI application, database models, migrations
|-- frontend/               Next.js application and product prototype UI
|-- docker-compose.yml      Local PostgreSQL + pgvector setup
`-- README.md               Project status and setup documentation
```

## Architecture Snapshot

### Backend

- Framework: FastAPI
- ORM: SQLAlchemy 2.x
- Migrations: Alembic
- Database: PostgreSQL 16 with `pgvector`
- Runtime: Python 3.11+
- Dependency management: `uv`

### Frontend

- Framework: Next.js 16 / React 19
- Styling: Tailwind CSS 4
- UI/animation: custom components, Radix ecosystem, Framer Motion
- State/data utilities: Zustand, TanStack Query

## Backend Structure

```text
backend/
|-- app/
|   |-- ai/                 AI-related modules (currently scaffolded)
|   |-- api/                FastAPI routers
|   |-- db/                 SQLAlchemy base, session, dependencies
|   |-- models/             ORM models
|   |-- schemas/            Pydantic request/response schemas
|   |-- services/           Business/service layer (mostly scaffolded)
|   |-- utils/              Shared helpers such as file persistence
|   `-- main.py             FastAPI entrypoint
|-- alembic/                Migration environment and revisions
|-- alembic.ini
|-- pyproject.toml
`-- uv.lock
```

## Implemented Backend Domains

### Roles

The `roles` domain is implemented and supports:

- creating a role
- listing all roles
- storing seniority metadata

Persisted fields:

- `id`
- `name`
- `experience_level`
- `experience_required_years`
- `created_at`

### Candidates

The `candidates` domain is implemented and supports:

- creating a candidate against an existing role
- listing candidates for a specific role
- uploading a resume file
- uploading a transcript file

Persisted fields:

- `id`
- `name`
- `email`
- `status`
- `role_id`
- `resume_path`
- `transcript_path`
- `created_at`

## API Surface

Current API routers:

- `/` health-style root route
- `/roles`
- `/candidates`

### Root

`GET /`

Returns a simple service confirmation payload.

### Roles

`POST /roles/`

Create a new role.

Example request:

```json
{
  "name": "Senior Backend Engineer",
  "experience_level": "senior",
  "experience_required_years": 5
}
```

`GET /roles/`

Returns all stored roles.

### Candidates

`POST /candidates/`

Create a candidate linked to an existing role.

Example request:

```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "role_id": 1
}
```

`GET /candidates/role/{role_id}`

Returns all candidates associated with the given role.

`POST /candidates/{candidate_id}/resume`

Uploads a resume file and stores its local path on the candidate record.

`POST /candidates/{candidate_id}/transcript`

Uploads a transcript file and stores its local path on the candidate record.

## Database and Migrations

The repository includes Docker Compose for local PostgreSQL with `pgvector`.

Defined database container:

- image: `pgvector/pgvector:pg16`
- database: `intervue_db`
- user: `intervue`

Alembic revision history shows the schema evolving through:

- initial roles and candidates tables
- candidate status and timestamps
- role experience fields

Some migration files are currently placeholders with `pass`, which is acceptable for an in-progress codebase but should be cleaned up before a production release.

## Local Development

### 1. Start the database

From the repository root:

```bash
docker compose up -d
```

### 2. Configure backend environment

Create `backend/.env` with:

```env
DATABASE_URL=postgresql://intervue:intervue123@localhost:5432/intervue_db
```

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

The API will then be available locally at:

- `http://127.0.0.1:8000`
- Swagger UI: `http://127.0.0.1:8000/docs`

### 6. Run the frontend

From `frontend/`:

```bash
npm install
npm run dev
```

## Current Engineering Notes

The backend is intentionally simple right now. A few implementation details are worth calling out:

- File uploads are written to local storage directories under `storage/`
- Database sessions are managed through FastAPI dependency injection
- The API currently performs CRUD-style operations directly in router modules
- Service and AI layers exist in the repository, but most of those files are still empty scaffolding

This means the system is best described as a working backend foundation, not a production-complete platform.

## Known Gaps

The following items are still missing or incomplete:

- authentication and authorization
- request validation beyond the current schema layer
- centralized settings/config management
- structured logging and observability
- test coverage
- background processing for AI/file workflows
- cloud/object storage for uploaded documents
- robust error handling and transactional service boundaries
- frontend integration against live backend endpoints
- implemented AI ranking, extraction, and comparison pipeline

## Recommended Next Milestones

To move the backend toward production readiness, the highest-leverage next steps are:

1. Introduce a proper configuration layer and environment settings module.
2. Move router logic into service functions with clearer transaction boundaries.
3. Implement analysis and interview persistence models fully.
4. Replace local file storage with object storage abstraction.
5. Wire the frontend forms to the live backend APIs.
6. Add test coverage for migrations, schemas, and API routes.
7. Implement the AI workflow incrementally behind explicit service boundaries.

## Positioning Summary

Intervue already has the shape of a real recruiting platform:

- a credible UI prototype
- a working database-backed FastAPI core
- a schema and migration foundation
- early hooks for AI-assisted evaluation

At the same time, it is still accurately a work-in-progress backend foundation rather than a finished production system. The current implementation is strong enough for continued feature development, integration work, and architecture hardening.
