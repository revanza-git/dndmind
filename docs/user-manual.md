# DNDMind User Manual

DNDMind helps a Dungeon Master prepare sessions, answer rules questions, remember campaign details, create NPCs and encounters, summarize notes, and roll dice from one command center.

Use this manual when you want to know what to click, what to type, and what result to expect.

## First 5 Minutes

1. Open DNDMind.
   - Go to the app in your browser.
   - You do not need to create an account.
2. Choose a campaign.
   - Use the campaign selector in the left sidebar.
   - To follow this guide, choose `Embers of Blackwater`.
3. Check the party.
   - Look at the Party panel on the right.
   - Add or update character level, HP, AC, class, and notes if needed.
4. Add rules.
   - Open Rules Documents in the left sidebar.
   - Upload or paste rules text, then click **Upload + Ingest**.
5. Add session notes.
   - Paste notes into Session Notes on the right.
   - Click **Save**, then **Summarize**.
6. Ask DNDMind for help.
   - Choose a mode, turn on the context toggles you want, type a prompt, and click **Send**.
7. Save useful results.
   - If DNDMind creates a useful NPC, encounter, quest, location, or summary card, click the matching save button.

## Quick Tutorial

Goal: create and save one encounter using campaign memory and party details.

1. Select `Embers of Blackwater`.
2. Confirm that `Embers of Blackwater` appears as the active campaign at the top.
3. Turn on **Campaign Memory** and **Party Info**.
4. Choose **Encounter** mode.
5. Type: `Create a medium encounter for this party involving Captain Vey and the Ashen Knives.`
6. Click **Send**.
7. Review the answer and the encounter card.
8. Click **Save Encounter** if you want to keep it.

Expected result: DNDMind shows an encounter briefing, any tool or memory context it used, and a structured encounter card you can save.

## Command Center Map

| Area | What you use it for |
| --- | --- |
| Left Sidebar | Choose campaigns, open the manual, and add rules documents. |
| Center Workspace | Read the chat, answers, citations, tool results, and generated cards. |
| Right Panel | Roll dice, manage session notes, review party details, and check memory. |
| Command Console | Type your request, choose a mode, set context toggles, and send. |

## Modes

| Mode | Use it when you want to... | Example |
| --- | --- | --- |
| Auto | Let DNDMind choose the best approach. | `Prepare tonight's opening scene based on last session.` |
| Rules | Ask a rules question with sources. | `How does advantage work?` |
| Story | Create narration, atmosphere, or scene text. | `Describe the ruined temple entrance.` |
| Encounter | Build or adjust combat and challenges. | `Create a hard ambush for my level 3 party.` |
| NPC | Create characters and relationship hooks. | `Generate a suspicious tavern keeper.` |
| Combat | Roll dice, plan tactics, or handle initiative. | `Roll initiative for the party and goblins.` |
| Summarize | Turn session notes into useful memory. | `Summarize this session and extract unresolved hooks.` |

## Context Toggles

- **Rules**: use this when the answer should come from ingested rules text and include citations.
- **Campaign Memory**: use this when the answer should remember saved NPCs, quests, locations, notes, or summaries.
- **Party Info**: use this when the answer should consider character level, HP, AC, class, and notes.
- **Homebrew**: reserved for custom campaign rules.

If DNDMind gives an answer that feels too generic, check the toggles first.

## Common Tasks

### Ask a rules question

1. Choose **Rules** mode.
2. Turn **Rules** on.
3. Type: `How does advantage work?`
4. Click **Send**.

Expected result: DNDMind gives a short answer and cites the rules text it used.

### Create an NPC

1. Choose **NPC** mode.
2. Turn **Campaign Memory** on if the NPC should connect to your story.
3. Type: `Generate a suspicious NPC connected to Captain Vey.`
4. Click **Send**.
5. Review the NPC card.
6. Click **Save NPC** if you want to keep it.

Expected result: DNDMind creates an NPC with role, personality, motivation, secret, and story hook.

### Create an encounter

