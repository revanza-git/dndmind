# DNDMind — AI Dungeon Master Co-Pilot

An AI-powered Dungeon Master command center for tabletop RPG campaigns, built to demonstrate full-stack LLM application engineering.

DNDMind is a mock-first full-stack AI product for running and reviewing long-lived tabletop campaigns. It combines campaign data, campaign knowledge retrieval, session memory, structured AI outputs, deterministic tools, domain-scoped chat behavior, and evaluation workflows in one local Docker Compose demo.

## Problem

Dungeon Masters need to manage rules, campaign continuity, party context, session memory, NPCs, quests, encounters, dice rolls, and summaries across long-running campaigns. That context is usually scattered across notes, books, chat logs, and improvised table decisions.

## Solution

DNDMind combines Campaign Knowledge RAG, campaign memory, campaign lifecycle controls, guarded response tone, prompt suggestions, structured output, optional structured-card images, context-aware tool calling, scope guarding, and deterministic evals into one command-center interface. The default path uses `MOCK_LLM=true` and `MOCK_EMBEDDINGS=true`, so the project can be reviewed locally without paid API usage or external model calls.

## Architecture

```mermaid
flowchart LR
  Web[Next.js Frontend]
  API[ASP.NET Core API]
  Worker[FastAPI AI Worker]
  DB[(PostgreSQL + pgvector)]
  Model[Gemini API, Vertex AI Gemini, or Mock LLM]

  Web -->|browser HTTP| API
  API -->|campaign, chat, memory| DB
  API -->|AI context| Worker
  Worker -->|RAG search| DB
  Worker -->|chat, summaries, suggestions, optional images| Model
  Worker -->|answer, citations, tools, cards| API
  API --> Web
```

The frontend renders the DM command center, Campaign menu, Campaign Knowledge library, prompt suggestion controls, downloadable templates, and local browser profile header for browser-owned sessions. The API owns campaign lifecycle, party management, upload validation, chat persistence, memory writes, demo seed hydration, and worker proxying. The AI worker handles prompt orchestration, guarded campaign tone, scope guarding, upload sanitization, RAG, prompt suggestions, structured output, optional card image generation, context-aware tool execution, and mock, Gemini API-key, or Vertex AI provider calls. PostgreSQL stores campaign entities, archive state, messages, memory, knowledge chunks, party history, and pgvector embeddings.

## Key Features

- Campaign create/edit/archive/restore management
- Party management
- AI command center chat
- Prompt suggestion spark for the selected mode and campaign context
- Guarded campaign response tone
- Campaign Knowledge library with `.txt` and `.md` templates
- Rules and Homebrew RAG with citations
- Campaign memory RAG, including saved encounters
- Session notes and summarization
- Tabletop RPG scope guard with helpful redirect actions
- NPC, character, quest, location, encounter, dice roll, initiative, recap, and summary structured cards
- Optional NPC, character, and encounter image generation with deterministic local placeholders
- Context-aware tool calling with persisted traces
- Dice roller
- Encounter difficulty calculator
- Session Prep summary
- Docker Compose local deployment
- Mock LLM mode for demo without API usage

## AI Engineering Concepts Demonstrated

- RAG
- Embeddings
- pgvector
- Vector search
- Prompt orchestration
- Multi-provider chat routing
- Prompt suggestion generation
- Optional Gemini or Vertex image generation
- Guarded style hints
- Upload validation and sanitization
- Structured output
- Tool/function calling
- Long-term memory
- Deterministic evaluation
- Hallucination and out-of-scope resistance checks
- Multi-service Docker architecture

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | Next.js, React, Tailwind CSS |
| Backend API | ASP.NET Core 8 Web API, Npgsql |
| AI Worker | Python, FastAPI, Pydantic |
| Database | PostgreSQL 16, pgvector |
| LLM | Mock LLM mode by default, Gemini API-key and Vertex AI Gemini provider support |
| Deployment | Docker Compose locally, Google Cloud Run + Cloud SQL for production |

## Screenshots

Screenshot placeholders are reserved for a local demo capture:

- `docs/screenshots/01-command-center.png` - command center overview
- `docs/screenshots/02-encounter-card.png` - structured encounter output
- `docs/screenshots/03-rules-rag-citations.png` - rules answer with citations
- `docs/screenshots/04-session-prep.png` - session prep summary

The files are not committed yet. Add them after running the app locally and capturing the current UI.

## Quick Start

Prerequisites:

- Docker Desktop or Docker Engine with Compose
- Optional local tooling: .NET 8 SDK, Node.js 20, Python 3.12

```bash
cp .env.example .env
docker compose up --build
```

Open:

