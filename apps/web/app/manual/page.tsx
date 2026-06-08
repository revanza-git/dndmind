"use client";

import Link from "next/link";
import { ReactNode, useState } from "react";

type GuideStep = {
  title: string;
  where: string;
  do: string[];
  expected: string;
  why: string;
};

type TryCard = {
  title: string;
  mode: string;
  toggles: string;
  prompt: string;
  expected: string;
};

type Workflow = {
  title: string;
  steps: string[];
};

type TroubleshootingItem = {
  problem: string;
  cause: string;
  fix: string[];
};

const quickStart = [
  {
    title: "Choose campaign",
    detail: "Open the campaign selector and choose the campaign you want DNDMind to use. If it says No active campaigns, click New or restore one from Archived.",
    result: "The active campaign appears at the top.",
    area: "Campaign area"
  },
  {
    title: "Check party",
    detail: "Review or update character level, HP, AC, class, and notes.",
    result: "Encounter prompts can account for party strength.",
    area: "Notes area"
  },
  {
    title: "Add campaign knowledge",
    detail: "Upload or paste rules, lore, or notes, then click Add to Campaign.",
    result: "Rules questions can return citations.",
    area: "Campaign area"
  },
  {
    title: "Add session notes",
    detail: "Paste raw notes, save them, then summarize.",
    result: "NPCs, quests, locations, and hooks become campaign memory.",
    area: "Notes area"
  },
  {
    title: "Ask AI",
    detail: "Pick a mode, set context toggles, and send a command.",
    result: "DNDMind answers with text, sources, tool results, or cards.",
    area: "Command Console"
  },
  {
    title: "Save output",
    detail: "Use suggested actions on character, NPC, quest, location, encounter, hook, or session cards.",
    result: "Characters can join the party list. Other useful cards become campaign memory.",
    area: "Chat workspace"
  },
  {
    title: "Review results",
    detail: "Check citations, tool results, and saved cards before using them at the table.",
    result: "You can see what DNDMind used and decide what to keep.",
    area: "Chat workspace"
  }
];

const firstRunSteps = [
  "Select the campaign Embers of Blackwater, or click New if you are starting from an empty campaign list.",
  "Confirm Embers of Blackwater appears as the active campaign at the top.",
  "Make sure Party Info and Campaign Memory toggles are enabled.",
  "Choose Encounter mode.",
  "Type: Create a medium encounter for this party involving Captain Vey and the Ashen Knives.",
  "Click Send.",
  "Review the AI response, tool result, memory used, and encounter card.",
  "Click Save Encounter if the result is useful."
];

const layoutAreas = [
  ["Campaign area", "Choose, create, edit, archive, or restore campaigns; open Campaign Knowledge; navigate app areas; and return to this manual. On phones, use the Campaign tab."],
  ["Chat workspace", "Read the chat timeline, generated cards, citations, tool results, and save actions. On phones, use the Chat tab."],
  ["Notes area", "Use saved encounters, dice, tonight's prep, session notes, party details, and campaign memory. On phones, use the Notes tab."],
  ["Command Console", "Type your request, choose a mode, set context toggles, use Spark, and send."]
];

const commandCenter = [
  ["Mode buttons", "Decide the kind of AI task. Use Rules for sourced rules answers, Encounter for combat design, NPC for non-player characters, Character for party-ready characters, Recap for campaign history, Summarize for notes, and Auto when the task mixes categories."],
  ["Context toggles", "Decide what information the AI can use. Turn on Campaign Memory for saved story context, Party Info for party-aware answers, and Rules for citations from ready-to-use documents."],
  ["Command Console", "Type the instruction you want DNDMind to perform, then click Send. Specific prompts produce better cards and fewer follow-up questions."],
  ["Structured cards", "Reusable results such as characters, NPCs, quests, locations, encounters, and summaries. Save character cards to the party list and save other useful cards as campaign memory."],
  ["Tool results", "Calculations or app actions performed by the system, such as dice rolls, rules search, memory search, and encounter checks."],
  ["Citations", "Source references showing which knowledge entry or campaign memory DNDMind used for the answer."]
];

const knowledgeGuide = [
  ["Rules", "Rules references for cited rulings, such as advantage, conditions, actions, spells, or table procedures."],
  ["Homebrew", "Custom table rules, house mechanics, custom monsters, custom items, or setting-specific mechanics."],
  ["NPC notes", "Names, motives, secrets, relationships, recurring behavior, and hooks tied to campaign characters."],
  ["Location notes", "Places, factions, dangers, clues, rumors, and details the party may return to later."],
  ["Quest notes", "Objectives, status, complications, rewards, unresolved hooks, and what changed during play."],
  ["Campaign lore", "Factions, history, gods, politics, prophecies, and world truths that should stay consistent."],
  ["Session notes", "Raw or cleaned notes from play that should become searchable campaign context."]
];

const knowledgeSteps = [
  "Open Campaign Knowledge in the left sidebar.",
  "Give the entry a clear title, such as Blackwater Mine Lore or House Rules - Resting.",
  "Choose Rules for rules references, or Homebrew for custom table mechanics.",
  "Download a template if you want a friendly starting shape.",
  "Choose a .txt or .md file, or paste text into the notes box.",
  "Click Add to Campaign and wait until the entry is ready to use."
];