1. Choose **Encounter** mode.
2. Turn **Campaign Memory** and **Party Info** on.
3. Type: `Create a medium encounter for this party involving the Ashen Knives.`
4. Click **Send**.
5. Review the encounter card.
6. Click **Save Encounter** if it fits your session.

Expected result: DNDMind creates a party-aware encounter with tactics and story context.

### Roll dice

1. Use the Dice Roller on the right, or choose **Combat** mode.
2. Type a roll like `1d20+5`.
3. Click **Roll**, or send a prompt like `Roll 1d20+5 for perception.`

Expected result: DNDMind shows the roll result and keeps the tool result visible.

### Summarize session notes

1. Paste table notes into **Session Notes**.
2. Click **Save**.
3. Click **Summarize**.
4. Review the summary and extracted details.
5. Save useful cards or summaries.

Expected result: important NPCs, quests, locations, hooks, and events become easier to find later.

### Search campaign memory

1. Choose **Auto** mode.
2. Turn **Campaign Memory** on.
3. Type: `Search campaign memory for Captain Vey.`
4. Click **Send**.

Expected result: DNDMind returns matching campaign details or memory references.

## Good Prompt Patterns

Use names, goals, and constraints. These prompts work well:

- `How should I open tonight's session?`
- `What happened at Blackwater Mine?`
- `Generate a suspicious NPC connected to Captain Vey.`
- `Create a medium encounter for this party involving the Ashen Knives.`
- `Make this encounter harder but keep it fair.`
- `Summarize these session notes and extract NPCs, quests, and hooks.`
- `Roll 1d20+5 for perception.`

## Table Workflows

### Before a session

1. Review campaign memory for unresolved hooks, NPCs, and locations.
2. Check that party details are current.
3. Turn on **Campaign Memory**.
4. Ask for an opening scene or recap.
5. Generate NPCs or encounters you may need.
6. Save useful cards.

### During a session

1. Use **Auto** mode for general help.
2. Use **Rules** mode for rulings.
3. Use **Combat** mode or the Dice Roller for rolls and initiative.
4. Search memory when a name, location, or clue comes back.
5. Save important new NPCs, hooks, or encounter results.

### After a session

1. Paste your raw notes into **Session Notes**.
2. Click **Save**.
3. Click **Summarize**.
4. Review the extracted NPCs, quests, locations, and hooks.
5. Save the summary if it is accurate.

## Local Browser Profile

DNDMind does not require login. Your browser creates a local profile so your sessions can stay separate from another browser or incognito window.

If you open DNDMind in a different browser, use incognito mode, or clear browser storage, you may not see the same saved sessions.

## Troubleshooting

### The answer has no citations

Cause: **Rules** is off, or no rules document has been ingested.

Fix:

1. Turn **Rules** on.
2. Add a rules document.
3. Click **Upload + Ingest**.
4. Ask again in **Rules** mode.

### The answer forgot my story

Cause: **Campaign Memory** is off, or the detail has not been saved yet.

Fix:

1. Turn **Campaign Memory** on.
2. Save session notes, NPCs, quests, locations, or encounter cards.
3. Ask again with the relevant name or event in the prompt.

### The encounter ignores the party

Cause: **Party Info** is off, or the party details are missing.

Fix:

1. Turn **Party Info** on.
2. Add or update each character's level, HP, AC, class, and notes.
3. Ask again in **Encounter** or **Combat** mode.

### My session disappeared

Cause: you may be in a different browser profile, incognito window, or your browser storage was cleared.

Fix:

1. Return to the same browser profile you used before.
2. Avoid clearing browser storage during a campaign.

### DNDMind is using the wrong campaign

Cause: the active campaign is not the one you intended.

Fix:

1. Open the campaign selector.
2. Choose the correct campaign.
3. Confirm the active campaign name at the top before sending a prompt.

## Helpful Terms

- **Citation**: the source DNDMind used for an answer.
- **Campaign Memory**: saved notes, NPCs, quests, locations, encounters, and summaries.
- **Structured Card**: a generated NPC, encounter, quest, location, or summary that can be saved.
- **Tool Result**: a visible result from an action such as a dice roll, rules search, or memory search.
- **Local Browser Profile**: the browser-based identity used to keep sessions separate.