- Frontend: `http://localhost:3000`
- API health: `http://localhost:8080/api/health`
- AI worker health: `http://localhost:8001/health`

## Environment Variables

`.env.example` contains safe local placeholders only. Copy it to `.env` for local development and keep `.env` out of Git.

| Variable | Purpose |
| --- | --- |
| `MOCK_LLM=true` | Enables deterministic local chat responses without paid API calls. |
| `MOCK_EMBEDDINGS=true` | Enables deterministic local embeddings for demo RAG flows. |
| `LLM_PROVIDER` | Real AI provider when `MOCK_LLM=false`; supports `gemini` or `vertex`. |
| `GEMINI_API_KEY` | Gemini API key for `LLM_PROVIDER=gemini`; keep empty for mock or Vertex mode. |
| `GEMINI_MODEL` | Gemini chat model, defaulting to `gemini-2.5-flash`. |
| `IMAGE_GENERATION_ENABLED=false` | Keeps NPC and encounter image generation disabled by default. Disabled mode returns deterministic mock placeholder metadata. |
| `IMAGE_PROVIDER` | Image provider for structured card visuals; use `mock`, `gemini`, or `vertex`. |
| `IMAGE_MODEL` | Gemini image generation model, defaulting to `gemini-2.5-flash-image`. |
| `IMAGE_ASPECT_RATIO` | Image generation aspect ratio, defaulting to `4:3` for mobile-friendly structured cards. Supported values are `1:1`, `3:4`, `4:3`, `9:16`, and `16:9`. |
| `VERTEX_PROJECT_ID` | Google Cloud project ID for `LLM_PROVIDER=vertex`. |
| `VERTEX_LOCATION` | Vertex AI location, defaulting to `global`. |
| `VERTEX_MODEL` | Vertex Gemini model, defaulting to `gemini-2.5-flash`. |
| `GOOGLE_APPLICATION_CREDENTIALS` | Optional in-container ADC credential path for local Docker Vertex mode. |
| `CHAT_MODEL` | Backward-compatible chat model fallback when `GEMINI_MODEL` is not set. |
| `EMBEDDING_PROVIDER` | Real embedding provider when `MOCK_EMBEDDINGS=false`; supports `gemini`, `vertex`, or `openai`. |
| `GEMINI_EMBEDDING_MODEL` | Gemini API-key embedding model, defaulting to `gemini-embedding-001`. |
| `GEMINI_EMBEDDING_DIMENSIONS` | Gemini API-key embedding output size. Keep `1536` unless the pgvector schema changes. |
| `VERTEX_EMBEDDING_MODEL` | Vertex AI embedding model, defaulting to `gemini-embedding-001`. |
| `VERTEX_EMBEDDING_DIMENSIONS` | Vertex AI embedding output size. Keep `1536` unless the pgvector schema changes. |
| `OPENAI_API_KEY` | Optional OpenAI embedding key if `EMBEDDING_PROVIDER=openai`. |
| `EMBEDDING_MODEL` | OpenAI embedding model name, or readable alias for the active embedding model. |
| `DATABASE_URL` | Worker PostgreSQL connection string. |
| `AI_WORKER_URL` | API-to-worker URL, defaulting to `http://ai-worker:8001`. |
| `AI_WORKER_AUTH_ENABLED` | Adds Cloud Run identity-token auth to API-to-worker calls when set to `true`. Keep `false` locally. |
| `AI_WORKER_AUTH_AUDIENCE` | Cloud Run worker service URL used as the identity-token audience. Usually matches `AI_WORKER_URL` in production. |
| `CORS_ALLOWED_ORIGINS` | Comma-separated browser origins allowed to call the API. Leave empty for permissive local Development CORS; set exact web origin in production. |
| `NEXT_PUBLIC_API_URL` | Browser-visible API URL alias. |
| `NEXT_PUBLIC_API_BASE_URL` | Browser-visible API base URL used by the current frontend. |
| `API_PROXY_BASE_URL` | Optional server-side Next.js proxy target. In Cloud Run, use `NEXT_PUBLIC_API_BASE_URL=/api/backend` and set this to the API service URL. |

To use Gemini API-key mode instead of mock responses, copy `.env.example` to `.env`, set `MOCK_LLM=false`, set `LLM_PROVIDER=gemini`, and put your key in `GEMINI_API_KEY`.

To enable real Gemini image generation for NPC, character, and encounter structured cards, set `IMAGE_GENERATION_ENABLED=true` and choose either `IMAGE_PROVIDER=gemini` with `GEMINI_API_KEY`, or `IMAGE_PROVIDER=vertex` with `VERTEX_PROJECT_ID`, `VERTEX_LOCATION`, and ADC via `GOOGLE_APPLICATION_CREDENTIALS`. This does not change the main text/chat provider flow. Keep `IMAGE_PROVIDER=mock` or `IMAGE_GENERATION_ENABLED=false` for deterministic local placeholders. `IMAGE_ASPECT_RATIO` falls back to `4:3` if an unsupported value is provided.

