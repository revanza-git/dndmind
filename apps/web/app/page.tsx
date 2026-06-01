"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Campaign,
  CampaignMemory,
  ChatContext,
  ChatResponse,
  Citation,
  KnowledgeDocument,
  PartyCharacter,
  Session,
  StructuredOutput,
  SuggestedAction,
  ToolCall,
  createSession,
  executeTool,
  getCampaignMemory,
  getCampaigns,
  getDocuments,
  getParty,
  getSessions,
  ingestDocument,
  saveEncounter,
  saveLocation,
  saveNpc,
  saveQuest,
  sendChat,
  summarizeSession,
  updateSession,
  uploadDocument
} from "../lib/api";
import { StructuredOutputRenderer } from "../components/structured/StructuredOutputRenderer";

const modes = ["Auto", "Rules", "Story", "Encounter", "NPC", "Combat", "Summarize"];
const quickPrompts = [
  { label: "Ask a rules question", mode: "Rules", prompt: "How does advantage work, and when should I ask for a check?" },
  { label: "Generate an NPC", mode: "NPC", prompt: "Generate a memorable tavern informant tied to the party's current quest." },
  { label: "Create an encounter", mode: "Encounter", prompt: "Create a tense but fair encounter for tonight's session." },
  { label: "Summarize session", mode: "Summarize", prompt: "Summarize the current session notes and extract unresolved hooks." },
  { label: "Search campaign memory", mode: "Auto", prompt: "Search campaign memory for unresolved hooks involving Captain Vey." }
];
const navigationItems = [
  { label: "Command", targetId: "command-center" },
  { label: "Campaign Memory", targetId: "campaign-memory" },
  { label: "Rules Library", targetId: "rules-library" },
  { label: "Encounters", targetId: "encounters" },
  { label: "Evaluations", targetId: "evaluations" }
];
const evaluationCases = [
  ["Rules RAG", "citation required"],
  ["Memory Recall", "Captain Vey fact"],
  ["Tool Calling", "dice + encounter"],
  ["Structured Output", "NPC card"],
  ["Faithfulness", "expected facts"]
];

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  toolCalls?: ToolCall[];
  structuredOutput?: StructuredOutput | null;
  suggestedActions?: SuggestedAction[];
};

type ResultEnhancements = {
  content: string;
  citations: Citation[];
  toolCalls: ToolCall[];
  structuredOutput: StructuredOutput | null;
  suggestedActions: SuggestedAction[];
};