const templateGuide = [
  ["Rules", "Rules references you want cited in answers."],
  ["Session Notes", "Raw notes from play that should become searchable context."],
  ["NPC", "Non-player character details, secrets, relationships, and hooks."],
  ["Location", "Places, points of interest, hazards, and clues."],
  ["Quest", "Objectives, status, complications, and rewards."],
  ["Campaign Lore", "Factions, history, world facts, rumors, and long-running truths."]
];

const contextToggleGuide = [
  ["Rules", "Turn on for cited rules answers from ready-to-use rules entries.", "Turn off for freeform story, brainstorming, or answers that do not need rules lookup."],
  ["Campaign Memory", "Turn on when saved NPCs, quests, locations, summaries, or notes should matter.", "Turn off when you want a fresh idea that does not depend on this campaign."],
  ["Party Info", "Turn on for encounter balance, tactics, difficulty, or character-aware advice.", "Turn off when the party is not relevant to the answer."],
  ["Homebrew", "Turn on when custom rules or house mechanics should affect the answer.", "Turn off when you want standard rules or story context only."]
];

const campaignMenuControls = [
  ["New", "Starts a new campaign and opens a short form for name, description, and response tone.", "Use when you are starting a new table, adventure, one-shot, or test campaign."],
  ["Edit", "Changes the selected campaign's name, description, or response tone.", "Use when the campaign premise or style needs an update."],
  ["Archive", "Moves the selected campaign out of the active list without deleting it.", "Use when a campaign is finished, paused, or not needed today."],
  ["Campaign selector", "Chooses which campaign DNDMind uses right now.", "Check this before asking story-specific questions or saving cards."],
  ["Archived", "Shows campaigns that were put away.", "Use this area when you want to bring an older campaign back."],
  ["Restore", "Moves an archived campaign back into the active selector.", "Use when you archived the wrong campaign or want to continue an older one."]
];

const campaignMenuSteps = [
  {
    title: "Create",
    steps: ["Click New.", "Enter a campaign name.", "Add a short description or response tone if helpful.", "Click Save."],
    expected: "The new campaign becomes active and appears at the top of the workspace."
  },
  {
    title: "Edit",
    steps: ["Choose the campaign in the selector.", "Click Edit.", "Update the name, description, or response tone.", "Click Save."],
    expected: "The campaign keeps its saved notes and memory, but uses the updated campaign details."
  },
  {
    title: "Archive",
    steps: ["Choose the campaign you want to put away.", "Click Archive.", "Confirm the message."],
    expected: "The campaign leaves the active selector and appears under Archived."
  },
  {
    title: "Restore",
    steps: ["Find the campaign under Archived.", "Click Restore."],
    expected: "The campaign returns to the active selector and becomes selected."
  }
];

const steps: GuideStep[] = [
  {
    title: "Create Campaign",
    where: "Campaign area -> Campaign",
    do: [
      "Open the campaign selector to choose an active campaign.",
      "Click New if the selector says No active campaigns or you want a fresh campaign.",
      "Add a campaign name, optional description, and optional response tone.",
      "Click Save.",
      "Use Restore under Archived if you want to continue a campaign that was put away."
    ],
    expected: "The campaign appears in the selector and its name appears at the top.",
    why: "DNDMind uses the active campaign to scope memory, sessions, and generated content."
  },
  {
    title: "Add Party",
    where: "Notes area -> Party",
    do: [
      "Open the party area.",
      "Use Add Character to enter name, class, race, level, HP, AC, initiative, passive perception, and notes.",
      "Use HP for fast damage or healing updates during play.",
      "Use Edit for level, AC, class, race, and note changes.",
      "Open History to review progress and add character notes.",
      "Keep the Party Info toggle on when asking for combat or challenge design."
    ],
    expected: "Party members appear in the party list and encounter answers reference party strength.",
    why: "Party context helps DNDMind tune difficulty and avoid encounters that are too weak or too punishing."
  },
  {
    title: "Add Campaign Knowledge",
    where: "Campaign area -> Campaign Knowledge",
    do: [
      "Open the Campaign Knowledge area.",
      "Upload or paste rules, lore, notes, or NPC details.",
      "Click Add to Campaign.",
      "Ask a Rules mode question such as: How does advantage work?"
    ],
    expected: "Rules answers include citations from the ready-to-use document.",
    why: "Campaign Knowledge gives DNDMind source text instead of relying on unsupported memory."
  },
  {
    title: "Add Session Notes",
    where: "Notes area -> My Local Sessions",
    do: [
      "Paste raw table notes into the notes field.",
      "Save the notes.",
      "Click Summarize or ask Summarize mode to extract NPCs, quests, locations, and hooks."
    ],
    expected: "The summary appears with extracted campaign objects and useful memory entries.",
    why: "Session notes turn table events into future context that DNDMind can retrieve."
  },
  {
    title: "Ask AI",
    where: "Bottom Command Console",
    do: [
      "Choose the mode that matches the task.",
      "Enable the context toggles DNDMind should use.",
      "Enter a specific prompt with names, goals, and constraints.",
      "Click Send."
    ],
    expected: "The center workspace shows a response, and may include citations, tool results, or a structured card.",
    why: "Mode plus context tells DNDMind what kind of answer to produce and which information is allowed."
  },
  {
    title: "Use Tools",
    where: "Command Console or Notes area -> Dice",
    do: [
      "Ask for an action such as rolling dice, searching memory, searching rules, or checking encounter difficulty.",
      "Use prompts like: Roll 1d20+5 for perception.",
      "Review the tool result inside the response."
    ],
    expected: "The response includes a tool result with the calculation, search result, or action summary.",
    why: "Tool results make operational work visible so you can trust what happened during play."
  },
  {
    title: "Save Cards",
    where: "Chat workspace -> Structured Card",
    do: [
      "Review a generated character, NPC, quest, location, encounter, or session summary card.",
      "Confirm it is useful for the campaign.",
      "Click the matching save action, such as Save Character, Save NPC, or Save Encounter."
    ],
    expected: "Saved characters join the party list. Other saved cards become reusable campaign memory.",
    why: "Saving is what turns a one-off AI answer into campaign material DNDMind can reuse later."
  },
  {
    title: "Review Answers",
    where: "Chat workspace",
    do: [
      "Read the answer before using it at the table.",
      "Check citations when the answer is based on rules or memory.",
      "Save useful cards and ignore results you do not want to keep."
    ],
    expected: "You keep only the content that fits your campaign.",
    why: "DNDMind is a co-pilot. The DM still decides what becomes true at the table."
  }
];

