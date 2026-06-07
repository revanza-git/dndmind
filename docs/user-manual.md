# DNDMind User Manual

DNDMind is a Dungeon Master co-pilot. It helps you keep campaign notes organized, ask rules questions, create NPCs and encounters, summarize sessions, search campaign memory, and roll dice from one command center.

This guide is written for people using the app, not for people setting it up. You do not need to know how the app is built.

## Start Here

Use this short checklist the first time you open DNDMind.

1. Open the app in your browser.
2. Choose a campaign from the Campaign area. On phones, use the **Campaign** tab.
3. If there are no active campaigns, click **New** or restore one from **Archived**.
4. Check the party list on the right.
5. Add rules, lore, NPC notes, or session notes in **Campaign Knowledge** if you want DNDMind to use them.
6. Choose a task mode, such as **Auto**, **Rules**, **Encounter**, **NPC**, **Character**, **Recap**, or **Summarize**.
7. Turn on the context toggles you want DNDMind to use.
8. Type a request in the command console and click **Send**.
9. Save useful NPCs, quests, locations, encounters, or summaries when DNDMind offers a save button.

Good first prompt:

```text
Create a medium encounter for this party involving Captain Vey and the Ashen Knives.
```

## First Successful Run

Try this walkthrough if you want to learn the app by doing one complete task.

Goal: create and save one encounter.

1. Select `Embers of Blackwater`, or create a new campaign if your campaign list is empty.
2. Confirm that the campaign name appears at the top of the workspace.
3. Turn on **Campaign Memory** and **Party Info**.
4. Choose **Encounter** mode.
5. Type:

```text
Create a medium encounter for this party involving Captain Vey and the Ashen Knives.
```

6. Click **Send**.
7. Read the encounter briefing.
8. Check any tool results, memory references, or structured encounter card.
9. Click **Save Encounter** if the result fits your session.

Expected result: DNDMind creates a party-aware encounter and saves it as campaign memory when you approve it.

## Screen Map

| Area | What it is for |
| --- | --- |
| Campaign Area | Choose, create, edit, archive, or restore campaigns. Open Campaign Knowledge and the user manual. On wide screens this is the left sidebar; on phones it is the **Campaign** tab. |
| Chat Workspace | Read chat answers, citations, tool results, generated cards, and save actions. On phones this is the **Chat** tab. |
| Top Summary Cards | See quick counts for party members, knowledge notes, memory items, and open hooks. |
| Task Modes | Tell DNDMind what kind of work the next request needs. |
| Context Toggles | Choose which saved information DNDMind may use for the next answer. |
| Command Console | Type your request, send it, or clear the current chat. |
| Spark | Drafts a prompt for the selected task mode using the current campaign context. |
| Notes Area | Manage dice, session notes, party details, citations, tool traces, and campaign memory. On wide screens this is the right panel; on phones it is the **Notes** tab. |

## Campaigns

A campaign is the main container for your game. DNDMind uses the active campaign for chat, party details, session notes, Campaign Knowledge, saved cards, and campaign memory.

Before asking a story-specific question, check the active campaign name. If the wrong campaign is selected, DNDMind may use the wrong story context.

### Campaign Controls

| Control | What it does | Use it when |
| --- | --- | --- |
| **New** | Creates a campaign. | You are starting a new adventure, table, one-shot, or test campaign. |
| **Edit** | Updates the selected campaign name, description, or response tone. | The campaign premise or writing style needs a change. |
| **Archive** | Moves the selected campaign out of the active list without deleting it. | You are done with a campaign for now. |
| Campaign selector | Chooses the active campaign. | You want DNDMind to work in a different campaign. |
| **Archived** | Shows campaigns that were put away. | You want to bring back an older campaign. |
| **Restore** | Returns an archived campaign to the active list. | You want to use that campaign again. |

### Create a Campaign

1. Click **New**.
2. Enter a campaign name.
3. Add a short description if helpful.
4. Add a response tone if you want a consistent style, such as `Direct, table-ready notes`.
5. Click **Save**.

