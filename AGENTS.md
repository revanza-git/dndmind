# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project Overview

DNDMind is an AI Dungeon Master co-pilot built as a small full-stack system:

- `apps/web`: Next.js, React, Tailwind CSS command center UI.
- `apps/api`: ASP.NET Core 8 Web API that owns campaign data, chat persistence, and worker proxying.
- `apps/ai-worker`: Python FastAPI worker for mock LLM responses, RAG ingestion/search, campaign memory, structured outputs, and tool orchestration.
- `db`: PostgreSQL schema, seed material, and pgvector-backed knowledge storage.
- `docs`: Architecture and phase notes.

The default local path is mock-first. Keep `MOCK_LLM=true` and `MOCK_EMBEDDINGS=true` unless the user explicitly asks to wire or test a real provider.

## Working Rules

- Preserve the existing service boundaries: UI talks to the API, API talks to Postgres and the worker, worker handles AI/RAG/tool logic.
- Prefer the existing patterns in each app before adding new abstractions.
- Keep changes tightly scoped to the request. Avoid unrelated cleanup, generated file churn, or broad refactors.
- Do not edit generated or dependency output unless the user specifically asks:
  - `apps/web/node_modules`
  - `apps/api/bin`
  - `apps/api/obj`
- Keep secrets out of the repo. Use `.env.example` for documented configuration only.
- When changing data contracts, update all affected layers together: API models, worker schemas, frontend types, database schema or seeds, and README/docs if needed.

## Useful Commands

Run the full stack:

```bash
docker compose up --build
```

Worker tests:

```bash
docker compose exec ai-worker python -m unittest discover -s tests
```

API build:

```bash
dotnet build apps/api/DNDMind.Api.csproj
```

Frontend build:

```bash
cd apps/web
npm run build
```

Health checks after the stack is running:

- Web UI: `http://localhost:3000`
- API health: `http://localhost:8080/api/health`
- Worker health: `http://localhost:8001/health`

## Autoreview Before Finishing

Before handing work back, perform a focused self-review. Lead with bugs and user-visible risk, not style nits.

Check the diff for:

- Correctness: the requested behavior is implemented end to end and does not silently skip any service layer.
- Contracts: request/response shapes, database fields, TypeScript types, C# records/classes, and Python schemas still agree.
- Persistence: writes are intentional, IDs and campaign/session scoping are respected, and SQL handles missing data safely.
- AI/RAG behavior: mock mode remains deterministic, citations stay attached to retrieved context, and tool calls are persisted when expected.
- Frontend state: loading, empty, error, and save/update states remain usable without overlapping UI or stale data.
- Security: no secrets, no unsafe SQL string interpolation, no trust in browser-supplied campaign or tool data without API validation.
- Docker/local setup: changed ports, env vars, build contexts, or health checks are reflected in docs and compose config.
- Generated files: dependency folders, build output, lockfiles, and snapshots changed only when necessary.

Then run the smallest meaningful verification for the change:

- Worker logic: `python -m unittest discover -s tests` from `apps/ai-worker`, or the Docker Compose equivalent.
- API changes: `dotnet build apps/api/DNDMind.Api.csproj`.
- Web changes: `npm run build` from `apps/web`.
- Cross-service changes: `docker compose up --build` plus the relevant health checks or manual flow.

If a verification command cannot be run, say why in the final response and describe the remaining risk.

## Review Response Format

When asked to review changes, use this order:

1. Findings first, ordered by severity, with file and line references.
2. Open questions or assumptions.
3. Brief change summary only after the findings.
4. Tests or verification performed, including anything skipped.

If there are no findings, say so directly and mention any remaining test gaps.