const modes = [
  ["Auto", "Mixed tasks and session prep.", "Prepare tonight's opening scene based on last session."],
  ["Rules", "Rules questions that need citations.", "How does advantage work?"],
  ["Encounter", "Combat and challenge design.", "Create a hard ambush for my level 3 party."],
  ["NPC", "Non-player characters, motives, secrets, and relationship hooks.", "Generate a suspicious tavern keeper."],
  ["Character", "Backup player characters, rivals, hirelings, and party-ready allies.", "Generate a level 3 adventurer tied to this campaign."],
  ["Recap", "A table-ready recap from saved campaign memory.", "Recap the campaign so far and list the open hooks."],
  ["Summarize", "Session notes and extracted hooks.", "Summarize this session and extract unresolved hooks."]
];

const tryCards: TryCard[] = [
  {
    title: "Ask a Rules Question",
    mode: "Rules",
    toggles: "Rules ON, Campaign Memory optional, Party Info OFF",
    prompt: "How does advantage work?",
    expected: "DNDMind gives a concise rules answer with citations from ready-to-use rules."
  },
  {
    title: "Generate an NPC",
    mode: "NPC",
    toggles: "Campaign Memory ON, Party Info optional",
    prompt: "Generate a suspicious NPC connected to Captain Vey.",
    expected: "DNDMind returns an NPC card with role, personality, motivation, secret, and quest hook."
  },
  {
    title: "Generate a Character",
    mode: "Character",
    toggles: "Campaign Memory ON, Party Info optional",
    prompt: "Generate a level 3 adventurer tied to this campaign who could work as a backup PC, rival, or hireling.",
    expected: "DNDMind returns a character card. Save Character adds it to the party list."
  },
  {
    title: "Create an Encounter",
    mode: "Encounter",
    toggles: "Campaign Memory ON, Party Info ON",
    prompt: "Create a medium encounter for this party involving the Ashen Knives.",
    expected: "DNDMind returns an encounter briefing, tool result, and structured encounter card."
  },
  {
    title: "Summarize Session Notes",
    mode: "Summarize",
    toggles: "Campaign Memory ON",
    prompt: "Summarize these session notes and extract NPCs, quests, locations, and hooks.",
    expected: "DNDMind returns a session summary card and extracted campaign objects to review."
  },
  {
    title: "Roll Dice",
    mode: "Auto",
    toggles: "No context required",
    prompt: "Roll 1d20+5 for perception.",
    expected: "DNDMind shows the roll result and tool trace in the response."
  },
  {
    title: "Recap the Campaign",
    mode: "Recap",
    toggles: "Campaign Memory ON",
    prompt: "Recap the campaign so far and list the unresolved hooks.",
    expected: "DNDMind returns a table-ready recap based on saved campaign memory."
  },
  {
    title: "Search Campaign Memory",
    mode: "Auto",
    toggles: "Campaign Memory ON",
    prompt: "Search campaign memory for Captain Vey.",
    expected: "DNDMind returns matching memory with citations or context references."
  }
];

const prompts = [
  "How should I open tonight's session?",
  "What happened at Blackwater Mine?",
  "Generate a suspicious NPC connected to Captain Vey.",
  "Generate a level 3 adventurer tied to this campaign who could work as a backup PC, rival, or hireling.",
  "Create a medium encounter for this party involving the Ashen Knives.",
  "Recap the campaign so far and list the unresolved hooks.",
  "Roll 1d20+5 for perception.",
  "Summarize these session notes and extract NPCs, quests, and hooks.",
  "Search campaign memory for Captain Vey.",
  "Make this encounter harder but keep it fair."
];

const workflows: Workflow[] = [
  {
    title: "Prepare a Session",
    steps: [
      "Review the memory panel for unresolved hooks, NPCs, and locations.",
      "Check that Campaign Memory is enabled.",
      "Ask for an opening scene tied to the last session.",
      "Generate an NPC or encounter for the next likely scene.",
      "Save useful cards so they are ready during play."
    ]
  },
  {
    title: "Live Play",
    steps: [
      "Use Auto mode for mixed table help or Encounter mode for tactical moments.",
      "Roll dice from the command console or dice roller.",
      "Ask quick rules questions in Rules mode when a ruling needs support.",
      "Search campaign memory for names, places, and unresolved hooks.",
      "Save important characters, NPCs, hooks, or encounter results before moving on. Saved encounters appear later in Campaign Memory."
    ]
  },
  {
    title: "After Session",
    steps: [
      "Paste raw notes into Session Notes.",
      "Click Summarize or use Summarize mode.",
      "Review extracted NPCs, quests, locations, and hooks.",
      "Save the summary if it accurately captures the session."
    ]
  }
];

