# Portfolio Writeup

## Problem

Dungeon Masters need to manage rules, party context, NPC relationships, quests, locations, encounters, and session continuity across long campaigns. Generic chatbots can help with prose, but they usually do not preserve campaign state, cite rule context, or turn outputs into reusable DM workflow data.

## Solution

DNDMind is an AI-powered campaign command center. It combines campaign-aware chat, Campaign Knowledge retrieval, campaign memory, campaign lifecycle controls, guarded response tone, session summarization, tabletop scope guarding, context-aware tool calling, multi-provider chat routing, and structured output cards in one interface. The project is mock-first so it can be reviewed locally without paid API calls, while still demonstrating production-shaped AI engineering patterns.

## Technical Architecture

The system uses:

- Next.js and React for the command center UI
- ASP.NET Core 8 for the browser-facing API and persistence boundary
- FastAPI for AI orchestration, RAG, summarization, and tools
- PostgreSQL 16 with pgvector for relational campaign data and vector search
- Docker Compose for local deployment

This separation mirrors a realistic AI product architecture: the app backend owns durable product state, and the AI worker owns model-facing behavior.

## AI Features

- Campaign Knowledge upload flow with templates, validation, and sanitization
- Campaign create, edit, archive, and restore flows
- Guarded campaign response tone for stylistic consistency
- Gemini API-key and Vertex AI Gemini chat provider support
- Rules and Homebrew RAG with citations
- Campaign memory RAG, including saved encounters
- Session-note summarization and extraction
- Lightweight out-of-scope prompt refusal before provider generation
- Structured cards for NPCs, quests, locations, encounters, initiative, and dice
- Tool calls for dice, initiative, encounter difficulty, rules search, homebrew search, memory search, and campaign saves
- Deterministic eval design for prompt, retrieval, tool, and structured-output regressions

## Result

DNDMind is a portfolio-ready MVP that shows how an LLM feature becomes a usable product: persisted context, visible citations, inspectable tool traces, structured outputs, and Dockerized service boundaries. It is easy to run locally, easy to demo, and clear enough for a hiring manager or client to understand quickly.

## What I Learned

- How to separate product APIs from AI workers without adding unnecessary platform complexity.
- How to make LLM workflows reviewable through mock mode, citations, and tool traces.
- How to turn AI output into persistent product data instead of leaving it as disposable chat text.
- How to keep a product assistant focused on its domain with deterministic guardrails.
- How to gate retrieval and party context behind explicit user-facing toggles.
- How to treat product-specific style settings as low-priority hints instead of authority over safety or grounding.
- How to add a real provider path while keeping mock-first local review stable.
- How to design deterministic evals before adding more expensive LLM-as-judge scoring.

## Skills Demonstrated

- Full-stack application development
- AI product architecture
- Retrieval augmented generation
- Vector database design with pgvector
- Structured output design
- Tool/function calling
- Docker Compose deployment
- Technical documentation and demo storytelling