Expected result: the new campaign becomes active.

### Archive or Restore a Campaign

Archive keeps your active list tidy. It does not delete the campaign.

To archive:

1. Choose the campaign.
2. Click **Archive**.
3. Confirm the message.

To restore:

1. Look under **Archived**.
2. Click **Restore** on the campaign you want.

## Campaign Knowledge

Campaign Knowledge is where you add source material DNDMind can search. Use it for rules, homebrew, lore, NPC notes, locations, quests, and session notes.

Add information here when you want DNDMind to answer from your material instead of guessing from a short prompt.

### What to Add

| Material | Good use |
| --- | --- |
| Rules | Rules references you want cited in answers. |
| Homebrew | Custom rules, table rulings, custom items, monsters, or mechanics. |
| NPC notes | Names, motives, secrets, relationships, and hooks. |
| Location notes | Places, clues, hazards, factions, rumors, and local details. |
| Quest notes | Goals, status, complications, rewards, and unresolved hooks. |
| Campaign lore | History, factions, gods, politics, prophecies, and world truths. |
| Session notes | Raw or cleaned notes from a session. |

### Add an Entry

1. Open **Campaign Knowledge** in the left sidebar.
2. Enter a clear title, such as `Blackwater Mine Lore` or `House Rules - Resting`.
3. Choose the document type.
4. Download a template if you want a starting shape.
5. Upload a `.txt` or `.md` file, or paste text into the box.
6. Click **Add to Campaign**.
7. Wait until the entry is ready to use.

Supported uploads are `.txt` and `.md` files up to 2 MB. Pasted notes work too.

### Reading the Knowledge List

- **Ready to use** means DNDMind can search that entry.
- **Notes** are the searchable pieces created from your text.
- **Delete** removes a regular rules or homebrew document from Campaign Knowledge.
- Some session memory documents may be protected because they come from saved campaign memory.

## Context Toggles

Context toggles decide what DNDMind may use for the next answer. They do not erase or change saved information.

| Toggle | Turn it on when | Turn it off when |
| --- | --- | --- |
| **Rules** | You want a rules answer with citations from ready rules entries. | You want story ideas, brainstorming, or a fast answer without rules lookup. |
| **Campaign Memory** | Saved NPCs, quests, locations, summaries, hooks, or encounters should matter. | You want a fresh idea that does not depend on the current campaign. |
| **Party Info** | You need encounter balance, tactics, difficulty, or character-aware advice. | The party is not relevant. |
| **Homebrew** | Custom rules or house mechanics should affect the answer. | You want standard rules or campaign story only. |

Simple defaults:

- Rules question: **Rules** on.
- Homebrew rules question: **Rules** and **Homebrew** on.
- Encounter design: **Campaign Memory** and **Party Info** on.
- NPC or story work: **Campaign Memory** on.
- Pure brainstorming: leave on only the context you truly need.

## Task Modes

Task modes tell DNDMind what kind of answer you want.

| Mode | Best for | Example prompt |
| --- | --- | --- |
| **Auto** | Mixed tasks, prep, and general help. | `Prepare tonight's opening scene based on last session.` |
| **Rules** | Rules questions that need sources. | `How does advantage work?` |
| **Encounter** | Combat, hazards, and challenge design. | `Create a hard ambush for my level 3 party.` |
| **NPC** | Characters, motives, secrets, and hooks. | `Generate a suspicious tavern keeper.` |
| **Character** | Player characters, backup characters, rivals, and hirelings. | `Generate a level 3 adventurer tied to this campaign.` |
| **Recap** | Catching up on what has happened so far. | `Recap the last session and list the open hooks.` |
| **Summarize** | Session notes, recaps, and extracted hooks. | `Summarize this session and extract unresolved hooks.` |

Mode plus toggles is the main habit to learn. For example, **Rules** mode with **Rules** on is best for cited rulings. **Encounter** mode with **Party Info** on is best for party-aware fights.

## Common Tasks

### Ask a Rules Question