const troubleshooting: TroubleshootingItem[] = [
  {
    problem: "AI answer has no citations.",
    cause: "Rules context is off, no rules documents are ready to use, or the prompt did not ask for a sourced ruling.",
    fix: ["Enable the Rules toggle.", "Add a rules document to Campaign Knowledge.", "Confirm the entry is ready to use.", "Ask again in Rules mode."]
  },
  {
    problem: "Homebrew was ignored.",
    cause: "Homebrew is off, or the custom rule was added as the wrong document type.",
    fix: ["Enable the Homebrew toggle.", "Check that the entry was added as Homebrew.", "Mention the rule name in your prompt.", "Ask again in Auto or Rules mode."]
  },
  {
    problem: "Campaign Knowledge will not add my file.",
    cause: "The file may be the wrong type, too large, empty, or missing a clear title.",
    fix: ["Use a .txt or .md file.", "Keep the file under 2 MB.", "Add a document title.", "Paste the text into the notes box if upload is inconvenient."]
  },
  {
    problem: "My session disappeared.",
    cause: "You may be using a different browser, incognito window, or local browser profile.",
    fix: ["Check whether you opened another browser or incognito window.", "Return to the original browser profile.", "Avoid clearing local storage during a campaign."]
  },
  {
    problem: "The campaign selector says No active campaigns.",
    cause: "No campaign has been created yet, or all campaigns are currently archived.",
    fix: ["Click New to create a campaign.", "Or look under Archived and click Restore on the campaign you want.", "Confirm the campaign name appears at the top before asking DNDMind for story help."]
  },
  {
    problem: "Memory answer seems empty.",
    cause: "The active campaign has little saved memory, or Campaign Memory is off.",
    fix: ["Enable Campaign Memory.", "Add session notes.", "Summarize and save useful cards before asking again."]
  },
  {
    problem: "Encounter does not use party info.",
    cause: "Party Info is off or party members are missing details.",
    fix: ["Enable Party Info.", "Add level, HP, AC, class, and notes for each character.", "Ask again in Encounter mode."]
  },
  {
    problem: "DNDMind answers from the wrong campaign.",
    cause: "The active campaign is not the one you intended.",
    fix: ["Open the campaign selector.", "Choose the correct campaign.", "Confirm the active campaign name at the top before sending the prompt."]
  },
  {
    problem: "I archived a campaign by mistake.",
    cause: "The campaign was moved out of the active list, but it was not deleted.",
    fix: ["Find the campaign under Archived.", "Click Restore.", "Choose it in the campaign selector if it is not already selected."]
  },
  {
    problem: "The app says an API key is missing.",
    cause: "The app may need an AI provider setting changed by the person running it.",
    fix: [
      "Ask the person who started the app to check the AI settings.",
      "If your group is using a local-only setup, no paid AI key should be required.",
      "Restart the app after the setting is changed."
    ]
  }
];

const glossary = [
  ["Active Campaign", "The campaign currently selected in the Campaign area."],
  ["Archived Campaign", "A campaign moved out of the active list but still available to restore later."],
  ["Campaign Knowledge", "Source text added to a campaign so DNDMind can search and cite it."],
  ["Campaign Memory", "Saved notes, NPCs, quests, locations, encounters, and summaries DNDMind can use later."],
  ["Context Toggle", "A switch that controls which saved information DNDMind may use for the next prompt."],
  ["Task Mode", "A mode button that tells DNDMind what kind of answer to produce."],
  ["Structured Card", "A generated character, NPC, quest, location, encounter, or summary that you can save."],
  ["Tool Result", "A visible result from an action such as a dice roll, rules search, homebrew search, or memory search."],
  ["Citation", "A source reference attached to an answer so you can see where context came from."],
  ["Spark", "The prompt helper that drafts a request for the current mode and context."],
  ["Local Browser Profile", "The browser-based identity used to keep sessions separate."]
];

const toc = [
  ["Quick Start", "quick-start"],
  ["First Run", "first-run"],
  ["Command Center", "command-center"],
  ["Campaign Menu", "campaign-menu"],
  ["Knowledge", "campaign-knowledge"],
  ["Context", "context-toggles"],
  ["Guide", "guide"],
  ["Try Now", "try-now"],
  ["Modes", "modes"],
  ["Prompts", "prompts"],
  ["Local Profile", "local-profile"],
  ["Workflows", "workflows"],
  ["Troubleshooting", "troubleshooting"],
  ["Helpful Terms", "glossary"]
];

