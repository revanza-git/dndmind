# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project Overview

DNDMind is an AI Dungeon Master co-pilot built as a small full-stack system:

- `apps/web`: Next.js, React, Tailwind CSS command center UI.
- `apps/api`: ASP.NET Core 8 Web API that owns campaign data, chat persistence, and worker proxying.
- `apps/ai-worker`: Python FastAPI worker for mock or provider-backed LLM responses, RAG ingestion/search, campaign memory, structured outputs, and tool orchestration.
- `db`: PostgreSQL schema, seed material, and pgvector-backed knowledge storage.
- `docs`: Architecture and phase notes.

The default local path is mock-first. Keep `MOCK_LLM=true` and `MOCK_EMBEDDINGS=true` unless the user explicitly asks to wire or test a real provider.

Real provider support is available behind explicit configuration. Chat currently supports Gemini API-key mode via `LLM_PROVIDER=gemini` and Vertex AI Gemini via `LLM_PROVIDER=vertex`. Embeddings can use Gemini or OpenAI when `MOCK_EMBEDDINGS=false`. Keep pgvector dimensions and provider embedding dimensions aligned.

## Working Rules

- Preserve the existing service boundaries: UI talks to the API, API talks to Postgres and the worker, worker handles AI/RAG/tool logic.
- Prefer the existing patterns in each app before adding new abstractions.
- Keep changes tightly scoped to the request. Avoid unrelated cleanup, generated file churn, or broad refactors.
- Do not edit generated or dependency output unless the user specifically asks:
  - `apps/web/node_modules`
  - `apps/api/bin`
  - `apps/api/obj`
- Keep secrets out of the repo. Use `.env.example` for documented configuration only. Local `.gcloud/` files and Application Default Credentials are credentials and must remain ignored/uncommitted.
- When changing data contracts, update all affected layers together: API models, worker schemas, frontend types, database schema or seeds, and README/docs if needed.
- Preserve browser-owned data scoping. The frontend sends `X-Dndmind-Client-Id`, the API maps it to `clientOwnerId`, and session/memory writes should remain scoped by both campaign and client owner where applicable.

## Repo-Specific Notes

- `apps/api/Program.cs` is currently a single-file ASP.NET Core minimal API. Keep endpoint, DTO, persistence, and worker-proxy changes easy to trace unless a refactor is explicitly requested.
- `apps/web/lib/api.ts` is the frontend contract hub. Update it whenever API request or response shapes change.
- `apps/web/app/page.tsx` contains the main command center and some demo-enhancement fallback logic. Do not treat frontend demo fallback data as persisted backend behavior.
- `apps/web/components/structured` owns structured card rendering and suggested-action controls.
- `apps/ai-worker/main.py`, `apps/ai-worker/app/orchestration`, `apps/ai-worker/app/tools`, and `apps/ai-worker/rag` own mock/provider AI behavior, RAG, tools, structured outputs, citations, and retrieval.
- Vertex AI chat mode depends on `google-auth`, `VERTEX_PROJECT_ID`, `VERTEX_LOCATION`, `VERTEX_MODEL`, and optional in-container `GOOGLE_APPLICATION_CREDENTIALS`; keep `.env.example`, `docker-compose.yml`, README, and deployment docs aligned when changing provider setup.
- `apps/ai-worker/app/orchestration/image_generation.py` owns optional structured-card image generation for NPC, character, and encounter cards. Keep it mock-first and deterministic by default with `IMAGE_GENERATION_ENABLED=false` and `IMAGE_PROVIDER=mock`; real image providers require explicit opt-in through Gemini API-key or Vertex ADC configuration. Keep `IMAGE_ASPECT_RATIO` documented in `.env.example`, `docker-compose.yml`, README, and deployment docs when changing image framing behavior.

## Contract Hotspots

When changing chat, tools, memory, documents, sessions, party data, or structured cards, check all relevant layers:

- C# request/response records in `apps/api/Program.cs`
- Python Pydantic models in `apps/ai-worker/main.py`
- TypeScript types and API helpers in `apps/web/lib/api.ts`
- Renderers in `apps/web/components/structured`
- Database schema and seed data in `db/init.sql`

Keep these fields especially aligned across services: `citations`, `toolCalls`, `structuredOutput`, `suggestedActions`, `conversationId`, `campaignId`, `sessionId`, `clientOwnerId`, and the `X-Dndmind-Client-Id` header.

Campaign `systemTone` is a guarded style hint only. Keep it aligned across campaign API models, frontend campaign forms/types, mock prompts, and provider prompts, and do not let it override scope, grounding, citation behavior, tool results, mode handling, or structured output requirements.

Campaigns support soft archive via `archivedAt` / `archived_at`. Default campaign reads should exclude archived campaigns unless explicitly using archive or restore flows.

Campaign memory includes encounters. Structured encounter saves persist both an encounter row and a campaign-memory document tagged with `memoryType: "encounter"` and `clientOwnerId`; keep encounter contracts aligned across API, worker structured outputs, frontend types/renderers, and `db/init.sql`.

Structured-card image fields such as `imageUrl`, image prompts, and image metadata must stay aligned across worker schemas, API save validation, frontend structured renderers, and persisted memory metadata.

Suggested action names are consumed by the frontend and are case-sensitive. Current examples include `saveNPC`, `saveQuest`, `saveLocation`, `saveEncounter`, `saveSessionSummary`, and `prompt`.

## Database and RAG

- Main schema and seed data live in `db/init.sql`.
- The API also calls startup RAG schema compatibility code. If changing RAG tables or document/chunk behavior, update both `db/init.sql` and the API startup compatibility path when needed.
- Keep pgvector dimensions aligned with the embedding model. The current schema uses `vector(1536)` for `text-embedding-3-small`.
- Uploaded document text is sanitized and capped in `apps/ai-worker/rag/sanitizer.py` before chunking and embedding. If changing ingestion behavior, keep sanitizer tests updated and avoid storing unsafe or unbounded upload content.
- Preserve campaign scoping on memory, documents, chunks, conversations, messages, and tool calls.
- Preserve client-owner scoping on sessions and campaign memory entities such as NPCs, quests, locations, encounters, and memory events.
- Demo campaign memory is seeded per browser client owner. Preserve `DemoClientOwnerId` copy-on-first-access behavior when changing demo data or client-owner scoping.
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
