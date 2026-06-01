# Demo Script

This script is designed for a 3-5 minute GitHub, LinkedIn, or Upwork portfolio walkthrough.

## Setup

Start the stack:

```bash
docker compose up --build
```

Open `http://localhost:3000`.

Use mock mode. No API key is required.

## 0:00 - 0:30 Opening

"DNDMind is an AI Dungeon Master co-pilot. It is a full-stack LLM application with a Next.js command center, an ASP.NET Core API, a FastAPI AI worker, and PostgreSQL with pgvector. The goal is to help a Dungeon Master manage rules, campaign memory, structured prep, and tool calls in one place."

Point out:

- campaign selector
- mode buttons
- context toggles
- party and memory panels
- rules document ingestion

## 0:30 - 1:20 Rules RAG

In the Rules Documents panel:

1. Open `db/seed/srd_sample.md`.
2. Paste the contents into the document textarea.
3. Click `Upload + Ingest`.

Prompt:

```text
How does advantage work?
```

Expected result:

- assistant answers in Rules mode
- citations appear under the response
- tool-call or retrieval context shows rules search behavior

Narration:

"This demonstrates RAG: the worker chunks the document, creates deterministic embeddings in mock mode, stores them in pgvector, then returns citations with the answer."

## 1:20 - 2:10 Campaign Memory

Paste `db/seed/session_notes.md` into Session Notes.

Click:

1. `Save`
2. `Summarize`

Prompt:

```text
Who betrayed the party last session?
```

Expected result:

- answer names Captain Vey or the betrayal from the session notes
- Memory panel gains NPCs, locations, quests, or hooks
- campaign memory citations appear after memory ingestion

Narration:

"Session notes are converted into campaign memory. The API stores extracted NPCs, quests, locations, and hooks, then the worker turns the summary into searchable memory chunks."

## 2:10 - 3:00 Structured Output Cards

Prompt:

```text
Generate a suspicious tavern keeper NPC.
```

Expected result:

- structured NPC card appears
- save action appears
- clicking save persists the NPC into the Memory panel

Then prompt:

```text
Generate a hard forest ambush encounter for my party.
```

Expected result:

- encounter card appears with monsters, tactics, scaling, hooks, and rewards

Narration:

"The worker returns AI-shaped JSON, and the frontend renders it as reusable campaign cards. Save actions turn generated ideas into persistent campaign state."

## 3:00 - 3:40 Tool Calling

Use the dice roller:

```text
1d20+5
```

Prompt:

```text
Generate initiative order for the party.
```

Expected result:

- dice card or tool-call card renders
- initiative order shows deterministic mock rolls
- tool calls are stored by the API

Narration:

"Tool calls are explicit and inspectable. This is important for AI products because the system can show what happened instead of hiding tool behavior inside prose."

## 3:40 - 4:20 Evaluation Snapshot

Point to the evaluation snapshot in the UI and `db/seed/eval_cases.json`.

Narration:

"The evaluation strategy is deterministic: fixed prompts, expected facts, required citations or tool calls, and stable mock responses. The next step is wiring these cases into an automated runner and dashboard history."

## 4:20 - 5:00 Close

"This project demonstrates practical AI engineering: RAG, embeddings, vector storage, prompt orchestration, tool calling, structured output, long-term memory, and Dockerized service boundaries. The mock-first path makes it easy to review locally without secrets."
