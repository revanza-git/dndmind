"use client";

import Link from "next/link";
import { ReactNode, useState } from "react";

const quickStart = [
  {
    title: "Create campaign",
    detail: "Choose the campaign workspace DNDMind should use.",
    result: "Active campaign summary appears at the top.",
    area: "Left Sidebar"
  },
  {
    title: "Add party",
    detail: "Review player characters with level, class, HP, AC, and notes.",
    result: "Encounter prompts can account for party strength.",
    area: "Right Panel"
  },
  {
    title: "Add rules",
    detail: "Upload or paste SRD-style rules text and ingest it into chunks.",
    result: "Rules questions can return citations.",
    area: "Rules Library"
  },
  {
    title: "Add session notes",
    detail: "Paste raw notes, save them, then summarize.",
    result: "NPCs, quests, locations, and hooks become campaign memory.",
    area: "Session Notes"
  },
  {
    title: "Ask AI",
    detail: "Pick a mode, set context toggles, and send a command.",
    result: "DNDMind answers with sources, tools, or structured cards.",
    area: "Command Console"
  },
  {
    title: "Save output",
    detail: "Use suggested actions on NPC, quest, location, encounter, or session cards.",
    result: "Useful generated content becomes reusable memory.",
    area: "Center Workspace"
  },
  {
    title: "Run evals",
    detail: "Use the evaluation snapshot and eval prompt to check expected behavior.",
    result: "Rules, memory, tools, JSON, and hallucination checks stay visible.",
    area: "Evaluations"
  }
];

const layoutAreas = [
  ["Left Sidebar", "Campaign selector, rules documents, workspace navigation, and the manual link."],
  ["Center Workspace", "AI chat timeline, citations, tool results, and structured cards."],
  ["Right Panel", "Dice roller, eval snapshot, session notes, party details, memory, citations, and tool traces."],
  ["Command Console", "The bottom input where you send AI instructions with the selected mode and context."]
];

const steps = [
  ["Create Campaign", "Select or create a campaign such as Shadows of Eldermire. The active campaign controls chat, memory, party, rules, and saved outputs."],
  ["Add Party", "Track name, class, race, level, HP, AC, and notes. DNDMind uses this when encounter prompts need fair difficulty."],
  ["Ingest Rules", "Upload or paste rules text, then ingest it into searchable chunks. Try asking: How does advantage work?"],
  ["Add Session Notes", "Paste notes like Captain Vey betrayed the party at Blackwater Mine, then summarize to extract reusable memory."],
  ["Ask AI", "Use Auto for mixed prep, Rules for citations, Story for narration, Encounter for combat design, NPC for characters, Combat for dice and tactics, and Summarize for notes."],
  ["Use Tools", "Ask for dice rolls, initiative, encounter difficulty, rules search, or memory search. Tool results appear inside the response."],
  ["Save Cards", "Save NPC, quest, location, encounter, and session summary cards so generated content becomes campaign memory."],
  ["Run Evals", "Review pass rate, rules accuracy, citation correctness, memory recall, JSON validity, tool-calling correctness, and hallucination resistance."]
];

const modes = [
  ["Auto", "Mixed tasks and session prep.", "Prepare tonight's opening scene based on last session."],
  ["Rules", "Rules questions that need citations.", "How does advantage work?"],
  ["Story", "Narration, atmosphere, and scene framing.", "Describe the ruined temple entrance."],
  ["Encounter", "Combat and challenge design.", "Create a hard ambush for my level 3 party."],
  ["NPC", "Character creation and relationship hooks.", "Generate a suspicious tavern keeper."],
  ["Combat", "Dice, initiative, tactics, and table actions.", "Roll initiative for the party and goblins."],
  ["Summarize", "Session notes and extracted hooks.", "Summarize this session and extract unresolved hooks."]
];

const prompts = [
  "How should I open tonight's session?",
  "What happened at Blackwater Mine?",
  "Generate a suspicious NPC connected to Captain Vey.",
  "Create a medium encounter for this party involving the Ashen Knives.",
  "Summarize these session notes and extract NPCs, quests, and hooks.",
  "Roll 1d20+5 for perception.",
  "Search campaign memory for Captain Vey.",
  "Make this encounter harder but keep it fair."
];

const workflows = [
  ["Prepare session", ["Review memory", "Ask for opening scene", "Generate NPC", "Generate encounter", "Save useful outputs"]],
  ["Live play", ["Ask rules question", "Roll dice", "Generate quick NPC", "Search campaign memory", "Save important result"]],
  ["After session", ["Paste notes", "Summarize session", "Extract memory", "Review unresolved hooks", "Run evals if needed"]]
];

