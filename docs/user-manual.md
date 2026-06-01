# DNDMind User Manual

Learn the full workflow in 5 minutes: choose a campaign, turn on the right context, send a focused prompt, review sources and tools, then save useful cards.

## Quick Start Checklist

1. Create campaign
   - Where: Left Sidebar.
   - Do: open the campaign selector and choose the workspace DNDMind should use.
   - Expected result: the active campaign summary appears at the top of the command center.
2. Add party
   - Where: Right Panel.
   - Do: review player character name, class, race, level, HP, AC, and notes.
   - Expected result: encounter prompts can account for party strength.
3. Add rules
   - Where: Rules Library.
   - Do: upload or paste SRD-style rules text and ingest it into chunks.
   - Expected result: rules questions can return citations.
4. Add session notes
   - Where: Session Notes.
   - Do: paste raw notes, save them, then summarize.
   - Expected result: NPCs, quests, locations, and hooks become campaign memory.
5. Ask AI
   - Where: Command Console.
   - Do: pick a mode, set context toggles, and send a command.
   - Expected result: DNDMind answers with sources, tools, or structured cards.
6. Save output
   - Where: Center Workspace.
   - Do: use suggested actions on NPC, quest, location, encounter, or session summary cards.
   - Expected result: useful generated content becomes reusable memory.
7. Run evals
   - Where: Evaluations.
   - Do: use the evaluation snapshot and eval prompt to check expected behavior.
   - Expected result: rules, memory, tools, JSON, and hallucination checks stay visible.

## Your First Successful Run

Goal: generate and save one useful encounter using campaign memory and party context.

1. Select the campaign `Embers of Blackwater`.
2. Confirm `Embers of Blackwater` appears as the active campaign at the top.
3. Make sure Party Info and Campaign Memory toggles are enabled.
4. Choose Encounter mode.
5. Type this prompt: `Create a medium encounter for this party involving Captain Vey and the Ashen Knives.`
6. Click Send.
7. Review the AI response, tool result, memory used, and encounter card.
8. Click Save Encounter if the result is useful.

Expected result: the center workspace shows an Encounter Briefing, tool result, memory or citation context, and a structured encounter card.

## Understanding the Command Center

| Area | Purpose |
| --- | --- |
| Left Sidebar | Choose campaigns, open rules documents, navigate app areas, and return to the manual. |
| Center Workspace | Read the chat timeline, generated encounter briefings, citations, tool results, and structured cards. |
| Right Panel | Use dice, eval snapshots, session notes, party details, memory, citations, and tool traces. |
| Command Console | Send instructions with the selected mode and context toggles. |

Practical concepts:

- Mode buttons decide the kind of AI task. Use Rules for sourced rules answers, Encounter for combat design, NPC for characters, Summarize for notes, and Auto when the task mixes categories.
- Context toggles decide what information the AI can use. Turn on Campaign Memory for saved story context, Party Info for party-aware answers, and Rules for citations from ingested documents.
- Command Console is where you type the instruction and click Send. Specific prompts produce better cards and fewer follow-up questions.
- Structured cards are reusable campaign objects such as NPCs, quests, locations, encounters, and summaries. Save useful cards so they can become campaign memory.
- Tool results show calculations or app actions performed by the system, such as dice rolls, rules search, memory search, and encounter checks.
- Citations show which rules document or campaign memory DNDMind used for the answer.

## Step-by-Step Guide

### Step 1 -- Create Campaign

Where: Left Sidebar -> Campaign

Do:

1. Open the campaign selector.
2. Select an existing campaign or create a new one.
3. Add a short campaign description if the field is available.

Expected result: the campaign appears under Active Campaign at the top.

Why it matters: DNDMind uses the active campaign to scope memory, sessions, and generated content.

### Step 2 -- Add Party

Where: Right Panel -> Party

Do:

1. Open the party area.
2. Add each character's name, class, race, level, HP, AC, and notes.
3. Keep the Party Info toggle on when asking for combat or challenge design.

Expected result: party members appear in the party list and encounter answers reference party strength.

