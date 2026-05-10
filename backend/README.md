# Intervue Backend

FastAPI backend for the Intervue recruiting platform.

## Scope Today

Implemented:

- role creation and listing
- candidate creation and listing by role
- resume upload
- transcript upload
- PostgreSQL persistence via SQLAlchemy
- Alembic migration history

Scaffolded but not yet implemented end-to-end:

- AI extraction and summarization
- candidate analysis workflows
- embeddings and semantic comparison
- service-layer orchestration

## Stack

- FastAPI
- SQLAlchemy 2.x
- Alembic
- PostgreSQL
- `pgvector`
- Python 3.11+
- `uv`

## App Layout

```text
app/
|-- ai/         AI modules and future ranking/extraction logic
|-- api/        HTTP routes
|-- db/         database base, engine, session dependencies
|-- models/     SQLAlchemy models
|-- schemas/    Pydantic request and response models
|-- services/   business logic layer
|-- utils/      shared utilities
`-- main.py     FastAPI entrypoint
```

## Run Locally

1. Start PostgreSQL from the repository root:

```bash
docker compose up -d
```

2. Create `backend/.env`:

```env
DATABASE_URL=postgresql://intervue:intervue123@localhost:5432/intervue_db
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

Swagger UI:

- `http://127.0.0.1:8000/docs`

## Current Routes

- `GET /`
- `POST /roles/`
- `GET /roles/`
- `POST /candidates/`
- `GET /candidates/role/{role_id}`
- `POST /candidates/{candidate_id}/resume`
- `POST /candidates/{candidate_id}/transcript`

## Notes

- Uploaded files are currently stored on the local filesystem.
- API logic still lives mostly in route handlers.
- Several AI and service modules exist as placeholders for the next implementation phase.