const troubleshooting = [
  ["No campaign selected", "Create or select a campaign first."],
  ["AI answer has no citations", "Enable Rules context and ingest rules documents."],
  ["Memory answer seems empty", "Add session notes and summarize them first."],
  ["Encounter does not use party info", "Enable Party Info context and add party members."],
  ["API key not configured", "Use MOCK_LLM=true for local demo, or configure an API key in .env."],
  ["Docker service error", "Check docker compose logs and service health endpoints."]
];

const glossary = [
  ["RAG", "Retrieval augmented generation. DNDMind searches rules or memory before answering."],
  ["Embeddings", "Numeric representations of text used to compare meaning."],
  ["Vector DB", "pgvector-backed storage for semantic search over rules and campaign memory."],
  ["Tool calling", "AI-triggered app actions such as dice rolling, rules search, memory search, or difficulty calculation."],
  ["Eval", "A repeatable test case that checks whether AI behavior stays accurate and structured."],
  ["Structured output", "A typed card such as an NPC, quest, location, encounter, or session summary."],
  ["Citation", "A source reference attached to an answer so the user can see where context came from."],
  ["Mock LLM mode", "Deterministic local behavior for demos without paid API calls."]
];

const toc = [
  ["Quick Start", "quick-start"],
  ["Layout", "layout"],
  ["Guide", "guide"],
  ["Modes", "modes"],
  ["Prompts", "prompts"],
  ["Workflows", "workflows"],
  ["Troubleshooting", "troubleshooting"],
  ["Glossary", "glossary"]
];