Why it matters: party context helps DNDMind tune difficulty and avoid encounters that are too weak or too punishing.

### Step 3 -- Ingest Rules

Where: Left Sidebar -> Rules Library

Do:

1. Open the rules document area.
2. Upload or paste rules text.
3. Click the ingest action for the document.
4. Ask a Rules mode question such as `How does advantage work?`

Expected result: rules answers include citations from the ingested document.

Why it matters: rules ingestion gives DNDMind searchable source text instead of relying on unsupported memory.

### Step 4 -- Add Session Notes

Where: Right Panel -> Session Notes

Do:

1. Paste raw table notes into the notes field.
2. Save the notes.
3. Click Summarize or ask Summarize mode to extract NPCs, quests, locations, and hooks.

Expected result: the summary appears with extracted campaign objects and useful memory entries.

Why it matters: session notes turn table events into future context that DNDMind can retrieve.

### Step 5 -- Ask AI

Where: Bottom Command Console

Do:

1. Choose the mode that matches the task.
2. Enable the context toggles DNDMind should use.
3. Enter a specific prompt with names, goals, and constraints.
4. Click Send.

Expected result: the center workspace shows a response, and may include citations, tool results, or a structured card.

Why it matters: mode plus context tells DNDMind what kind of answer to produce and which information is allowed.

### Step 6 -- Use Tools

Where: Command Console or Right Panel -> Dice

Do:

1. Ask for an action such as rolling dice, searching memory, searching rules, or checking encounter difficulty.
2. Use prompts like `Roll 1d20+5 for perception.`
3. Review the tool result inside the response.

Expected result: the response includes a tool result with the calculation, search result, or action summary.

Why it matters: tool results make operational work visible so you can trust what happened during play.

### Step 7 -- Save Cards

Where: Center Workspace -> Structured Card

Do:

1. Review a generated NPC, quest, location, encounter, or session summary card.
2. Confirm it is useful for the campaign.
3. Click the matching save action, such as Save NPC or Save Encounter.

Expected result: the saved item becomes reusable campaign memory for future prompts.

Why it matters: saving is what turns a one-off AI answer into campaign material DNDMind can recall later.

### Step 8 -- Run Evals

Where: Right Panel -> Evaluations

Do:

1. Open the evaluation snapshot.
2. Review pass rate and categories.
3. Run or copy the eval prompt when checking a demo behavior.

Expected result: rules accuracy, citations, memory recall, JSON validity, tool use, and hallucination checks are visible.

Why it matters: evals help you verify that the assistant still behaves correctly after content or code changes.

## Try This Now

### Ask a Rules Question

- Mode: Rules.
- Toggles: Rules ON, Campaign Memory optional, Party Info OFF.
- Prompt: `How does advantage work?`
- Expected result: DNDMind gives a concise rules answer with citations from ingested rules.

### Generate an NPC

- Mode: NPC.
- Toggles: Campaign Memory ON, Party Info optional.
- Prompt: `Generate a suspicious NPC connected to Captain Vey.`
- Expected result: DNDMind returns an NPC card with role, personality, motivation, secret, and quest hook.

### Create an Encounter

- Mode: Encounter.
- Toggles: Campaign Memory ON, Party Info ON.
- Prompt: `Create a medium encounter for this party involving the Ashen Knives.`
- Expected result: DNDMind returns an encounter briefing, tool result, and structured encounter card.

### Summarize Session Notes

- Mode: Summarize.
- Toggles: Campaign Memory ON.
- Prompt: `Summarize these session notes and extract NPCs, quests, locations, and hooks.`
- Expected result: DNDMind returns a session summary card and extracted campaign objects to review.

### Roll Dice

- Mode: Combat.
- Toggles: no context required.
- Prompt: `Roll 1d20+5 for perception.`
- Expected result: DNDMind shows the roll result and tool trace in the response.

### Search Campaign Memory

- Mode: Auto.
- Toggles: Campaign Memory ON.
- Prompt: `Search campaign memory for Captain Vey.`
- Expected result: DNDMind returns matching memory with citations or context references.

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