To use Vertex AI Gemini through Application Default Credentials, set `MOCK_LLM=false`, `LLM_PROVIDER=vertex`, `VERTEX_PROJECT_ID=project-de842900-cb0b-4155-b9c`, `VERTEX_LOCATION=global`, and `VERTEX_MODEL=gemini-2.5-flash`. For local Docker usage, make ADC available inside the `ai-worker` container by mounting your gcloud ADC JSON file and setting `GOOGLE_APPLICATION_CREDENTIALS` to the mounted path, such as `/gcloud/application_default_credentials.json`. Keep `MOCK_EMBEDDINGS=true` for the first Vertex chat pass unless you intentionally wire a real embedding provider.

To make RAG use Gemini embeddings through API-key mode, set `MOCK_EMBEDDINGS=false` and `EMBEDDING_PROVIDER=gemini`. To use Vertex AI embeddings instead, set `MOCK_EMBEDDINGS=false`, `EMBEDDING_PROVIDER=vertex`, `VERTEX_EMBEDDING_MODEL=gemini-embedding-001`, and `VERTEX_EMBEDDING_DIMENSIONS=1536`. Embeddings are requested at 1536 dimensions to match the current `knowledge_chunks.embedding vector(1536)` schema.

## Deployment

The safest GCP path is three Cloud Run services, Cloud SQL PostgreSQL with `pgvector`, Secret Manager, and Artifact Registry. Keep the first public deployment mock-first with `MOCK_LLM=true`, `MOCK_EMBEDDINGS=true`, and `IMAGE_GENERATION_ENABLED=false`; then enable Gemini or Vertex AI after the hosting path is healthy.

See `docs/deployment.md` for the Cloud Run runbook, Cloud SQL setup, Secret Manager mapping, commit-tagged image builds via `cloudbuild.yaml`, CORS hardening, private worker auth, smoke tests, and rollback notes.

## Demo Flow

1. Open `http://localhost:3000`.
2. Create, restore, or select a campaign.
3. Add or review party members.
4. Add sample rules from `db/seed/srd_sample.md` to Campaign Knowledge.
5. Ask a rules question such as `How does advantage work?`
6. Review the answer and its citations.
7. Paste session notes from `db/seed/session_notes.md`.
8. Save and summarize the session.
9. Use Spark to draft a context-aware prompt.
10. Generate an NPC or Character card.
11. Optionally generate a card image, then save the card.
12. Create and save an encounter so it becomes campaign memory.
13. Roll dice from the command center.
14. Review Session Prep for open hooks, quests, and usable knowledge.

For a guided walkthrough, open the in-app manual at `http://localhost:3000/manual` or read `docs/user-manual.md`.

## Local Browser Profiles

DNDMind does not require login for the MVP. The browser creates an anonymous local profile ID in `localStorage` and sends it as `X-Dndmind-Client-Id`. Campaigns and rules documents stay shared, but sessions and session-derived campaign memory are private to the current browser profile.

Clearing browser storage or resetting the local profile creates a new identity, so previous local sessions may no longer appear. This is demo ownership, not production authentication.

## Evaluation

DNDMind is designed for deterministic evaluation in mock mode. The sample eval cases check:

- Rules accuracy
- Homebrew isolation from rules retrieval
- Citation correctness
- Campaign memory recall
- Campaign tone stays style-only and does not override scope or grounding
- JSON validity
- Context-toggle and tool-calling correctness
- Prompt suggestion behavior
- Character and recap structured output behavior
- Image generation prompt building and mock fallback behavior
- Hallucination and out-of-scope resistance
- Encounter fallback, save, and memory correctness

This makes the project easier to review because AI behavior can be checked repeatedly without model drift or external API cost. See `docs/eval-design.md` for the evaluation plan.

## Portfolio Positioning

DNDMind is more than a chatbot. It demonstrates a product UI, an AI worker, RAG, memory, deterministic tools, structured cards, evals, and Dockerized full-stack architecture. The project shows how LLM features fit into a real application with service boundaries, persistence, local development ergonomics, and reviewer-friendly demo flows.

## Developer Commands

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

## Roadmap

- Multi-provider LLM routing
- Local Ollama fallback
- Voice session notes
- Advanced combat tracker
- Campaign memory graph
- LLM-as-judge evals
- Fine-tuning dataset exporter
- Production auth for real multi-user campaigns