1. Choose **Rules** mode.
2. Turn **Rules** on.
3. Turn **Homebrew** on only if custom rules should apply.
4. Type a question.
5. Click **Send**.

Example:

```text
How does advantage work?
```

Expected result: DNDMind gives a short answer and shows citations when it used a rules source.

### Create an NPC

1. Choose **NPC** mode.
2. Turn **Campaign Memory** on if the NPC should connect to your story.
3. Type a specific request.
4. Click **Send**.
5. Review the NPC card.
6. Click **Save NPC** if you want DNDMind to remember it.
7. If image controls appear, choose a style and click **Generate Image** before saving when you want a visual reference.

Example:

```text
Generate a suspicious NPC connected to Captain Vey.
```

### Create an Encounter

1. Choose **Encounter** mode.
2. Turn **Campaign Memory** and **Party Info** on.
3. Type the encounter request.
4. Click **Send**.
5. Review the encounter card.
6. Click **Save Encounter** if it fits your session.
7. If image controls appear, choose a style and click **Generate Image** before saving when you want a visual reference.

Example:

```text
Create a medium encounter for this party involving the Ashen Knives.
```

### Roll Dice

Use the dice roller on the right, or ask DNDMind to roll from the command console.

Example:

```text
Roll 1d20+5 for perception.
```

Expected result: DNDMind shows the roll and keeps the tool result visible.

### Summarize Session Notes

1. Paste raw notes into **Session Notes**.
2. Click **Save**.
3. Click **Summarize**.
4. Review the summary and extracted details.
5. Save useful summaries or cards.

Expected result: important NPCs, quests, locations, hooks, and events become easier to find later.

### Search Campaign Memory

1. Choose **Auto** mode.
2. Turn **Campaign Memory** on.
3. Ask for the name, place, event, or hook you need.
4. Click **Send**.

Example:

```text
Search campaign memory for Captain Vey.
```

### Draft a Prompt with Spark

1. Choose the task mode that matches your goal.
2. Turn on the context toggles you want DNDMind to consider.
3. Click **Spark** in the command console or on a quick prompt.
4. Edit the drafted prompt if needed.
5. Click **Send**.

Spark is useful when you know the kind of help you need but want DNDMind to shape a stronger table-ready request.

### Start a Fresh Chat

Use **Clear** when the chat is long, messy, or tied to an old scene.

1. Check the active campaign.
2. Click **Clear**.
3. Confirm the message.
4. Send your next prompt.

Clearing chat does not delete your campaign, party, Campaign Knowledge, session notes, saved cards, or campaign memory. It only clears the current chat thread.

### Manage Saved Campaign Memory

Campaign Memory is where saved NPCs, quests, locations, hooks, encounters, and summaries live.

1. Find the Campaign Memory area on the right.
2. Open a group, such as **NPCs**, **Open Quests**, **Recent Locations**, **Hooks**, or **Saved Encounters**.
3. Select an item to review details.
4. Delete an item only when you no longer want DNDMind to use it.

Deleting a saved encounter also removes its searchable encounter memory.

## Good Prompt Patterns

The best prompts include names, goals, limits, and what you want back.

Try these:

- `How should I open tonight's session?`
- `What happened at Blackwater Mine?`
- `Generate a suspicious NPC connected to Captain Vey.`
- `Create a medium encounter for this party involving the Ashen Knives.`
- `Make this encounter harder but keep it fair.`
- `Summarize these session notes and extract NPCs, quests, and hooks.`
- `Search campaign memory for unresolved hooks involving Captain Vey.`
- `Roll 1d20+5 for perception.`
- `Recap the campaign so far and list the unresolved hooks.`

Prompt recipe:

```text
Create [thing] for [situation], using [important names], with [tone or limits].
```

Example:

```text
Create three clues for the Blackwater Mine investigation, using Captain Vey as a hidden suspect, with a tense but table-ready tone.
```

## Table Workflows

### Before a Session