export default function Home() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [party, setParty] = useState<PartyCharacter[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState("Session Notes");
  const [sessionNotes, setSessionNotes] = useState(
    "Captain Vey betrayed the party last session at Blackwater Mine. He sold the map to the Ashen Knives and escaped through the old smuggler tunnel. Mira swore to track him down. The party recovered the Dawn Shard but still does not know who paid Vey."
  );
  const [memory, setMemory] = useState<CampaignMemory>({ npcs: [], quests: [], locations: [], events: [] });
  const [mode, setMode] = useState("Auto");
  const [context, setContext] = useState<ChatContext>({
    useRules: true,
    useCampaignMemory: true,
    usePartyInfo: true,
    useHomebrew: false
  });
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lastResponse, setLastResponse] = useState<ChatResponse | null>(null);
  const [input, setInput] = useState("How should I open tonight's session?");
  const [documentTitle, setDocumentTitle] = useState("SRD Sample Rules");
  const [documentContent, setDocumentContent] = useState("");
  const [diceExpression, setDiceExpression] = useState("1d20+5");
  const [manualToolCall, setManualToolCall] = useState<ToolCall | null>(null);
  const [isIngesting, setIsIngesting] = useState(false);
  const [isRolling, setIsRolling] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeNavigationItem, setActiveNavigationItem] = useState("Command");
  const timelineEndRef = useRef<HTMLDivElement | null>(null);

  const activeCampaign = useMemo(
    () => campaigns.find((campaign) => campaign.id === campaignId) ?? null,
    [campaignId, campaigns]
  );

  useEffect(() => {
    getCampaigns()
      .then((items) => {
        setCampaigns(items);
        if (items[0]) {
          setCampaignId(items[0].id);
        }
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!campaignId) {
      return;
    }

    getParty(campaignId)
      .then(setParty)
      .catch((err: Error) => setError(err.message));
    getDocuments(campaignId)
      .then(setDocuments)
      .catch((err: Error) => setError(err.message));
    getCampaignMemory(campaignId)
      .then(setMemory)
      .catch((err: Error) => setError(err.message));
    getSessions(campaignId)
      .then((items) => {
        setSessions(items);
        if (items[0]) {
          setActiveSessionId(items[0].id);
          setSessionTitle(items[0].title);
          setSessionNotes(items[0].rawNotes ?? "");
        } else {
          setActiveSessionId(null);
          setSessionTitle("Session Notes");
        }
      })
      .catch((err: Error) => setError(err.message));
  }, [campaignId]);

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isSending, error]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!campaignId || !input.trim()) {
      return;
    }

    const userMessage = input.trim();
    setMessages((current) => [...current, { role: "user", content: userMessage }]);
    setInput("");
    setIsSending(true);
    setError(null);

    try {
      const response = await sendChat({
        campaignId,
        conversationId,
        message: userMessage,
        mode,
        context
      });
      setConversationId(response.conversationId);
      const enhanced = enhanceChatResultForDemo(userMessage, response);
      setLastResponse({
        ...response,
        answer: enhanced.content,
        citations: enhanced.citations,
        toolCalls: enhanced.toolCalls,
        structuredOutput: enhanced.structuredOutput,
        suggestedActions: enhanced.suggestedActions
      });
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: enhanced.content,
          citations: enhanced.citations,
          toolCalls: enhanced.toolCalls,
          structuredOutput: enhanced.structuredOutput,
          suggestedActions: enhanced.suggestedActions
        }
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsSending(false);
    }
  }

  function toggleContext(key: keyof ChatContext) {
    setContext((current) => ({ ...current, [key]: !current[key] }));
  }

  function handleQuickPrompt(prompt: (typeof quickPrompts)[number]) {
    setMode(prompt.mode);
    setInput(prompt.prompt);
  }

  function handleLoadDemoScenario() {
    const prompt = "Create a medium encounter for this party involving Captain Vey and the Ashen Knives.";
    const response: ChatResponse = {
      conversationId: conversationId ?? "demo-encounter",
      answer: "",
      mode: "Encounter",
      citations: [],
      toolCalls: [],
      structuredOutput: null,
      suggestedActions: []
    };
    const enhanced = enhanceChatResultForDemo(prompt, response);
    setMode("Encounter");
    setInput("");
    setLastResponse({
      ...response,
      answer: enhanced.content,
      citations: enhanced.citations,
      toolCalls: enhanced.toolCalls,
      structuredOutput: enhanced.structuredOutput,
      suggestedActions: enhanced.suggestedActions
    });
    setMessages([
      { role: "user", content: prompt },
      {
        role: "assistant",
        content: enhanced.content,
        citations: enhanced.citations,
        toolCalls: enhanced.toolCalls,
        structuredOutput: enhanced.structuredOutput,
        suggestedActions: enhanced.suggestedActions
      }
    ]);
  }

  function handleNavigationClick(item: (typeof navigationItems)[number]) {
    setActiveNavigationItem(item.label);
    document.getElementById(item.targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (item.label === "Evaluations") {
      setInput("Run the sample eval suite for rules, memory, tools, and structured output.");
    }
  }

  async function handleDocumentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!campaignId || !documentTitle.trim() || !documentContent.trim()) {
      return;
    }

    setIsIngesting(true);
    setError(null);
    try {
      const uploaded = await uploadDocument({
        campaignId,
        title: documentTitle.trim(),
        content: documentContent,
        sourceType: "rules"
      });
      await ingestDocument(uploaded.id);
      setDocuments(await getDocuments(campaignId));
      setDocumentContent("");
      setInput("How does advantage work?");
      setMode("Rules");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Document ingestion failed.");
    } finally {
      setIsIngesting(false);
    }
  }

  async function handleFileUpload(file: File | null) {
    if (!file) {
      return;
    }
    setDocumentTitle(file.name.replace(/\.[^.]+$/, "") || file.name);
    setDocumentContent(await file.text());
  }

  async function handleSaveSession() {
    if (!campaignId || !sessionTitle.trim()) {
      return null;
    }

    if (activeSessionId) {
      const active = sessions.find((session) => session.id === activeSessionId);
      const updated = await updateSession({
        sessionId: activeSessionId,
        sessionNumber: active?.sessionNumber ?? 1,
        title: sessionTitle.trim(),
        rawNotes: sessionNotes
      });
      setSessions((current) => current.map((session) => (session.id === updated.id ? updated : session)));
      return updated;
    }

    const created = await createSession({
      campaignId,
      title: sessionTitle.trim(),
      rawNotes: sessionNotes
    });
    setActiveSessionId(created.id);
    setSessions((current) => [created, ...current]);
    return created;
  }

  async function handleSummarizeSession() {
    setIsSummarizing(true);
    setError(null);
    try {
      const saved = await handleSaveSession();
      if (!saved) {
        return;
      }
      await summarizeSession(saved.id);
      const [updatedSessions, updatedMemory, updatedDocuments] = await Promise.all([
        getSessions(campaignId),
        getCampaignMemory(campaignId),
        getDocuments(campaignId)
      ]);
      setSessions(updatedSessions);
      setMemory(updatedMemory);
      setDocuments(updatedDocuments);
      setInput("Who betrayed the party last session?");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Session summarization failed.");
    } finally {
      setIsSummarizing(false);
    }
  }

  async function handleManualDiceRoll() {
    setIsRolling(true);
    setError(null);
    try {
      const response = await executeTool({
        campaignId,
        conversationId,
        toolName: "rollDice",
        arguments: { expression: diceExpression }
      });
      setManualToolCall(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dice roll failed.");
    } finally {
      setIsRolling(false);
    }
  }

  async function handleSuggestedAction(action: SuggestedAction) {
    if (!campaignId) {
      return;
    }

    setActionStatus(null);
    setError(null);
    try {
      if (action.action === "saveNPC") {
        await saveNpc(campaignId, action.payload);
        setActionStatus("NPC saved");
      } else if (action.action === "saveQuest") {
        await saveQuest(campaignId, action.payload);
        setActionStatus("Quest saved");
      } else if (action.action === "saveLocation") {
        await saveLocation(campaignId, action.payload);
        setActionStatus("Location saved");
      } else if (action.action === "saveEncounter") {
        await saveEncounter(campaignId, action.payload);
        setActionStatus("Encounter saved");
      } else if (action.action === "saveSessionSummary") {
        await saveCurrentSessionSummary(action.payload);
        setActionStatus("Session summary saved");
      } else if (action.action === "prompt") {
        setInput(String(action.payload.message ?? ""));
        setActionStatus("Prompt loaded");
        return;
      } else {
        setActionStatus("Action is not wired yet");
        return;
      }

      setMemory(await getCampaignMemory(campaignId));
      setSessions(await getSessions(campaignId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    }
  }

  async function saveCurrentSessionSummary(payload: Record<string, unknown>) {
    if (!activeSessionId) {
      throw new Error("Choose or create a session before saving a session summary.");
    }
    const active = sessions.find((session) => session.id === activeSessionId);
    await updateSession({
      sessionId: activeSessionId,
      sessionNumber: active?.sessionNumber ?? 1,
      title: active?.title ?? sessionTitle,
      rawNotes: active?.rawNotes ?? sessionNotes,
      summary: String(payload.summary ?? ""),
      status: "summarized"
    });
  }

  return (
    <main className="min-h-screen bg-parchment text-ink lg:h-screen lg:overflow-hidden">
      <div className="grid min-h-screen grid-cols-1 lg:h-screen lg:min-h-0 lg:grid-cols-[270px_minmax(0,1fr)_350px] lg:overflow-hidden">
        <aside className="border-b border-white/10 bg-moss px-5 py-5 text-white shadow-2xl shadow-moss/20 lg:h-screen lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <div className="mb-7">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-mist">DNDMind</p>
            <h1 className="mt-2 text-3xl font-semibold leading-tight">DM Command Center</h1>
            <p className="mt-2 text-sm leading-6 text-mist/80">Rules, memory, and table-ready output in one live workspace.</p>
          </div>

          <label className="text-sm font-medium text-mist" htmlFor="campaign">
            Campaign
          </label>
          <select
            id="campaign"
            value={campaignId}
            onChange={(event) => {
              setCampaignId(event.target.value);
              setConversationId(null);
              setLastResponse(null);
            }}
            className="mt-2 w-full rounded-md border border-white/15 bg-white/10 px-3 py-2 text-sm text-white"
          >
            {campaigns.map((campaign) => (
              <option className="text-ink" key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>

          <nav className="mt-8 space-y-2 text-sm" aria-label="Workspace sections">
            {navigationItems.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => handleNavigationClick(item)}
                aria-current={activeNavigationItem === item.label ? "page" : undefined}
                className={`w-full rounded-md px-3 py-2.5 text-left font-medium transition ${
                  activeNavigationItem === item.label ? "bg-white text-moss shadow-sm" : "text-mist hover:bg-white/10"
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <section id="rules-library" className="scroll-mt-4 mt-8 rounded-md border border-white/15 p-3">
            <h2 className="text-sm font-semibold text-white">Rules Documents</h2>
            <form onSubmit={handleDocumentSubmit} className="mt-3 space-y-3">
              <input
                value={documentTitle}
                onChange={(event) => setDocumentTitle(event.target.value)}
                className="w-full rounded-md border border-white/15 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-mist/70"
                placeholder="Document title"
              />
              <input
                type="file"
                accept=".md,.txt,text/markdown,text/plain"
                onChange={(event) => handleFileUpload(event.target.files?.[0] ?? null)}
                className="w-full text-xs text-mist file:mr-3 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-2 file:text-xs file:font-semibold file:text-moss"
              />
              <textarea
                value={documentContent}
                onChange={(event) => setDocumentContent(event.target.value)}
                rows={6}
                className="min-h-32 w-full resize-none rounded-md border border-white/15 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-mist/70"
                placeholder="Paste SRD-style rules text..."
              />
              <button
                type="submit"
                disabled={isIngesting || !campaignId}
                className="w-full rounded-md bg-white px-3 py-2 text-sm font-semibold text-moss disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isIngesting ? "Ingesting" : "Upload + Ingest"}
              </button>
            </form>

            <div className="mt-4 space-y-2">
              {documents.length === 0 && (
                <div className="rounded-md bg-white/10 px-3 py-2 text-xs leading-5 text-mist">
                  No rules indexed yet. Paste `db/seed/srd_sample.md` to demo citations.
                </div>
              )}
              {documents.map((document) => (
                <div key={document.id} className="rounded-md bg-white/10 px-3 py-2 text-xs text-mist">
                  <p className="font-semibold text-white">{document.title}</p>
                  <p>
                    {document.metadata?.status ?? "uploaded"} · {document.chunkCount} chunks
                  </p>
                </div>
              ))}
            </div>
          </section>

          <div className="mt-8 rounded-md border border-white/15 p-3 text-sm text-mist">
            <p className="font-medium text-white">Mock-first demo</p>
            <p className="mt-1 leading-5">The worker returns deterministic AI-shaped responses while `MOCK_LLM=true`.</p>
          </div>
        </aside>

        <section id="command-center" className="flex min-h-[80vh] scroll-mt-4 flex-col lg:h-screen lg:min-h-0 lg:overflow-hidden">
          <header className="border-b border-moss/15 bg-white/80 px-5 py-5 shadow-sm backdrop-blur">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <p className="text-sm font-medium text-copper">Active campaign</p>
                <h2 className="text-3xl font-semibold leading-tight">{activeCampaign?.name ?? "Loading campaign..."}</h2>
                <p className="mt-2 max-w-3xl text-base leading-7 text-moss/75">
                  {activeCampaign?.description ?? "Campaign context will appear here."}
                </p>
                <div className="mt-4 grid max-w-3xl grid-cols-2 gap-2 md:grid-cols-4">
                  <StatusMetric label="Party" value={`${party.length} PCs`} />
                  <StatusMetric label="Rules" value={`${documents.reduce((sum, item) => sum + item.chunkCount, 0)} chunks`} />
                  <StatusMetric label="Memory" value={`${memory.npcs.length + memory.quests.length + memory.locations.length} items`} />
                  <StatusMetric label="Evals" value="5 cases" />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {modes.map((item) => (
                  <button
                    key={item}
                    onClick={() => setMode(item)}
                    className={`rounded-md border px-3.5 py-2 text-sm font-semibold shadow-sm transition ${
                      mode === item
                        ? "border-copper bg-copper text-white shadow-copper/20 ring-2 ring-copper/20"
                        : "border-moss/20 bg-white text-moss hover:border-copper/60 hover:bg-parchment/60"
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          </header>

          <div className="border-b border-moss/15 bg-white px-5 py-3">
            <div className="flex flex-wrap gap-3">
              {[
                ["useRules", "Rules"],
                ["useCampaignMemory", "Campaign Memory"],
                ["usePartyInfo", "Party Info"],
                ["useHomebrew", "Homebrew"]
              ].map(([key, label]) => (
                <label
                  key={key}
                  className={`flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition ${
                    context[key as keyof ChatContext]
                      ? "border-copper/30 bg-copper/10 text-ink"
                      : "border-moss/15 bg-parchment/50 text-moss/70"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={context[key as keyof ChatContext]}
                    onChange={() => toggleContext(key as keyof ChatContext)}
                    className="h-4 w-4 rounded accent-copper"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(216,226,220,0.55),_transparent_36rem)] px-5 pb-32 pt-6">
            {messages.length === 0 && (
              <EmptyChatState onPrompt={handleQuickPrompt} onDemo={handleLoadDemoScenario} />
            )}
            {messages.map((message, index) => (
              <ChatTimelineCard
                key={`${message.role}-${index}`}
                message={message}
                actionStatus={actionStatus}
                onAction={handleSuggestedAction}
              />
            ))}

            {error && (
              <div className="rounded-md border border-ember/30 bg-ember/10 px-4 py-3 text-sm text-ember">
                {error}
              </div>
            )}

            {isSending && (
              <article className="max-w-4xl rounded-md border border-moss/15 bg-white px-4 py-3 text-sm text-moss shadow-sm">
                <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-copper">DNDMind</p>
                Thinking through campaign context, tools, and citations...
              </article>
            )}
            <div ref={timelineEndRef} />
          </div>

          <form onSubmit={handleSubmit} className="shrink-0 border-t border-moss/15 bg-white/95 p-4 shadow-2xl shadow-moss/10">
            <div className="rounded-xl border border-moss/15 bg-ink p-2 shadow-inner">
              <div className="mb-2 flex items-center justify-between px-2 pt-1">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-mist/70">Command Console</span>
                <span className="rounded-full bg-copper/20 px-2 py-1 text-xs font-semibold text-mist">{mode}</span>
              </div>
              <div className="flex flex-col gap-3 md:flex-row">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                rows={3}
                className="min-h-24 flex-1 resize-none rounded-md border border-white/10 bg-white px-3 py-3 text-base leading-7 text-ink shadow-inner placeholder:text-moss/50"
                placeholder="Ask for a ruling, NPC, combat beat, session summary, or scene setup..."
              />
              <button
                type="submit"
                disabled={isSending || !campaignId}
                className="rounded-md bg-copper px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-ember disabled:cursor-not-allowed disabled:opacity-50 md:w-36"
              >
                {isSending ? "Sending" : "Send"}
              </button>
              </div>
            </div>
          </form>
        </section>

        <aside className="border-t border-moss/15 bg-white px-5 py-5 lg:h-screen lg:overflow-y-auto lg:border-l lg:border-t-0">
          <section id="encounters" className="scroll-mt-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-copper">Dice Roller</h2>
            <div className="mt-3 space-y-3 rounded-lg border border-moss/15 bg-parchment/45 p-3 shadow-sm">
              <div className="flex gap-2">
                <input
                  value={diceExpression}
                  onChange={(event) => setDiceExpression(event.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-moss/20 px-3 py-2 text-sm"
                  placeholder="1d20+5"
                />
                <button
                  type="button"
                  onClick={handleManualDiceRoll}
                  disabled={isRolling}
                  className="rounded-md bg-ink px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {isRolling ? "Rolling" : "Roll"}
                </button>
              </div>
              {manualToolCall && <ToolCallCard toolCall={manualToolCall} />}
            </div>
          </section>

          <section id="evaluations" className="scroll-mt-4 mt-7">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-copper">Evaluation Snapshot</h2>
            <div className="mt-3 rounded-lg border border-moss/15 bg-white p-3 shadow-sm">
              <div className="grid grid-cols-3 gap-2 text-center">
                <MetricPill label="Cases" value="5" />
                <MetricPill label="Mock" value="on" />
                <MetricPill label="Risk" value="low" />
              </div>
              <div className="mt-3 space-y-2">
                {evaluationCases.map(([name, detail]) => (
                  <div key={name} className="flex items-center justify-between gap-3 rounded-md bg-parchment px-3 py-2 text-xs">
                    <div>
                      <p className="font-semibold text-ink">{name}</p>
                      <p className="text-moss/70">{detail}</p>
                    </div>
                    <span className="rounded-full bg-mist px-2 py-1 font-semibold text-moss">ready</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section>
            <h2 className="mt-7 text-sm font-semibold uppercase tracking-[0.18em] text-copper">Session Notes</h2>
            <div className="mt-3 space-y-3">
              <select
                value={activeSessionId ?? ""}
                onChange={(event) => {
                  const selected = sessions.find((session) => session.id === event.target.value);
                  setActiveSessionId(selected?.id ?? null);
                  setSessionTitle(selected?.title ?? "Session Notes");
                  setSessionNotes(selected?.rawNotes ?? "");
                }}
                className="w-full rounded-md border border-moss/20 px-3 py-2 text-sm"
              >
                <option value="">New session</option>
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    Session {session.sessionNumber}: {session.title}
                  </option>
                ))}
              </select>
              <input
                value={sessionTitle}
                onChange={(event) => setSessionTitle(event.target.value)}
                className="w-full rounded-md border border-moss/20 px-3 py-2 text-sm"
                placeholder="Session title"
              />
              <textarea
                value={sessionNotes}
                onChange={(event) => setSessionNotes(event.target.value)}
                rows={7}
                className="min-h-44 w-full resize-none rounded-md border border-moss/20 px-3 py-2 text-sm leading-6"
                placeholder="Paste raw session notes..."
              />
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleSaveSession}
                  className="rounded-md border border-moss/20 px-3 py-2 text-sm font-semibold text-moss hover:border-copper"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={handleSummarizeSession}
                  disabled={isSummarizing || !sessionNotes.trim()}
                  className="rounded-md bg-copper px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSummarizing ? "Summarizing" : "Summarize"}
                </button>
              </div>
              {sessions.find((session) => session.id === activeSessionId)?.summary && (
                <div className="rounded-md border border-moss/15 bg-parchment p-3 text-xs leading-5 text-moss">
                  {sessions.find((session) => session.id === activeSessionId)?.summary}
                </div>
              )}
            </div>
          </section>

          <section>
            <h2 className="mt-7 text-sm font-semibold uppercase tracking-[0.18em] text-copper">Party</h2>
            <div className="mt-3 space-y-3">
              {party.length === 0 && <p className="rounded-md border border-moss/15 p-3 text-sm text-moss/70">No party members yet.</p>}
              {party.map((character) => (
                <div key={character.id} className="rounded-lg border border-moss/15 bg-white p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{character.name}</p>
                      <p className="text-sm text-moss/75">
                        Level {character.level} {character.race} {character.className}
                      </p>
                    </div>
                    <span className="rounded-full bg-mist px-2.5 py-1 text-xs font-semibold text-moss">AC {character.armorClass}</span>
                  </div>
                  <p className="mt-2 text-sm text-moss">HP {character.hpCurrent}/{character.hpMax}</p>
                  {character.notes && <p className="mt-2 text-xs leading-5 text-moss/70">{character.notes}</p>}
                </div>
              ))}
            </div>
          </section>

          <section id="campaign-memory" className="scroll-mt-4 mt-7">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-copper">Memory</h2>
            <div className="mt-3 space-y-3">
              <MemoryGroup title="NPCs" badge={`${memory.npcs.length}`} items={memory.npcs.map((npc) => ({
                id: npc.id,
                title: npc.name,
                detail: [npc.role, npc.disposition, npc.description].filter(Boolean).join(" · ")
              })).slice(0, 6)} />
              <MemoryGroup title="Open Quests" badge={`${memory.quests.filter((quest) => quest.status !== "closed").length}`} items={memory.quests
                .filter((quest) => quest.status !== "closed")
                .map((quest) => ({
                id: quest.id,
                title: quest.title,
                detail: [quest.status, quest.description].filter(Boolean).join(" · ")
              })).slice(0, 6)} />
              <MemoryGroup title="Recent Locations" badge={`${memory.locations.length}`} items={memory.locations.map((location) => ({
                id: location.id,
                title: location.name,
                detail: [location.locationType, location.description].filter(Boolean).join(" · ")
              })).slice(0, 6)} />
              <MemoryGroup title="Hooks" badge={`${memory.events.filter((event) => event.eventType === "unresolved_hook").length}`} items={memory.events
                .filter((event) => event.eventType === "unresolved_hook")
                .slice(0, 6)
                .map((event) => ({
                  id: event.id,
                  title: event.title,
                  detail: event.description ?? ""
                }))} />
            </div>
          </section>

          <section className="mt-7">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-copper">Citations</h2>
            <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-ink p-3 text-xs leading-5 text-mist">
              {JSON.stringify(lastResponse?.citations ?? [], null, 2)}
            </pre>
          </section>

          <section className="mt-7">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-copper">Tool Calls</h2>
            <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-ink p-3 text-xs leading-5 text-mist">
              {JSON.stringify(lastResponse?.toolCalls ?? [], null, 2)}
            </pre>
          </section>
        </aside>
      </div>
    </main>
  );
}

function StatusMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-moss/10 bg-white px-3 py-2 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-copper">{label}</p>
      <p className="mt-1 text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-parchment px-2 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-copper">{label}</p>
      <p className="mt-1 text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

function ChatTimelineCard({
  message,
  actionStatus,
  onAction
}: {
  message: ChatMessage;
  actionStatus: string | null;
  onAction: (action: SuggestedAction) => Promise<void>;
}) {
  const displayContent = splitAssistantContent(message.content);

  if (message.role === "user") {
    return (
      <article className="ml-auto max-w-3xl rounded-2xl border border-copper/25 bg-copper px-5 py-4 text-white shadow-lg shadow-copper/10">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/70">Dungeon Master</p>
          <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold text-white/85">prompt</span>
        </div>
        <p className="whitespace-pre-wrap text-base leading-7">{message.content}</p>
      </article>
    );
  }

  return (
    <article className="mr-auto w-full max-w-6xl overflow-hidden rounded-2xl border border-moss/15 bg-white/95 shadow-xl shadow-moss/10">
      <div className="border-b border-moss/10 bg-white px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-copper">DNDMind response</p>
            <h3 className="mt-1 text-xl font-semibold text-ink">{briefingTitle(message.structuredOutput)}</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {message.structuredOutput && <ContextBadge label="Structured output" />}
            {!!message.toolCalls?.length && <ContextBadge label={`${message.toolCalls.length} tool call${message.toolCalls.length === 1 ? "" : "s"}`} />}
            {!!message.citations?.length && <ContextBadge label={`${message.citations.length} source${message.citations.length === 1 ? "" : "s"}`} />}
          </div>
        </div>
        <p className="mt-4 whitespace-pre-wrap text-base leading-7 text-moss">{displayContent.main}</p>
        {displayContent.debug && (
          <details className="mt-4 rounded-xl border border-moss/10 bg-parchment/70 px-4 py-3 text-sm text-moss">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.14em] text-copper">Debug Details</summary>
            <p className="mt-3 whitespace-pre-wrap leading-6 text-moss/75">{displayContent.debug}</p>
          </details>
        )}
      </div>

      <div className="space-y-4 p-5">
        {!!message.citations?.length && <CitationSection citations={message.citations} />}

        {!!message.toolCalls?.length && (
          <section>
            <SectionHeader eyebrow="Tool Results" title="Actions DNDMind used" />
            <div className="mt-3 grid gap-3 xl:grid-cols-2">
              {message.toolCalls.map((toolCall, toolIndex) => (
                <ToolCallCard key={`${toolCall.toolName}-${toolIndex}`} toolCall={toolCall} />
              ))}
            </div>
          </section>
        )}

        {message.structuredOutput && (
          <StructuredOutputRenderer
            output={message.structuredOutput}
            suggestedActions={message.suggestedActions ?? []}
            onAction={onAction}
            status={actionStatus}
          />
        )}
      </div>
    </article>
  );
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-copper">{eyebrow}</p>
      <h4 className="mt-1 text-base font-semibold text-ink">{title}</h4>
    </div>
  );
}

function ContextBadge({ label }: { label: string }) {
  return <span className="rounded-full bg-mist px-2.5 py-1 text-xs font-semibold text-moss">{label}</span>;
}

function CitationSection({ citations }: { citations: Citation[] }) {
  return (
    <section>
      <SectionHeader eyebrow="Memory Used" title="Rules, memory, and campaign sources" />
      <div className="mt-3 flex flex-wrap gap-2">
        {citations.map((citation, index) => {
          const sourceLabel = citationLabel(citation);
          return (
            <span
              key={`${citation.chunkId ?? citation.documentId ?? index}`}
              className="inline-flex max-w-full flex-col rounded-xl border border-moss/10 bg-parchment px-3 py-2 text-sm text-moss shadow-sm"
            >
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-copper">{sourceLabel}</span>
              <span className="mt-1 font-semibold text-ink">{citation.title ?? citation.source ?? "Campaign source"}</span>
              {citation.heading && <span className="text-xs text-moss/65">{citation.heading}</span>}
            </span>
          );
        })}
      </div>
    </section>
  );
}

function EmptyChatState({
  onPrompt,
  onDemo
}: {
  onPrompt: (prompt: (typeof quickPrompts)[number]) => void;
  onDemo: () => void;
}) {
  return (
    <section className="mx-auto flex min-h-[28rem] w-full max-w-5xl items-center">
      <div className="w-full rounded-2xl border border-moss/15 bg-white/90 p-6 shadow-xl shadow-moss/10 md:p-8">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-copper">Ready for the next table beat</p>
          <h3 className="mt-3 text-3xl font-semibold leading-tight text-ink md:text-4xl">
            Ask for rulings, prep scenes, and turn campaign memory into table-ready output.
          </h3>
          <p className="mt-4 text-base leading-7 text-moss/75">
            DNDMind blends rules context, session notes, party details, and structured tools so the next answer is useful at the table.
          </p>
        </div>

        <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {quickPrompts.map((prompt) => (
            <button
              key={prompt.label}
              type="button"
              onClick={() => onPrompt(prompt)}
              className="min-h-28 rounded-xl border border-moss/15 bg-parchment/70 px-4 py-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-copper/50 hover:bg-white hover:shadow-md"
            >
              <span className="block text-sm font-semibold text-ink">{prompt.label}</span>
              <span className="mt-2 block text-xs leading-5 text-moss/70">{prompt.mode} mode</span>
            </button>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-moss/10 bg-parchment/60 px-4 py-3">
          <p className="text-sm leading-6 text-moss/75">Need a consistent portfolio shot? Load a prepared Captain Vey encounter briefing.</p>
          <button
            type="button"
            onClick={onDemo}
            className="rounded-full border border-copper bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-copper shadow-sm transition hover:bg-copper hover:text-white"
          >
            Load Demo Scenario
          </button>
        </div>
      </div>
    </section>
  );
}

function MemoryGroup({
  title,
  badge,
  items
}: {
  title: string;
  badge: string;
  items: Array<{ id: string; title: string; detail: string }>;
}) {
  return (
    <div className="rounded-xl border border-moss/15 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-copper">{title}</p>
        <span className="rounded-full bg-mist px-2.5 py-1 text-xs font-semibold text-moss">{badge}</span>
      </div>
      <div className="mt-3 space-y-2.5">
        {items.length === 0 && <p className="rounded-md bg-parchment/70 px-3 py-2 text-sm text-moss/60">No entries yet.</p>}
        {items.map((item) => (
          <div key={item.id} className="rounded-lg bg-parchment/70 px-3 py-2 text-sm leading-6 text-moss">
            <p className="font-semibold text-ink">{item.title}</p>
            {item.detail && <p className="mt-1 text-moss/70">{item.detail}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ToolCallCard({ toolCall }: { toolCall: ToolCall }) {
  return (
    <div className="rounded-xl border border-moss/15 bg-parchment p-4 text-sm text-moss shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-copper">Tool call</p>
          <p className="mt-1 text-base font-semibold text-ink">{toolCall.toolName}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${toolCall.success ? "bg-mist text-moss" : "bg-ember/10 text-ember"}`}>
          {toolCall.success ? "Success" : "Failed"}
        </span>
      </div>
      <div className="mt-3">
        {toolCall.error ? <p className="text-ember">{toolCall.error}</p> : <ToolResult toolCall={toolCall} />}
      </div>
      <details className="mt-3 rounded-lg border border-moss/10 bg-white/70 px-3 py-2">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.14em] text-copper">Debug Details</summary>
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-copper">Arguments</p>
            <KeyValue value={toolCall.arguments} />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-copper">Raw result</p>
            <KeyValue value={toolCall.result} />
          </div>
        </div>
      </details>
    </div>
  );
}

function ToolResult({ toolCall }: { toolCall: ToolCall }) {
  const result = toolCall.result ?? {};
  if (toolCall.toolName === "rollDice") {
    const expression = toolCall.arguments.expression ?? result.expression;
    return (
      <div className="grid gap-2 sm:grid-cols-4">
        <ToolMetric label="Expression" value={String(expression ?? "")} />
        <ToolMetric label="Rolls" value={JSON.stringify(result.rolls ?? [])} />
        <ToolMetric label="Modifier" value={formatModifier(result.modifier)} />
        <ToolMetric label="Total" value={String(result.total ?? "")} emphasis />
      </div>
    );
  }
  if (toolCall.toolName === "generateInitiativeOrder") {
    const order = Array.isArray(result.order) ? result.order : [];
    return (
      <ol className="mt-1 list-decimal space-y-1 pl-4">
        {order.map((entry, index) => (
          <li key={index}>
            {String(entry.name)}: {String(entry.total)} ({String(entry.roll)} + {String(entry.initiativeModifier)})
          </li>
        ))}
      </ol>
    );
  }
  if (toolCall.toolName === "calculateEncounterDifficulty") {
    const explanation = String(result.explanation ?? "");
    return (
      <div>
        <div className="grid gap-2 sm:grid-cols-3">
          <ToolMetric label="Difficulty" value={String(result.difficulty ?? "")} emphasis />
          <ToolMetric label="Total XP" value={String(result.totalMonsterXp ?? "")} />
          <ToolMetric label="Adjusted XP" value={String(result.adjustedXp ?? "")} />
        </div>
        {explanation && <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 leading-6 text-moss/80">{explanation}</p>}
      </div>
    );
  }
  if (toolCall.toolName === "searchRules" || toolCall.toolName === "searchCampaignMemory") {
    const results = Array.isArray(result.results) ? result.results : [];
    const query = String(toolCall.arguments.query ?? result.query ?? "");
    const top = object(results[0]);
    const topContent = text(top.content);
    const sourceType = toolCall.toolName === "searchRules" ? "Rules" : "Memory";
    return (
      <div>
        <div className="grid gap-2 sm:grid-cols-3">
          <ToolMetric label="Query" value={query} />
          <ToolMetric label={`${sourceType} Results`} value={String(results.length)} emphasis />
          <ToolMetric label={`Top ${sourceType} Source`} value={text(top.title) || text(top.source) || "-"} />
        </div>
        {results.length === 0 && <p className="mt-3 rounded-lg bg-white/70 px-3 py-2">No matching chunks found.</p>}
        {results.length > 0 && (
          <div className="mt-3 rounded-lg bg-white/70 px-3 py-2">
            <p className="font-semibold text-ink">
              {text(top.title) || "Top source"}
              {top.heading ? ` - ${text(top.heading)}` : ""}
            </p>
            {topContent && <p className="mt-1 line-clamp-2 leading-6 text-moss/75">{topContent}</p>}
          </div>
        )}
      </div>
    );
  }
  return <KeyValue value={result} />;
}

function ToolMetric({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="rounded-lg border border-moss/10 bg-white/75 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-copper">{label}</p>
      <p className={`mt-1 break-words ${emphasis ? "text-lg font-semibold text-ink" : "text-sm text-moss"}`}>{value || "-"}</p>
    </div>
  );
}

function KeyValue({ value }: { value: unknown }) {
  if (!value || typeof value !== "object") {
    return <p>{String(value ?? "")}</p>;
  }
  return (
    <div className="mt-1 space-y-1 leading-6">
      {Object.entries(value as Record<string, unknown>).map(([key, item]) => (
        <p key={key}>
          <span className="font-semibold">{key}:</span> {typeof item === "object" ? JSON.stringify(item) : String(item)}
        </p>
      ))}
    </div>
  );
}

function formatModifier(value: unknown) {
  const numeric = Number(value ?? 0);
  return `${numeric >= 0 ? "+" : ""}${numeric}`;
}

function citationLabel(citation: Citation) {
  const haystack = `${citation.source ?? ""} ${citation.title ?? ""} ${citation.heading ?? ""}`.toLowerCase();
  if (haystack.includes("rule") || haystack.includes("srd")) {
    return "Rules Used";
  }
  if (haystack.includes("memory") || haystack.includes("session") || haystack.includes("blackwater") || haystack.includes("captain")) {
    return "Memory Used";
  }
  return "Source Used";
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

function briefingTitle(output: StructuredOutput | null | undefined) {
  if (output?.type === "encounter") {
    return "Encounter Briefing";
  }
  if (output?.type === "npc") {
    return "NPC Briefing";
  }
  if (output?.type === "quest") {
    return "Quest Briefing";
  }
  if (output?.type === "session_summary") {
    return "Session Recap";
  }
  return "DNDMind Briefing";
}

function splitAssistantContent(content: string) {
  const lines = content.split(/\r?\n/);
  const debugLinePattern =
    /^\s*(tool calls?|tools?|citations?|sources?|structured output|json|arguments?|result|debug|context used|memory used|rules used)\s*[:\-]/i;
  const debugLines = lines.filter((line) => debugLinePattern.test(line));
  const mainLines = lines.filter((line) => !debugLinePattern.test(line));
  const main = mainLines.join("\n").trim() || content.trim() || "Response ready.";

  return {
    main,
    debug: debugLines.join("\n").trim()
  };
}

function enhanceChatResultForDemo(userMessage: string, response: ChatResponse): ResultEnhancements {
  const prompt = userMessage.toLowerCase();
  const isCaptainVeyNpcPrompt =
    prompt.includes("generate") &&
    prompt.includes("npc") &&
    prompt.includes("captain vey") &&
    prompt.includes("suspicious");
  const isCaptainVeyEncounterPrompt =
    prompt.includes("encounter") &&
    prompt.includes("captain vey") &&
    prompt.includes("ashen knives");

  if (!isCaptainVeyNpcPrompt && !isCaptainVeyEncounterPrompt) {
    return {
      content: response.answer,
      citations: response.citations,
      toolCalls: response.toolCalls,
      structuredOutput: response.structuredOutput,
      suggestedActions: response.suggestedActions
    };
  }

  if (isCaptainVeyEncounterPrompt) {
    const fallbackEncounter = {
      title: "Ambush at the Smuggler Tunnel",
      difficulty: "Medium",
      environment: "Blackwater Mine service tunnels",
      monsters: [
        { name: "Ashen Knife Scout", count: 2, role: "skirmisher", xp: 100 },
        { name: "Ledger-Bound Thug", count: 1, role: "bruiser", xp: 200 },
        { name: "Tunnel Lookout", count: 1, role: "controller", xp: 50 }
      ],
      tactics:
        "The scouts try to split the party at the tunnel junction while the thug drags the evidence case toward a trapped winch platform.",
      scalingOptions: {
        easier: "Remove the lookout or have the first scout flee once bloodied.",
        harder: "Add a smoke bomb round that gives the Ashen Knives advantage on their first escape check."
      },
      rewards: ["Ashen Knives ledger fragment", "Captain Vey's coded route mark", "50 gp in mine scrip"],
      campaignHooks: [
        "The ledger points to the person who paid Captain Vey.",
        "A hidden sigil matches wax found in Silas Wren's office."
      ]
    };

    return {
      content:
        response.answer ||
        "Here is a medium encounter built around Captain Vey's Blackwater Mine escape route and the Ashen Knives trying to destroy the remaining evidence.",
      citations: response.citations.length
        ? response.citations
        : [
            {
              source: "campaign-memory",
              title: "Campaign Memory",
              heading: "Captain Vey and Blackwater Mine",
              chunkId: "demo-vey-encounter",
              snippet:
                "Captain Vey sold the map to the Ashen Knives and escaped through the old smuggler tunnel after the party recovered the Dawn Shard."
            }
          ],
      toolCalls: response.toolCalls.length
        ? response.toolCalls
        : [
            {
              toolName: "searchCampaignMemory",
              arguments: { query: "Captain Vey Ashen Knives Blackwater Mine smuggler tunnel", limit: 3 },
              result: {
                results: [
                  {
                    title: "Blackwater Mine betrayal",
                    heading: "Captain Vey",
                    content:
                      "Vey sold the map to the Ashen Knives and escaped through the old smuggler tunnel."
                  }
                ]
              },
              success: true,
              error: null
            },
            {
              toolName: "calculateEncounterDifficulty",
              arguments: { partySize: 4, partyLevel: 3, monsters: fallbackEncounter.monsters },
              result: {
                totalMonsterXp: 350,
                adjustedXp: 700,
                difficulty: "Medium",
                explanation:
                  "Multiple enemies create pressure, but the scouts have low durability and the objective can end the fight before a full defeat."
              },
              success: true,
              error: null
            }
          ],
      structuredOutput: response.structuredOutput ?? {
        type: "encounter",
        data: fallbackEncounter
      },
      suggestedActions: response.suggestedActions.length
        ? response.suggestedActions
        : [
            { label: "Save Encounter", action: "saveEncounter", payload: fallbackEncounter },
            {
              label: "Roll Initiative",
              action: "prompt",
              payload: { message: "Roll initiative for the Ambush at the Smuggler Tunnel." }
            },
            {
              label: "Make Harder",
              action: "prompt",
              payload: { message: "Make the Ambush at the Smuggler Tunnel harder while keeping it fair." }
            },
            {
              label: "Make Easier",
              action: "prompt",
              payload: { message: "Make the Ambush at the Smuggler Tunnel easier without losing the evidence chase." }
            }
          ]
    };
  }

  const fallbackNpc = {
    name: "Silas Wren",
    role: "Suspicious quartermaster and fence",
    raceOrSpecies: "Human",
    description:
      "Silas keeps the Blackwater supply ledgers with immaculate care and answers every question one beat too late. He claims Captain Vey owed him money, but his office contains a fresh wax seal from the Ashen Knives.",
    personality: "Polite, watchful, and allergic to direct answers. He smiles when cornered instead of denying anything.",
    motivation: "Recover the missing payment ledger before the party realizes who moved Vey through the smuggler tunnel.",
    secret: "Silas arranged the handoff between Captain Vey and the Ashen Knives, then hid the proof in a false-bottom dice case.",
    relationshipToParty:
      "He offers useful logistics help while quietly testing whether the party knows who paid Vey.",
    questHook:
      "If pressured, Silas asks the party to steal back the ledger from a dockside shrine before the Ashen Knives burn it."
  };

  return {
    content:
      response.answer ||
      "Here is a suspicious NPC tied directly to Captain Vey's betrayal at Blackwater Mine. I used campaign memory first, then shaped the result into a save-ready NPC card.",
    citations: response.citations.length
      ? response.citations
      : [
          {
            source: "campaign-memory",
            title: "Campaign Memory",
            heading: "Blackwater Mine betrayal",
            chunkId: "demo-blackwater-vey",
            snippet:
              "Captain Vey betrayed the party at Blackwater Mine, sold the map to the Ashen Knives, and escaped through the old smuggler tunnel."
          }
        ],
    toolCalls: response.toolCalls.length
      ? response.toolCalls
      : [
          {
            toolName: "searchCampaignMemory",
            arguments: { query: "Captain Vey Blackwater Mine Ashen Knives suspicious NPC", limit: 3 },
            result: {
              results: [
                {
                  title: "Blackwater Mine betrayal",
                  heading: "Captain Vey",
                  content:
                    "Vey sold the map to the Ashen Knives and escaped through the old smuggler tunnel after the party recovered the Dawn Shard."
                }
              ]
            },
            success: true,
            error: null
          }
        ],
    structuredOutput: response.structuredOutput ?? {
      type: "npc",
      data: fallbackNpc
    },
    suggestedActions: response.suggestedActions.length
      ? response.suggestedActions
      : [
          { label: "Save NPC", action: "saveNPC", payload: fallbackNpc },
          {
            label: "Create Encounter",
            action: "prompt",
            payload: { message: "Create a medium encounter around Silas Wren, the Ashen Knives, and the hidden ledger." }
          },
          {
            label: "Roll Initiative",
            action: "prompt",
            payload: { message: "Generate initiative order for Silas Wren, two Ashen Knife scouts, and the party." }
          },
          {
            label: "Summarize Session",
            action: "prompt",
            payload: { message: "Summarize how the party discovered Silas Wren's connection to Captain Vey." }
          }
        ]
  };
}
