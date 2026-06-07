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
- create/edit/archive/restore controls
- mode buttons
- Spark prompt suggestion controls
- context toggles
- party and memory panels
- Campaign Knowledge upload and templates
- tabletop-focused assistant behavior

## 0:30 - 1:20 Campaign Knowledge RAG

First, confirm an active campaign is selected. If the selector says `No active campaigns`, click `New`, enter a campaign name, and save it. Mention that archived campaigns can be restored without deleting their data.

In Campaign Knowledge:

1. Open `db/seed/srd_sample.md`.
2. Paste the contents into the notes box.
3. Choose `Rules`.
4. Click `Add to Campaign`.

Prompt:

```text
How does advantage work?
```

Expected result:

- assistant answers in Rules mode
- citations appear under the response
- tool-call or retrieval context shows rules search behavior

Narration:

"This demonstrates Campaign Knowledge RAG: the API validates the upload, the worker sanitizes and chunks the text, deterministic embeddings are stored in pgvector, and the answer returns citations."

Optional homebrew contrast:

1. Add a small house rule as `Homebrew`.
2. Ask about it with Homebrew off, then with Homebrew on.

Expected result:

- standard rules search stays separate from homebrew search
- Homebrew context appears only when that toggle is enabled

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

Click **Spark** with NPC mode selected to draft a campaign-aware prompt, then send it or adjust it.

Prompt:

```text
Generate a suspicious tavern keeper NPC.
```

Expected result:

- structured NPC card appears
- save action appears
- optional image controls appear on visual card types
- clicking save persists the NPC into the Memory panel

Then prompt:

```text
Generate a hard forest ambush encounter for my party.
```

Expected result:

- encounter card appears with monsters, tactics, scaling, hooks, and rewards
- saving the encounter adds it to Campaign Memory and indexes it for later retrieval

Narration:

"The worker returns AI-shaped JSON, and the frontend renders it as reusable campaign cards. Save actions turn generated ideas into persistent campaign state. Encounters are also indexed as memory so future prompts can find them. Image generation is optional and mock-first, so the demo stays deterministic without provider keys."

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

## 3:40 - 4:20 Session Prep

Point to the Session Prep section in the UI.

Narration:

"Session Prep turns saved state into a fast DM dashboard: open hooks, active quests, saved encounters, ready knowledge, and current session notes. The deterministic eval cases still live in `db/seed/eval_cases.json` and are covered by worker tests."

Optional tone check:

1. Edit the campaign response tone to `Wry gothic suspense`.
2. Ask for an opening scene.

Expected result:

- the response reflects the tone as style
- scope, citations, tools, and structured cards still behave normally

Optional recap check:

```text
Recap the campaign so far and list the open hooks.
```

Expected result:

- recap mode summarizes saved memory and session context
- unresolved hooks are easy to reuse for the next scene

## 4:20 - 5:00 Close

"This project demonstrates practical AI engineering: RAG, embeddings, vector storage, prompt orchestration, tool calling, structured output, long-term memory, and Dockerized service boundaries. The mock-first path makes it easy to review locally without secrets."

Optional scope check:

```text
Write a Python function to parse CSV files.
```

Expected result:

- DNDMind refuses the unrelated request
- suggested actions point back to NPCs, encounters, or session summaries
