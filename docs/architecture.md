# Architecture

DNDMind is organized as a small multi-service AI product. The architecture keeps product data, AI orchestration, and user experience separate enough to be understandable without becoming over-engineered.

## Components

```text
Next.js Frontend
  command center UI
  rules ingestion form
  session notes workflow
  structured cards
  tool-call display
  evaluation snapshot

ASP.NET Core API
  public HTTP boundary for the browser
  campaign, party, session, memory, and document endpoints
  conversation/message/tool-call persistence
  request assembly for the AI worker

FastAPI AI Worker
  mock-first LLM behavior
  rules document chunking and embedding
  rules and campaign memory retrieval
  session summary extraction
  deterministic tool execution
  structured output shaping

PostgreSQL + pgvector
  campaign source of truth
  relational memory tables
  knowledge documents and vector chunks
  conversation and tool-call audit trail
```

## Request Flow

1. The DM uses the Next.js command center to select context toggles, mode, and a prompt.
2. The frontend posts to the ASP.NET Core API.
3. The API loads campaign, party, and session context from PostgreSQL.
4. The API creates or reuses an AI conversation and stores the user message.
5. The API calls the FastAPI worker with the full request context.
6. The worker retrieves rules or campaign memory when the prompt requires it.
7. The worker returns an answer, citations, tool calls, structured output, and suggested actions.
8. The API stores the assistant message and tool-call traces.
9. The frontend renders normal text, citations, tool cards, and structured cards.

## Why ASP.NET Core + FastAPI

The ASP.NET Core API is the durable application backend. It owns validation, persistence, browser-facing routes, and stable product contracts.

The FastAPI worker owns AI-facing behavior. Python keeps RAG, embeddings, tool orchestration, and future model-provider integrations close to the ecosystem where those tools are strongest.

This split is useful for a portfolio project because it demonstrates a realistic production boundary: the product API can remain stable while AI behavior evolves behind a worker contract.

## Trade-Offs

- Two backend services add Docker and networking overhead, but make AI iteration cleaner.
- Mock embeddings are not semantically equivalent to real embeddings, but they make local demos deterministic and free.
- The current worker has a mock-first provider path, so real LLM mode is intentionally a roadmap item rather than a half-wired promise.
- PostgreSQL + pgvector keeps the stack simple compared with a separate vector database, but large-scale retrieval would eventually need more tuning.
- The eval dashboard is currently a demo-ready design backed by sample cases; a full automated eval runner is a clear next step.

## Data Model Highlights

- `campaigns`, `sessions`, and `party_characters` hold campaign setup.
- `knowledge_documents` and `knowledge_chunks` store rules and memory RAG content.
- `ai_conversations`, `ai_messages`, and `ai_tool_calls` preserve AI interactions.
- `npcs`, `quests`, `locations`, `encounters`, and `memory_events` turn session notes and structured outputs into reusable campaign memory.