export default function ManualPage() {
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);

  async function copyPrompt(prompt: string) {
    await navigator.clipboard.writeText(prompt);
    setCopiedPrompt(prompt);
    window.setTimeout(() => setCopiedPrompt(null), 1500);
  }

  return (
    <main className="min-h-screen bg-[#f7f2e9] text-ink">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[288px_minmax(0,1fr)]">
        <aside className="border-b border-white/10 bg-moss text-white shadow-2xl shadow-moss/20 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <div className="px-5 pb-4 pt-5 lg:px-6 lg:pb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-mist">DNDMind</p>
            <h1 className="mt-2 text-3xl font-semibold leading-tight">User Manual</h1>
            <p className="mt-3 text-sm leading-6 text-mist/80">
              A practical guide for setting up campaigns, asking better questions, and saving useful table material.
            </p>
          </div>

          <nav
            className="sticky top-0 z-20 border-y border-white/10 bg-moss/95 px-5 py-3 backdrop-blur lg:static lg:border-y-0 lg:px-6 lg:py-0"
            aria-label="Manual sections"
          >
            <div className="flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-1 lg:overflow-visible lg:pb-0">
              {toc.map(([label, target]) => (
                <a
                  key={target}
                  href={`#${target}`}
                  className="shrink-0 rounded-md px-3 py-2 text-sm font-medium text-mist transition hover:bg-white/10 hover:text-white lg:block"
                >
                  {label}
                </a>
              ))}
            </div>
          </nav>

          <div className="px-5 pb-5 pt-4 lg:px-6 lg:pt-8">
            <div className="space-y-2">
              <Link
                href="/"
                className="block rounded-md bg-white px-3 py-2.5 text-sm font-semibold text-moss shadow-sm transition hover:bg-mist"
              >
                Back to Command Center
              </Link>
              <Link
                href="/#command-center"
                className="block rounded-md border border-white/15 px-3 py-2.5 text-sm font-semibold text-mist transition hover:bg-white/10"
              >
                Start with Auto Mode
              </Link>
            </div>
            <div className="mt-6 rounded-md border border-white/10 bg-white/5 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-mist/70">Best first move</p>
              <p className="mt-2 text-sm leading-6 text-mist/85">
                Run the first tutorial, then copy one prompt into the command console.
              </p>
            </div>
          </div>
        </aside>

        <div className="bg-[linear-gradient(180deg,_rgba(216,226,220,0.55),_rgba(247,242,233,0)_26rem)] px-4 py-6 sm:px-6 md:px-8 lg:px-10">
          <header className="mx-auto max-w-6xl border-b border-moss/15 pb-8 pt-2 md:pb-10">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-copper">Table guide</p>
                <h2 className="mt-3 max-w-4xl text-4xl font-semibold leading-tight text-ink md:text-5xl">
                  Run DNDMind with confidence at the table.
                </h2>
                <p className="mt-4 max-w-3xl text-base leading-7 text-moss/75">
                  Learn the exact workflow: choose a campaign, turn on the right context, send a focused prompt, review sources and tools, then save the useful card.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 rounded-lg border border-moss/15 bg-white/80 p-3 shadow-sm lg:w-80">
                <Metric label="Setup" value="5 min" />
                <Metric label="Modes" value="7" />
                <Metric label="Prompts" value="14+" />
              </div>
            </div>
          </header>

          <div className="mx-auto mt-8 grid max-w-6xl gap-8 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-10">
              <ManualSection id="quick-start" eyebrow="First 5 Minutes" title="Quick Start Checklist">
                <div className="grid gap-4 md:grid-cols-2">
                  {quickStart.map((item, index) => (
                    <article key={item.title} className="rounded-lg border border-moss/15 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                      <div className="flex items-start gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-copper text-sm font-semibold text-white shadow-sm">
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <h4 className="text-base font-semibold text-ink">{item.title}</h4>
                          <p className="mt-2 text-sm leading-6 text-moss/75">{item.detail}</p>
                          <p className="mt-3 rounded-md bg-parchment px-3 py-2 text-sm font-medium leading-6 text-moss">
                            {item.result}
                          </p>
                          <span className="mt-3 inline-flex rounded-full border border-moss/10 bg-mist px-2.5 py-1 text-xs font-semibold text-moss">
                            {item.area}
                          </span>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </ManualSection>

              <ManualSection id="first-run" eyebrow="Tutorial" title="Your First Successful Run">
                <article className="rounded-lg border border-moss/15 bg-white p-5 shadow-sm">
                  <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
                    <div>
                      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-copper">Goal</p>
                      <p className="mt-2 text-base leading-7 text-moss/80">
                        Generate and save one useful encounter using campaign memory and party context.
                      </p>
                      <ol className="mt-5 space-y-3 text-sm leading-6 text-moss/80">
                        {firstRunSteps.map((step, index) => (
                          <li key={step} className="flex gap-3">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-ink text-xs font-semibold text-white">
                              {index + 1}
                            </span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                    <div className="rounded-lg border border-copper/20 bg-parchment p-4">
                      <p className="text-sm font-semibold text-ink">Expected result</p>
                      <p className="mt-2 text-sm leading-6 text-moss/80">
                        The center workspace shows an Encounter Briefing, tool result, memory or citation context, and a structured encounter card.
                      </p>
                      <button
                        type="button"
                        onClick={() => copyPrompt("Create a medium encounter for this party involving Captain Vey and the Ashen Knives.")}
                        className="mt-4 w-full rounded-md bg-copper px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-white transition hover:bg-ember"
                      >
                        {copiedPrompt === "Create a medium encounter for this party involving Captain Vey and the Ashen Knives." ? "Copied" : "Copy Tutorial Prompt"}
                      </button>
                    </div>
                  </div>
                </article>
              </ManualSection>

              <ManualSection id="command-center" eyebrow="Screen Map" title="Understanding the Command Center">
                <div className="grid gap-4 md:grid-cols-2">
                  {layoutAreas.map(([title, detail]) => (
                    <InfoCard key={title} title={title} detail={detail} tone="plain" />
                  ))}
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {commandCenter.map(([title, detail]) => (
                    <InfoCard key={title} title={title} detail={detail} tone="definition" />
                  ))}
                </div>
              </ManualSection>

              <ManualSection id="campaign-menu" eyebrow="First Control" title="Campaign Menu">
                <p className="max-w-4xl text-sm leading-6 text-moss/75">
                  The Campaign menu tells DNDMind which campaign you are using right now. Check it before asking story-specific questions, saving cards, adding session notes, or uploading campaign knowledge.
                </p>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  {campaignMenuControls.map(([control, detail, useWhen]) => (
                    <article key={control} className="rounded-lg border border-moss/15 border-l-4 border-l-copper bg-white p-4 shadow-sm">
                      <h4 className="text-base font-semibold text-ink">{control}</h4>
                      <p className="mt-2 text-sm leading-6 text-moss/75">{detail}</p>
                      <p className="mt-3 text-sm font-semibold text-moss">Use when</p>
                      <p className="mt-1 text-sm leading-6 text-moss/75">{useWhen}</p>
                    </article>
                  ))}
                </div>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  {campaignMenuSteps.map((item) => (
                    <article key={item.title} className="rounded-lg border border-moss/15 bg-white p-4 shadow-sm">
                      <h4 className="text-base font-semibold text-ink">{item.title}</h4>
                      <ol className="mt-4 space-y-2 text-sm leading-6 text-moss/75">
                        {item.steps.map((step, index) => (
                          <li key={step} className="flex gap-2">
                            <span className="text-copper">{index + 1}.</span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ol>
                      <p className="mt-4 rounded-md bg-parchment px-3 py-2 text-sm leading-6 text-moss">{item.expected}</p>
                    </article>
                  ))}
                </div>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <InfoCard title="No active campaigns" detail="This means nothing is selected from the active list. Click New to create a campaign, or restore one from Archived." tone="warning" />
                  <InfoCard title="Archive is not delete" detail="Archive puts a campaign away so the active list stays tidy. Use Restore when you want it back." tone="definition" />
                </div>
              </ManualSection>

              <ManualSection id="campaign-knowledge" eyebrow="Sources" title="Campaign Knowledge">
                <p className="max-w-4xl text-sm leading-6 text-moss/75">
                  Campaign Knowledge is where you add source text for the active campaign: rules, lore, NPCs, locations, quests, homebrew, or session notes. DNDMind can search these entries and cite them when the matching context toggle is enabled.
                </p>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  {knowledgeGuide.map(([title, detail]) => (
                    <InfoCard key={title} title={title} detail={detail} tone="definition" />
                  ))}
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <article className="rounded-lg border border-moss/15 bg-white p-4 shadow-sm">
                    <h4 className="text-base font-semibold text-ink">Add an entry</h4>
                    <ol className="mt-4 space-y-3 text-sm leading-6 text-moss/75">
                      {knowledgeSteps.map((step, index) => (
                        <li key={step} className="flex gap-2">
                          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-copper/10 text-xs font-semibold text-copper">
                            {index + 1}
                          </span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                    <p className="mt-4 rounded-md bg-parchment px-3 py-2 text-sm leading-6 text-moss">
                      Supported uploads are .txt and .md files up to 2 MB. Pasted notes work too.
                    </p>
                  </article>
                  <article className="rounded-lg border border-moss/15 bg-white p-4 shadow-sm">
                    <h4 className="text-base font-semibold text-ink">Template guide</h4>
                    <div className="mt-4 divide-y divide-moss/10 rounded-md border border-moss/10">
                      {templateGuide.map(([title, detail]) => (
                        <div key={title} className="px-3 py-3">
                          <p className="text-sm font-semibold text-ink">{title}</p>
                          <p className="mt-1 text-sm leading-6 text-moss/75">{detail}</p>
                        </div>
                      ))}
                    </div>
                  </article>
                </div>
              </ManualSection>

              <ManualSection id="context-toggles" eyebrow="Sources" title="Context Toggles">
                <p className="max-w-4xl text-sm leading-6 text-moss/75">
                  Context toggles control what information DNDMind may use for the next answer. They do not erase or change saved data; they only shape the prompt you are about to send.
                </p>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  {contextToggleGuide.map(([title, useWhen, skipWhen]) => (
                    <article key={title} className="rounded-lg border border-moss/15 border-l-4 border-l-copper bg-white p-4 shadow-sm">
                      <h4 className="text-base font-semibold text-ink">{title}</h4>
                      <p className="mt-3 text-sm font-semibold text-moss">Use when</p>
                      <p className="mt-1 text-sm leading-6 text-moss/75">{useWhen}</p>
                      <p className="mt-4 text-sm font-semibold text-moss">Skip when</p>
                      <p className="mt-1 text-sm leading-6 text-moss/75">{skipWhen}</p>
                    </article>
                  ))}
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  <InfoCard title="Rules questions" detail="Use Rules mode with Rules on. Add Homebrew only when custom rules should affect the ruling." tone="definition" />
                  <InfoCard title="Encounter design" detail="Use Encounter mode with Campaign Memory and Party Info on." tone="definition" />
                  <InfoCard title="NPC or story work" detail="Use NPC or Auto mode with Campaign Memory on when the answer should fit your campaign." tone="definition" />
                  <InfoCard title="Character generation" detail="Use Character mode with Campaign Memory on when a backup PC, rival, or hireling should fit the campaign." tone="definition" />
                  <InfoCard title="Campaign recap" detail="Use Recap mode with Campaign Memory on when you want a table-ready summary of what happened so far." tone="definition" />
                  <InfoCard title="Pure brainstorming" detail="Use Auto with only the context you need so the answer stays flexible." tone="definition" />
                </div>
              </ManualSection>

              <ManualSection id="guide" eyebrow="Beginner Workflow" title="Step-by-Step Guide">
                <div className="grid gap-4">
                  {steps.map((step, index) => (
                    <GuideStepCard key={step.title} step={step} index={index} />
                  ))}
                </div>
              </ManualSection>

              <ManualSection id="try-now" eyebrow="Practice Cards" title="Try This Now">
                <div className="grid gap-4 md:grid-cols-2">
                  {tryCards.map((card) => (
                    <TryPromptCard key={card.title} card={card} copiedPrompt={copiedPrompt} onCopy={copyPrompt} />
                  ))}
                </div>
              </ManualSection>

              <ManualSection id="modes" eyebrow="Command Modes" title="AI Modes Guide">
                <div className="grid gap-4 md:grid-cols-2">
                  {modes.map(([name, bestFor, example]) => (
                    <article key={name} className="rounded-lg border border-moss/15 bg-white p-4 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-lg font-semibold text-ink">{name}</h4>
                        <span className="rounded-full bg-copper/10 px-2.5 py-1 text-xs font-semibold text-copper">mode</span>
                      </div>
                      <p className="mt-3 text-sm font-semibold text-moss">Best for</p>
                      <p className="mt-1 text-sm leading-6 text-moss/75">{bestFor}</p>
                      <p className="mt-4 text-sm font-semibold text-moss">Example prompt</p>
                      <p className="mt-1 rounded-md border border-moss/10 bg-parchment px-3 py-2 text-sm leading-6 text-moss">{example}</p>
                    </article>
                  ))}
                </div>
              </ManualSection>

              <ManualSection id="prompts" eyebrow="Copy And Run" title="Recommended First Prompts">
                <div className="grid gap-4 md:grid-cols-2">
                  {prompts.map((prompt) => (
                    <article key={prompt} className="flex min-h-44 flex-col rounded-lg border border-moss/15 bg-white p-4 shadow-sm">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-copper">Prompt</p>
                      <p className="mt-3 flex-1 text-sm leading-6 text-moss">{prompt}</p>
                      <button
                        type="button"
                        onClick={() => copyPrompt(prompt)}
                        className="mt-4 w-full rounded-md bg-copper px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-white transition hover:bg-ember sm:w-auto sm:self-start"
                      >
                        {copiedPrompt === prompt ? "Copied" : "Copy Prompt"}
                      </button>
                    </article>
                  ))}
                </div>
              </ManualSection>

              <ManualSection id="local-profile" eyebrow="Browser Sessions" title="Local Browser Profile">
                <article className="rounded-lg border border-moss/15 bg-white p-5 shadow-sm">
                  <div className="grid gap-4 md:grid-cols-2">
                    <InfoCard title="No login required" detail="You do not need an account. The browser keeps a local profile for your sessions." tone="definition" />
                    <InfoCard title="Browser scoped" detail="Another browser or incognito window may show a different session list." tone="definition" />
                    <InfoCard title="Storage matters" detail="Clearing browser storage may hide sessions tied to the previous browser profile." tone="warning" />
                    <InfoCard title="Same browser helps" detail="Use the same browser profile during a campaign so your saved sessions are easy to find." tone="definition" />
                  </div>
                </article>
              </ManualSection>

              <ManualSection id="workflows" eyebrow="Table Rhythm" title="Common Workflows">
                <div className="grid gap-4 md:grid-cols-3">
                  {workflows.map((workflow) => (
                    <article key={workflow.title} className="rounded-lg border border-moss/15 bg-white p-4 shadow-sm">
                      <h4 className="text-base font-semibold text-ink">{workflow.title}</h4>
                      <ol className="mt-4 space-y-3 text-sm leading-6 text-moss/75">
                        {workflow.steps.map((item, index) => (
                          <li key={item} className="flex gap-2">
                            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-copper/10 text-xs font-semibold text-copper">
                              {index + 1}
                            </span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ol>
                    </article>
                  ))}
                </div>
              </ManualSection>

              <ManualSection id="troubleshooting" eyebrow="Fix Fast" title="Troubleshooting">
                <div className="grid gap-4 md:grid-cols-2">
                  {troubleshooting.map((item) => (
                    <TroubleshootingCard key={item.problem} item={item} />
                  ))}
                </div>
              </ManualSection>

              <ManualSection id="glossary" eyebrow="Plain Language" title="Helpful Terms">
                <div className="grid gap-4 md:grid-cols-2">
                  {glossary.map(([term, definition]) => (
                    <InfoCard key={term} title={term} detail={definition} tone="definition" />
                  ))}
                </div>
              </ManualSection>
            </div>

            <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
              <div className="rounded-lg border border-moss/15 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-copper">Context Toggles</p>
                <div className="mt-3 space-y-3 text-sm leading-6 text-moss/75">
                  <p><strong className="text-ink">Rules:</strong> uses ready-to-use rules and citations.</p>
                  <p><strong className="text-ink">Campaign Memory:</strong> uses summaries, NPCs, quests, and locations.</p>
                  <p><strong className="text-ink">Party Info:</strong> uses level, HP, AC, class, race, and notes.</p>
                  <p><strong className="text-ink">Homebrew:</strong> reserved for custom campaign rules.</p>
                </div>
              </div>
              <div className="rounded-lg border border-moss/15 bg-ink p-4 text-mist shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-copper">First prompt to try</p>
                <p className="mt-3 text-sm leading-6">
                  Create a medium encounter for this party involving Captain Vey and the Ashen Knives.
                </p>
              </div>
              <div className="rounded-lg border border-moss/15 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-copper">Beginner Rule</p>
                <p className="mt-3 text-sm leading-6 text-moss/75">
                  Save anything you want to reuse. Summaries and saved cards are what turn one-off answers into campaign memory.
                </p>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </main>
  );
}

function ManualSection({
  id,
  eyebrow,
  title,
  children
}: {
  id: string;
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-copper">{eyebrow}</p>
      <h3 className="mt-2 text-2xl font-semibold text-ink md:text-3xl">{title}</h3>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function GuideStepCard({ step, index }: { step: GuideStep; index: number }) {
  return (
    <article className="overflow-hidden rounded-lg border border-moss/15 bg-white shadow-sm">
      <div className="grid gap-0 lg:grid-cols-[150px_minmax(0,1fr)]">
        <div className="bg-ink px-4 py-4 text-white lg:py-5">
          <p className="text-sm font-semibold">Step {index + 1}</p>
          <p className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-mist/70">{step.title}</p>
        </div>
        <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:p-5">
          <div>
            <p className="text-sm font-semibold text-ink">Where</p>
            <p className="mt-1 rounded-md bg-parchment px-3 py-2 text-sm leading-6 text-moss">{step.where}</p>
            <p className="mt-4 text-sm font-semibold text-ink">Do</p>
            <ol className="mt-2 space-y-2 text-sm leading-6 text-moss/75">
              {step.do.map((item, itemIndex) => (
                <li key={item} className="flex gap-2">
                  <span className="text-copper">{itemIndex + 1}.</span>
                  <span>{item}</span>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">Expected result</p>
            <p className="mt-1 text-sm leading-6 text-moss/75">{step.expected}</p>
            <p className="mt-4 text-sm font-semibold text-ink">Why it matters</p>
            <p className="mt-1 text-sm leading-6 text-moss/75">{step.why}</p>
          </div>
        </div>
      </div>
    </article>
  );
}

function TryPromptCard({
  card,
  copiedPrompt,
  onCopy
}: {
  card: TryCard;
  copiedPrompt: string | null;
  onCopy: (prompt: string) => void;
}) {
  return (
    <article className="flex min-h-72 flex-col rounded-lg border border-moss/15 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-copper">Try This Now</p>
      <h4 className="mt-2 text-lg font-semibold text-ink">{card.title}</h4>
      <div className="mt-4 grid gap-3 text-sm leading-6 text-moss/75">
        <p><strong className="text-ink">Mode:</strong> {card.mode}</p>
        <p><strong className="text-ink">Toggles:</strong> {card.toggles}</p>
        <div>
          <p className="font-semibold text-ink">Prompt to copy</p>
          <p className="mt-1 rounded-md border border-moss/10 bg-parchment px-3 py-2 text-moss">{card.prompt}</p>
        </div>
        <p><strong className="text-ink">Expected result:</strong> {card.expected}</p>
      </div>
      <button
        type="button"
        onClick={() => onCopy(card.prompt)}
        className="mt-auto w-full rounded-md bg-copper px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-white transition hover:bg-ember sm:w-auto sm:self-start"
      >
        {copiedPrompt === card.prompt ? "Copied" : "Copy Prompt"}
      </button>
    </article>
  );
}

function TroubleshootingCard({ item }: { item: TroubleshootingItem }) {
  return (
    <article className="rounded-lg border border-moss/15 border-l-4 border-l-ember bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ember">Problem</p>
      <h4 className="mt-1 text-base font-semibold text-ink">{item.problem}</h4>
      <p className="mt-3 text-sm font-semibold text-moss">Cause</p>
      <p className="mt-1 text-sm leading-6 text-moss/75">{item.cause}</p>
      <p className="mt-4 text-sm font-semibold text-moss">Fix</p>
      <ol className="mt-2 space-y-2 text-sm leading-6 text-moss/75">
        {item.fix.map((fix, index) => (
          <li key={fix} className="flex gap-2">
            <span className="text-copper">{index + 1}.</span>
            <span>{fix}</span>
          </li>
        ))}
      </ol>
    </article>
  );
}

function InfoCard({ title, detail, tone = "plain" }: { title: string; detail: string; tone?: "plain" | "warning" | "definition" }) {
  const toneClass =
    tone === "warning"
      ? "border-l-4 border-l-ember"
      : tone === "definition"
        ? "border-l-4 border-l-copper"
        : "";

  return (
    <article className={`rounded-lg border border-moss/15 bg-white p-4 shadow-sm ${toneClass}`}>
      <h4 className="text-base font-semibold text-ink">{title}</h4>
      <p className="mt-2 text-sm leading-6 text-moss/75">{detail}</p>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-parchment px-3 py-3 text-center">
      <p className="text-lg font-semibold text-ink">{value}</p>
      <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-moss/65">{label}</p>
    </div>
  );
}
