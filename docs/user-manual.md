# DNDMind User Manual

Learn the full workflow in 5 minutes.

## Quick Start Checklist

1. Create campaign
   - Select the campaign workspace DNDMind should use.
   - Expected result: the active campaign summary appears at the top of the command center.
   - Related area: Left Sidebar.
2. Add party
   - Review player character name, class, race, level, HP, AC, and notes.
   - Expected result: encounter prompts can account for party strength.
   - Related area: Right Panel.
3. Add rules
   - Upload or paste SRD-style rules text and ingest it into chunks.
   - Expected result: rules questions can return citations.
   - Related area: Rules Library.
4. Add session notes
   - Paste raw notes, save them, then summarize.
   - Expected result: NPCs, quests, locations, and hooks become campaign memory.
   - Related area: Session Notes.
5. Ask AI
   - Pick a mode, set context toggles, and send a command.
   - Expected result: DNDMind answers with sources, tools, or structured cards.
   - Related area: Command Console.
6. Save output
   - Use suggested actions on NPC, quest, location, encounter, or session summary cards.
   - Expected result: useful generated content becomes reusable memory.
   - Related area: Center Workspace.
7. Run evals
   - Use the evaluation snapshot and eval prompt to check expected behavior.
   - Expected result: rules, memory, tools, JSON, and hallucination checks stay visible.
   - Related area: Evaluations.

## App Layout Overview

| Area | Purpose |
| --- | --- |
| Left Sidebar | Campaign selector, rules documents, workspace navigation, and the manual link. |
| Center Workspace | AI chat timeline, citations, tool results, and structured cards. |
| Right Panel | Dice roller, eval snapshot, session notes, party details, memory, citations, and tool traces. |
| Command Console | The bottom input where you send AI instructions with the selected mode and context. |

## Step-by-Step Guide

### Step 1: Create Campaign

Select or create a campaign such as `Shadows of Eldermire`. The active campaign controls chat, memory, party, rules, and saved outputs.

### Step 2: Add Party

Track each character's name, class, race, level, HP, AC, and notes. DNDMind uses party info when encounter prompts need fair difficulty.

### Step 3: Ingest Rules

Upload or paste rules text, then ingest it into searchable chunks. Example prompt: `How does advantage work?`

### Step 4: Add Session Notes

Paste raw notes, save them, then summarize them into campaign memory. Example note: `Captain Vey betrayed the party at Blackwater Mine.`

### Step 5: Ask AI

Choose a mode and context toggles before sending a command.

- Auto: mixed tasks and session prep.
- Rules: rules questions that need citations.
- Story: narration, atmosphere, and scene framing.
- Encounter: combat and challenge design.
- NPC: character creation and relationship hooks.
- Combat: dice, initiative, tactics, and table actions.
- Summarize: session notes and extracted hooks.

Context toggles:

- Rules: uses ingested rules and citations.
- Campaign Memory: uses summaries, NPCs, quests, and locations.
- Party Info: uses level, HP, AC, class, race, and notes.
- Homebrew: reserved for custom campaign rules.

### Step 6: Use Tools

Ask DNDMind to roll dice, generate initiative, calculate encounter difficulty, search rules, or search campaign memory. Tool results appear inside the response.

Example prompts:

- `Roll 1d20+5 for perception.`
- `Generate initiative order for the party.`
- `Create a medium encounter for this party.`

### Step 7: Save Cards

Generated NPC, quest, location, encounter, and session summary cards can become reusable campaign memory through suggested actions.

### Step 8: Run Evals

Use the evaluation snapshot to review pass rate, rules accuracy, citation correctness, memory recall, JSON validity, tool-calling correctness, and hallucination resistance.

## AI Modes Guide

| Mode | Best for | Example |
| --- | --- | --- |
| Auto | Mixed tasks and session prep. | `Prepare tonight's opening scene based on last session.` |
| Rules | Rules questions that need citations. | `How does advantage work?` |
| Story | Narration, atmosphere, and scene framing. | `Describe the ruined temple entrance.` |
| Encounter | Combat and challenge design. | `Create a hard ambush for my level 3 party.` |
| NPC | Character creation and relationship hooks. | `Generate a suspicious tavern keeper.` |
| Combat | Dice, initiative, tactics, and table actions. | `Roll initiative for the party and goblins.` |
| Summarize | Session notes and extracted hooks. | `Summarize this session and extract unresolved hooks.` |

## Best Example Prompts

- `How should I open tonight's session?`
- `What happened at Blackwater Mine?`
- `Generate a suspicious NPC connected to Captain Vey.`
- `Create a medium encounter for this party involving the Ashen Knives.`
- `Summarize these session notes and extract NPCs, quests, and hooks.`
- `Roll 1d20+5 for perception.`
- `Search campaign memory for Captain Vey.`
- `Make this encounter harder but keep it fair.`

## Common Workflows

### Prepare session

1. Review memory.
2. Ask for opening scene.
3. Generate NPC.
4. Generate encounter.
5. Save useful outputs.

### Live play

1. Ask rules question.
2. Roll dice.
3. Generate quick NPC.
4. Search campaign memory.
5. Save important result.

### After session

1. Paste notes.
2. Summarize session.
3. Extract memory.
4. Review unresolved hooks.
5. Run evals if needed.

## Troubleshooting

| Issue | Fix |
| --- | --- |
| No campaign selected | Create or select a campaign first. |
| AI answer has no citations | Enable Rules context and ingest rules documents. |
| Memory answer seems empty | Add session notes and summarize them first. |
| Encounter does not use party info | Enable Party Info context and add party members. |
| API key not configured | Use `MOCK_LLM=true` for local demo, or configure an API key in `.env`. |
| Docker service error | Check `docker compose logs` and service health endpoints. |

## Glossary

- RAG: Retrieval augmented generation. DNDMind searches rules or memory before answering.
- Embeddings: Numeric representations of text used to compare meaning.
- Vector DB: pgvector-backed storage for semantic search over rules and campaign memory.
- Tool calling: AI-triggered app actions such as dice rolling, rules search, memory search, or difficulty calculation.
- Eval: A repeatable test case that checks whether AI behavior stays accurate and structured.
- Structured output: A typed card such as an NPC, quest, location, encounter, or session summary.
- Citation: A source reference attached to an answer so the user can see where context came from.
- Mock LLM mode: Deterministic local behavior for demos without paid API calls.

## Why This Project Matters

DNDMind demonstrates full-stack LLM app architecture, RAG, pgvector, tool calling, structured output, memory, evals, and Docker deployment. The manual page helps recruiters, clients, and technical reviewers understand the product workflow quickly.
