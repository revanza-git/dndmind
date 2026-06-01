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
                Start with the checklist, then copy one prompt into the command console.
              </p>
            </div>
          </div>
        </aside>

        <div className="bg-[linear-gradient(180deg,_rgba(216,226,220,0.55),_rgba(247,242,233,0)_26rem)] px-4 py-6 sm:px-6 md:px-8 lg:px-10">
          <header className="mx-auto max-w-6xl border-b border-moss/15 pb-8 pt-2 md:pb-10">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-copper">Quick operating guide</p>
                <h2 className="mt-3 max-w-4xl text-4xl font-semibold leading-tight text-ink md:text-5xl">
                  Run DNDMind with confidence at the table.
                </h2>
                <p className="mt-4 max-w-3xl text-base leading-7 text-moss/75">
                  Learn the core workflow: prepare campaign context, ask focused prompts, save generated cards, and keep memory useful across sessions.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 rounded-lg border border-moss/15 bg-white/80 p-3 shadow-sm lg:w-80">
                <Metric label="Setup" value="5 min" />
                <Metric label="Modes" value="7" />
                <Metric label="Flow" value="3" />
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

              <ManualSection id="layout" eyebrow="Screen Map" title="App Layout Overview">
                <div className="grid gap-4 md:grid-cols-2">
                  {layoutAreas.map(([title, detail]) => (
                    <InfoCard key={title} title={title} detail={detail} tone="plain" />
                  ))}
                </div>
              </ManualSection>

              <ManualSection id="guide" eyebrow="Beginner Workflow" title="Step-by-Step Guide">
                <div className="grid gap-4">
                  {steps.map(([title, detail], index) => (
                    <article key={title} className="overflow-hidden rounded-lg border border-moss/15 bg-white shadow-sm">
                      <div className="grid gap-0 sm:grid-cols-[128px_minmax(0,1fr)]">
                        <div className="flex items-center bg-ink px-4 py-3 text-white sm:items-start sm:py-5">
                          <span className="text-sm font-semibold">Step {index + 1}</span>
                        </div>
                        <div className="p-4 sm:p-5">
                          <h4 className="text-lg font-semibold text-ink">{title}</h4>
                          <p className="mt-2 text-sm leading-6 text-moss/75">{detail}</p>
                        </div>
                      </div>
                    </article>
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

              <ManualSection id="prompts" eyebrow="Copy And Run" title="Best Example Prompts">
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

              <ManualSection id="workflows" eyebrow="Table Rhythm" title="Common Workflows">
                <div className="grid gap-4 md:grid-cols-3">
                  {workflows.map(([title, items]) => (
                    <article key={title as string} className="rounded-lg border border-moss/15 bg-white p-4 shadow-sm">
                      <h4 className="text-base font-semibold text-ink">{title as string}</h4>
                      <ol className="mt-4 space-y-3 text-sm leading-6 text-moss/75">
                        {(items as string[]).map((item) => (
                          <li key={item} className="flex gap-2">
                            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-copper" />
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
                  {troubleshooting.map(([issue, fix]) => (
                    <InfoCard key={issue} title={issue} detail={fix} tone="warning" />
                  ))}
                </div>
              </ManualSection>

              <ManualSection id="glossary" eyebrow="Terms" title="Glossary">
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
