# DNDMind — AI Dungeon Master Co-Pilot

An AI-powered Dungeon Master command center for tabletop RPG campaigns, built to demonstrate full-stack LLM application engineering.

DNDMind is a mock-first full-stack AI product for running and reviewing long-lived tabletop campaigns. It combines campaign data, rules retrieval, session memory, structured AI outputs, deterministic tools, and evaluation workflows in one local Docker Compose demo.

## Problem

Dungeon Masters need to manage rules, campaign continuity, party context, session memory, NPCs, quests, encounters, dice rolls, and summaries across long-running campaigns. That context is usually scattered across notes, books, chat logs, and improvised table decisions.

## Solution

DNDMind combines RAG, campaign memory, structured output, tool calling, and deterministic evals into one command-center interface. The default path uses `MOCK_LLM=true` and `MOCK_EMBEDDINGS=true`, so the project can be reviewed locally without paid API usage or external model calls.

## Architecture

```text
Next.js Frontend
  -> ASP.NET Core Web API
  -> FastAPI AI Worker
  -> PostgreSQL + pgvector
  -> LLM Provider or MOCK_LLM mode
```

The frontend renders the DM command center. The API owns campaign data, chat persistence, and worker proxying. The AI worker handles prompt orchestration, RAG, structured output, and tool execution. PostgreSQL stores campaign entities, messages, memory, knowledge chunks, and pgvector embeddings.

## Key Features

- Campaign management
- Party management
- AI command center chat
- Rules RAG with citations
- Campaign memory RAG
- Session notes and summarization
- NPC, quest, location, encounter, dice roll, and initiative structured cards
- Tool calling with persisted traces
- Dice roller
- Encounter difficulty calculator
- Evaluation dashboard
- Docker Compose local deployment
- Mock LLM mode for demo without API usage

## AI Engineering Concepts Demonstrated

- RAG
- Embeddings
- pgvector
- Vector search
- Prompt orchestration
- Structured output
- Tool/function calling
- Long-term memory
- Deterministic evaluation
- Hallucination resistance checks
- Multi-service Docker architecture

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | Next.js, React, Tailwind CSS |
| Backend API | ASP.NET Core 8 Web API, Npgsql |
| AI Worker | Python, FastAPI, Pydantic |
| Database | PostgreSQL 16, pgvector |
| LLM | Mock LLM mode by default, provider-ready configuration |
| Deployment | Docker Compose |

## Screenshots

Screenshot placeholders are reserved for a local demo capture:

- `docs/screenshots/01-command-center.png` - command center overview
- `docs/screenshots/02-encounter-card.png` - structured encounter output
- `docs/screenshots/03-rules-rag-citations.png` - rules answer with citations
- `docs/screenshots/04-eval-dashboard.png` - evaluation dashboard

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
| `OPENAI_API_KEY` | Optional provider key; leave empty for mock mode. |
| `CHAT_MODEL` | Chat model name for a real provider path. |
| `EMBEDDING_MODEL` | Embedding model name, defaulting to `text-embedding-3-small`. |
| `DATABASE_URL` | Worker PostgreSQL connection string. |
| `AI_WORKER_URL` | API-to-worker URL, defaulting to `http://ai-worker:8001`. |
| `NEXT_PUBLIC_API_URL` | Browser-visible API URL alias. |
| `NEXT_PUBLIC_API_BASE_URL` | Browser-visible API base URL used by the current frontend. |

## Demo Flow

1. Open `http://localhost:3000`.
2. Create or select a campaign.
3. Add or review party members.
4. Ingest sample rules from `db/seed/srd_sample.md`.
5. Ask a rules question such as `How does advantage work?`
6. Review the answer and its citations.
7. Paste session notes from `db/seed/session_notes.md`.
8. Save and summarize the session.
9. Generate an NPC.
10. Create an encounter.
11. Roll dice from the command center.
12. Run or review the eval suite cases in `db/seed/eval_cases.json`.

## Evaluation

DNDMind is designed for deterministic evaluation in mock mode. The sample eval cases check:

- Rules accuracy
- Citation correctness
- Campaign memory recall
- JSON validity
- Tool-calling correctness
- Hallucination resistance
- Encounter difficulty correctness

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
- VPS deployment
