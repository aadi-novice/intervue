# Intervue Frontend

Next.js frontend for the Intervue recruiting workspace.

## Current Scope

The frontend is wired to the FastAPI backend for the main local-development flows.

Implemented pages:

- landing page
- dashboard
- talent pool
- kanban pipeline
- candidate detail
- add candidate
- compare candidates
- post role
- settings placeholder

Implemented interactions:

- fetch live roles and candidates from the backend
- create roles
- create candidates
- upload resume, transcript, and avatar files
- trigger candidate analysis
- update candidate stage from the pipeline
- delete roles and candidates
- compare two candidates within the same role

## Stack

- Next.js 16
- React 19
- Tailwind CSS 4
- Framer Motion
- Zustand
- Radix-based UI primitives
- Lucide icons

## App Layout

```text
app/
|-- dashboard/         dashboard, pipeline, talent pool
|-- candidate/         create and detail pages
|-- compare/           candidate comparison flow
|-- roles/             role creation flow
|-- settings/          placeholder settings UI
`-- layout.tsx         app shell and shared layout
```

## API Integration

The frontend uses `lib/api.ts` as a thin fetch client for:

- roles
- candidates
- analysis

Current assumption:

- backend base URL is hardcoded to `http://localhost:8000`

Start the backend before running the frontend or most pages will load without data.

## Run Locally

1. Install dependencies:

```bash
npm install
```

2. Start the dev server:

```bash
npm run dev
```

3. Open:

```text
http://localhost:3000
```

## UI Notes

- dashboard metrics are derived from live API data where available
- pipeline uses drag-and-drop with persisted status updates
- candidate detail can upload files, trigger analysis, and render structured resume + interview analysis results
- comparison uses live candidate detail payloads, including analysis scores and parsed resume metadata
- settings is present as a UI shell only and is not backed by API functionality

## Current Limitations

- no environment-based frontend API configuration yet
- no auth or protected routes
- limited error handling/retry states
- some UI copy still sounds more automated than the backend actually is; analysis is manually triggered today