1. Review campaign memory for unresolved hooks, NPCs, and locations.
2. Check that party details are current.
3. Add new lore, rules, or prep notes to **Campaign Knowledge**.
4. Turn on **Campaign Memory**.
5. Ask for an opening scene, recap, or prep list.
6. Generate NPCs or encounters you may need.
7. Save useful cards.

### During a Session

1. Use **Auto** for general help.
2. Use **Rules** for rulings.
3. Use the dice roller for rolls and initiative.
4. Search memory when a name, location, or clue returns.
5. Save important new NPCs, hooks, or encounter results.

### After a Session

1. Paste raw notes into **Session Notes**.
2. Click **Save**.
3. Click **Summarize**.
4. Review extracted NPCs, quests, locations, and hooks.
5. Save the summary if it is accurate.
6. Add cleaned lore or rules to **Campaign Knowledge** if you want them cited later.

## Local Browser Profile

DNDMind does not require login. Your browser creates a local profile so your sessions can stay separate from another browser or incognito window.

If you open DNDMind in a different browser, use incognito mode, or clear browser storage, you may not see the same saved sessions.

Use the same browser profile during a campaign so your saved sessions are easier to find.

## Troubleshooting

### The answer has no citations

Likely cause: **Rules** is off, the rules entry is not ready, or the prompt did not need a source lookup.

Try this:

1. Turn **Rules** on.
2. Add a rules document to **Campaign Knowledge**.
3. Confirm the entry is ready to use.
4. Ask again in **Rules** mode.

### Homebrew was ignored

Likely cause: **Homebrew** is off, or the custom rule was added as the wrong document type.

Try this:

1. Turn **Homebrew** on.
2. Check that the entry was added as **Homebrew**.
3. Mention the rule name in your prompt.
4. Ask again.

### The answer forgot my story

Likely cause: **Campaign Memory** is off, or the detail has not been saved yet.

Try this:

1. Turn **Campaign Memory** on.
2. Save session notes, NPCs, quests, locations, summaries, or encounter cards.
3. Ask again with the relevant name, place, or event.

### The encounter ignores the party

Likely cause: **Party Info** is off, or party details are missing.

Try this:

1. Turn **Party Info** on.
2. Add each character's level, HP, AC, class, race, and notes. On phones, party details are in the **Notes** tab.
3. Ask again in **Encounter** mode.

### My upload will not add

Likely cause: the file is the wrong type, too large, empty, or missing a title.

Try this:

1. Use a `.txt` or `.md` file.
2. Keep the file under 2 MB.
3. Add a clear document title.
4. Paste the text instead of uploading if that is easier.

### I see "No active campaigns"

Likely cause: no campaign has been created yet, or all campaigns are archived.

Try this:

1. Click **New** to create a campaign.
2. Or look under **Archived** and click **Restore**.
3. Confirm the campaign name appears at the top.

### DNDMind is using the wrong campaign

Likely cause: the active campaign is not the one you intended.

Try this:

1. Open the campaign selector.
2. Choose the correct campaign.
3. Confirm the active campaign name before sending a prompt.

### I cleared chat by mistake

Likely cause: **Clear** started a fresh conversation.

Your saved campaign material is still there. Check Campaign Memory, Session Notes, Party, and Campaign Knowledge if you need saved details.

## Helpful Terms

- **Active Campaign**: the campaign currently selected in the left sidebar.
- **Archived Campaign**: a campaign moved out of the active list but still available to restore later.
- **Campaign Knowledge**: source text added to a campaign so DNDMind can search and cite it.
- **Campaign Memory**: saved notes, NPCs, quests, locations, encounters, and summaries.
- **Citation**: a source DNDMind used for an answer.
- **Context Toggle**: a switch that controls which saved information DNDMind may use for the next prompt.
- **Local Browser Profile**: the browser-based identity used to keep sessions separate.
- **Structured Card**: a generated NPC, encounter, quest, location, or summary that can be saved.
- **Spark**: the prompt suggestion control that drafts a request for the current mode.
- **Task Mode**: the button that tells DNDMind what kind of answer to produce.
- **Tool Result**: a visible result from an action such as a dice roll, rules search, memory search, or encounter check.