export default function ManualPage() {
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);

  async function copyPrompt(prompt: string) {
    await navigator.clipboard.writeText(prompt);
    setCopiedPrompt(prompt);
    window.setTimeout(() => setCopiedPrompt(null), 1500);
  }

  return (
    <main className="min-h-screen bg-parchment text-ink">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[270px_minmax(0,1fr)]">
        <aside className="border-b border-white/10 bg-moss px-5 py-5 text-white shadow-2xl shadow-moss/20 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-mist">DNDMind</p>
          <h1 className="mt-2 text-3xl font-semibold leading-tight">User Manual</h1>
          <p className="mt-2 text-sm leading-6 text-mist/80">Learn the full workflow in 5 minutes.</p>

          <div className="mt-6 space-y-2">
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

          <nav className="mt-8 space-y-2 text-sm" aria-label="Manual sections">
            {toc.map(([label, target]) => (
              <a key={target} href={`#${target}`} className="block rounded-md px-3 py-2 font-medium text-mist transition hover:bg-white/10">
                {label}
              </a>
            ))}
          </nav>
        </aside>

        <div className="bg-[radial-gradient(circle_at_top,_rgba(216,226,220,0.65),_transparent_34rem)] px-5 py-6 md:px-8 lg:px-10">
          <header className="mx-auto max-w-6xl rounded-lg border border-moss/15 bg-white/85 p-6 shadow-xl shadow-moss/10 md:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-copper">Quick operating guide</p>
            <h2 className="mt-3 text-4xl font-semibold leading-tight text-ink md:text-5xl">DNDMind User Manual</h2>
            <p className="mt-4 max-w-3xl text-base leading-7 text-moss/75">
              Learn how to set up a campaign, use AI modes, retrieve rules, manage memory, generate content, and run evaluations.
            </p>
          </header>

          <div className="mx-auto mt-6 grid max-w-6xl gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-6">
              <ManualSection id="quick-start" eyebrow="First 5 Minutes" title="Quick Start Checklist">
                <div className="grid gap-3 md:grid-cols-2">
                  {quickStart.map((item, index) => (
                    <article key={item.title} className="rounded-lg border border-moss/15 bg-white p-4 shadow-sm">
                      <div className="flex items-start gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-copper text-sm font-semibold text-white">
                          {index + 1}
                        </span>
                        <div>
                          <h4 className="text-base font-semibold text-ink">{item.title}</h4>
                          <p className="mt-2 text-sm leading-6 text-moss/75">{item.detail}</p>
                          <p className="mt-3 text-sm font-medium text-moss">Expected: {item.result}</p>
                          <span className="mt-3 inline-flex rounded-full bg-mist px-2.5 py-1 text-xs font-semibold text-moss">
                            {item.area}
                          </span>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </ManualSection>

              <ManualSection id="layout" eyebrow="Screen Map" title="App Layout Overview">
                <div className="grid gap-3 md:grid-cols-2">
                  {layoutAreas.map(([title, detail]) => (
                    <InfoCard key={title} title={title} detail={detail} />
                  ))}
                </div>
              </ManualSection>

              <ManualSection id="guide" eyebrow="Beginner Workflow" title="Step-by-Step Guide">
                <div className="grid gap-3">
                  {steps.map(([title, detail], index) => (
                    <article key={title} className="rounded-lg border border-moss/15 bg-white p-4 shadow-sm">
                      <div className="flex flex-col gap-3 sm:flex-row">
                        <span className="rounded-md bg-ink px-3 py-2 text-sm font-semibold text-white sm:self-start">Step {index + 1}</span>
                        <div>
                          <h4 className="text-lg font-semibold text-ink">{title}</h4>
                          <p className="mt-2 text-sm leading-6 text-moss/75">{detail}</p>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </ManualSection>

              <ManualSection id="modes" eyebrow="Command Modes" title="AI Modes Guide">
                <div className="grid gap-3 md:grid-cols-2">
                  {modes.map(([name, bestFor, example]) => (
                    <article key={name} className="rounded-lg border border-moss/15 bg-white p-4 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-lg font-semibold text-ink">{name}</h4>
                        <span className="rounded-full bg-copper/10 px-2.5 py-1 text-xs font-semibold text-copper">mode</span>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-moss/75">{bestFor}</p>
                      <p className="mt-3 rounded-md bg-parchment px-3 py-2 text-sm text-moss">{example}</p>
                    </article>
                  ))}
                </div>
              </ManualSection>

              <ManualSection id="prompts" eyebrow="Copy And Run" title="Best Example Prompts">
                <div className="grid gap-3 md:grid-cols-2">
                  {prompts.map((prompt) => (
                    <article key={prompt} className="rounded-lg border border-moss/15 bg-white p-4 shadow-sm">
                      <p className="min-h-16 text-sm leading-6 text-moss">{prompt}</p>
                      <button
                        type="button"
                        onClick={() => copyPrompt(prompt)}
                        className="mt-4 rounded-md bg-copper px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white transition hover:bg-ember"
                      >
                        {copiedPrompt === prompt ? "Copied" : "Copy Prompt"}
                      </button>
                    </article>
                  ))}
                </div>
              </ManualSection>

              <ManualSection id="workflows" eyebrow="Table Rhythm" title="Common Workflows">
                <div className="grid gap-3 md:grid-cols-3">
                  {workflows.map(([title, items]) => (
                    <article key={title as string} className="rounded-lg border border-moss/15 bg-white p-4 shadow-sm">
                      <h4 className="text-base font-semibold text-ink">{title as string}</h4>
                      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-moss/75">
                        {(items as string[]).map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ol>
                    </article>
                  ))}
                </div>
              </ManualSection>

              <ManualSection id="troubleshooting" eyebrow="Fix Fast" title="Troubleshooting">
                <div className="grid gap-3 md:grid-cols-2">
                  {troubleshooting.map(([issue, fix]) => (
                    <InfoCard key={issue} title={issue} detail={fix} />
                  ))}
                </div>
              </ManualSection>

              <ManualSection id="glossary" eyebrow="Terms" title="Glossary">
                <div className="grid gap-3 md:grid-cols-2">
                  {glossary.map(([term, definition]) => (
                    <InfoCard key={term} title={term} detail={definition} />
                  ))}
                </div>
              </ManualSection>
            </div>

            <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
              <div className="rounded-lg border border-moss/15 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-copper">Context Toggles</p>
                <div className="mt-3 space-y-3 text-sm leading-6 text-moss/75">
                  <p><strong className="text-ink">Rules:</strong> uses ingested rules and citations.</p>
                  <p><strong className="text-ink">Campaign Memory:</strong> uses summaries, NPCs, quests, and locations.</p>
                  <p><strong className="text-ink">Party Info:</strong> uses level, HP, AC, class, race, and notes.</p>
                  <p><strong className="text-ink">Homebrew:</strong> reserved for custom campaign rules.</p>
                </div>
              </div>
              <div className="rounded-lg border border-moss/15 bg-ink p-4 text-mist shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-copper">Why this project matters</p>
                <p className="mt-3 text-sm leading-6">
                  DNDMind demonstrates full-stack LLM architecture, RAG, pgvector, tool calling, structured output, memory, evals, and Docker deployment in one reviewer-friendly app.
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
    <section id={id} className="scroll-mt-6 rounded-lg border border-moss/15 bg-parchment/70 p-4 shadow-sm md:p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-copper">{eyebrow}</p>
      <h3 className="mt-1 text-2xl font-semibold text-ink">{title}</h3>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function InfoCard({ title, detail }: { title: string; detail: string }) {
  return (
    <article className="rounded-lg border border-moss/15 bg-white p-4 shadow-sm">
      <h4 className="text-base font-semibold text-ink">{title}</h4>
      <p className="mt-2 text-sm leading-6 text-moss/75">{detail}</p>
    </article>
  );
}