## Recommended First Prompts

- `How should I open tonight's session?`
- `What happened at Blackwater Mine?`
- `Generate a suspicious NPC connected to Captain Vey.`
- `Create a medium encounter for this party involving the Ashen Knives.`
- `Roll 1d20+5 for perception.`
- `Summarize these session notes and extract NPCs, quests, and hooks.`
- `Search campaign memory for Captain Vey.`
- `Make this encounter harder but keep it fair.`

## Local Device Profile

DNDMind MVP does not require login. The browser creates a local device profile for demo isolation, and sessions are saved for that browser profile.

Opening the app in another browser or incognito window may show a different session list. Clearing browser storage may reset the local profile and hide sessions tied to the previous profile.

This is demo and MVP isolation, not production authentication or account security.

## Common Workflows

### Prepare a Session

1. Review the memory panel for unresolved hooks, NPCs, and locations.
2. Check that Campaign Memory is enabled.
3. Ask for an opening scene tied to the last session.
4. Generate an NPC or encounter for the next likely scene.
5. Save useful cards so they are ready during play.

### Live Play

1. Use Auto mode for mixed table help or Combat mode for tactical moments.
2. Roll dice from the command console or dice roller.
3. Ask quick rules questions in Rules mode when a ruling needs support.
4. Search campaign memory for names, places, and unresolved hooks.
5. Save important NPCs, hooks, or encounter results before moving on.

### After Session

1. Paste raw notes into Session Notes.
2. Click Summarize or use Summarize mode.
3. Review extracted NPCs, quests, locations, and hooks.
4. Save the summary if it accurately captures the session.
5. Run evals if you changed prompts, rules, or expected demo behavior.

## Troubleshooting

### AI answer has no citations

Cause: Rules context is off or no rules are ingested.

Fix:

1. Enable the Rules toggle.
2. Ingest a rules document.
3. Ask again in Rules mode.

### My session disappeared

Cause: you may be using a different browser, incognito window, or local device profile.

Fix:

1. Check whether you opened another browser or incognito window.
2. Return to the original browser profile.
3. Avoid clearing local storage during a demo.

### Memory answer seems empty

Cause: the active campaign has little saved memory, or Campaign Memory is off.

Fix:

1. Enable Campaign Memory.
2. Add session notes.
3. Summarize and save useful cards before asking again.

### Encounter does not use party info

Cause: Party Info is off or party members are missing details.

Fix:

1. Enable Party Info.
2. Add level, HP, AC, class, and notes for each character.
3. Ask again in Encounter or Combat mode.

### DNDMind answers from the wrong campaign

Cause: the active campaign is not the one you intended.

Fix:

1. Open the campaign selector.
2. Choose the correct campaign.
3. Confirm the active campaign name at the top before sending the prompt.

### Local demo says an API key is missing

Cause: the app may be configured for a real provider instead of mock mode.

Fix:

1. Use `MOCK_LLM=true` for the local demo.
2. Use `MOCK_EMBEDDINGS=true` unless testing a real embedding provider.
3. Restart the affected service after changing environment variables.

## Glossary

- RAG: Retrieval augmented generation. DNDMind searches rules or memory before answering.
- Embeddings: Numeric representations of text used to compare meaning.
- Vector DB: pgvector-backed storage for semantic search over rules and campaign memory.
- Tool calling: AI-triggered app actions such as dice rolling, rules search, memory search, or difficulty calculation.
- Eval: A repeatable test case that checks whether AI behavior stays accurate and structured.
- Structured output: a typed card such as an NPC, quest, location, encounter, or session summary.
- Citation: a source reference attached to an answer so the user can see where context came from.
- Mock LLM mode: deterministic local behavior for demos without paid API calls.
- Local device profile: a browser-stored demo identity used to keep MVP sessions separated without login.

## Why This Project Matters

DNDMind demonstrates full-stack LLM app architecture, RAG, pgvector, tool calling, structured output, memory, evals, and Docker deployment. The manual page helps recruiters, clients, and technical reviewers understand the product workflow quickly.
