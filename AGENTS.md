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

## Repo-Specific Notes

- `apps/api/Program.cs` is currently a single-file ASP.NET Core minimal API. Keep endpoint, DTO, persistence, and worker-proxy changes easy to trace unless a refactor is explicitly requested.
- `apps/web/lib/api.ts` is the frontend contract hub. Update it whenever API request or response shapes change.
- `apps/web/app/page.tsx` contains the main command center and some demo-enhancement fallback logic. Do not treat frontend demo fallback data as persisted backend behavior.
- `apps/web/components/structured` owns structured card rendering and suggested-action controls.
- `apps/ai-worker/main.py`, `apps/ai-worker/app/orchestration`, `apps/ai-worker/app/tools`, and `apps/ai-worker/rag` own mock AI behavior, RAG, tools, structured outputs, citations, and retrieval.

## Contract Hotspots

When changing chat, tools, memory, documents, or structured cards, check all relevant layers:

- C# request/response records in `apps/api/Program.cs`
- Python Pydantic models in `apps/ai-worker/main.py`
- TypeScript types and API helpers in `apps/web/lib/api.ts`
- Renderers in `apps/web/components/structured`
- Database schema and seed data in `db/init.sql`

Keep these fields especially aligned across services: `citations`, `toolCalls`, `structuredOutput`, `suggestedActions`, `conversationId`, `campaignId`, and `sessionId`.

Suggested action names are consumed by the frontend and are case-sensitive. Current examples include `saveNPC`, `saveQuest`, `saveLocation`, `saveEncounter`, `saveSessionSummary`, and `prompt`.

## Database and RAG

- Main schema and seed data live in `db/init.sql`.
- The API also calls startup RAG schema compatibility code. If changing RAG tables or document/chunk behavior, update both `db/init.sql` and the API startup compatibility path when needed.
- Keep pgvector dimensions aligned with the embedding model. The current schema uses `vector(1536)` for `text-embedding-3-small`.
- Preserve campaign scoping on memory, documents, chunks, conversations, messages, and tool calls.
- Keep mock embeddings deterministic unless the user explicitly asks to wire or test a real provider.

## Useful Commands

Makefile shortcuts:

```bash
make up
make down
make logs
make reset-db
make test
make build
make health
```

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

Local worker tests without Docker, from `apps/ai-worker`:

```bash
python -m unittest discover -s tests
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
