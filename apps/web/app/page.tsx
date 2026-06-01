"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
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
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Pick a campaign, choose a mode, and ask for a ruling, scene beat, NPC reaction, encounter idea, or recap."
    }
  ]);
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
      setLastResponse(response);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: response.answer,
          citations: response.citations,
          toolCalls: response.toolCalls,
          structuredOutput: response.structuredOutput,
          suggestedActions: response.suggestedActions
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
      <div className="grid min-h-screen grid-cols-1 lg:h-screen lg:min-h-0 lg:grid-cols-[260px_minmax(0,1fr)_320px] lg:overflow-hidden">
        <aside className="border-b border-moss/15 bg-moss px-5 py-5 text-white lg:h-screen lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <div className="mb-7">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-mist">DNDMind</p>
            <h1 className="mt-2 text-2xl font-semibold leading-tight">DM Command Center</h1>
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

          <nav className="mt-8 space-y-2 text-sm">
            {["Command", "Campaign Memory", "Rules Library", "Encounters", "Evaluations"].map((item, index) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  if (item === "Evaluations") {
                    setInput("Run the sample eval suite for rules, memory, tools, and structured output.");
                  }
                }}
                className={`w-full rounded-md px-3 py-2 text-left transition ${
                  index === 0 ? "bg-white text-moss" : "text-mist hover:bg-white/10"
                }`}
              >
                {item}
              </button>
            ))}
          </nav>

          <section className="mt-8 rounded-md border border-white/15 p-3">
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

        <section className="flex min-h-[80vh] flex-col lg:h-screen lg:min-h-0 lg:overflow-hidden">
          <header className="border-b border-moss/15 bg-white/70 px-5 py-4 backdrop-blur">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <p className="text-sm font-medium text-copper">Active campaign</p>
                <h2 className="text-2xl font-semibold">{activeCampaign?.name ?? "Loading campaign..."}</h2>
                <p className="mt-1 max-w-3xl text-sm text-moss/75">
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
                    className={`rounded-md border px-3 py-2 text-sm font-medium ${
                      mode === item
                        ? "border-copper bg-copper text-white"
                        : "border-moss/20 bg-white text-moss hover:border-copper/60"
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
                <label key={key} className="flex items-center gap-2 rounded-md border border-moss/15 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={context[key as keyof ChatContext]}
                    onChange={() => toggleContext(key as keyof ChatContext)}
                    className="h-4 w-4 accent-copper"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
            {messages.map((message, index) => (
              <article
                key={`${message.role}-${index}`}
                className={`max-w-4xl rounded-md border px-4 py-3 shadow-sm ${
                  message.role === "assistant"
                    ? "border-moss/15 bg-white"
                    : "ml-auto border-copper/20 bg-copper text-white"
                }`}
              >
                <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] opacity-70">
                  {message.role === "assistant" ? "DNDMind" : "Dungeon Master"}
                </p>
                <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>
                {message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0 && (
                  <div className="mt-3 space-y-2 border-t border-moss/10 pt-3">
                    {message.toolCalls.map((toolCall, toolIndex) => (
                      <ToolCallCard key={`${toolCall.toolName}-${toolIndex}`} toolCall={toolCall} />
                    ))}
                  </div>
                )}
                {message.role === "assistant" && (
                  <StructuredOutputRenderer
                    output={message.structuredOutput}
                    suggestedActions={message.suggestedActions ?? []}
                    onAction={handleSuggestedAction}
                    status={actionStatus}
                  />
                )}
                {message.role === "assistant" && message.citations && message.citations.length > 0 && (
                  <div className="mt-3 border-t border-moss/10 pt-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-copper">Citations</p>
                    <div className="mt-2 space-y-2">
                      {message.citations.map((citation, citationIndex) => (
                        <div key={`${citation.chunkId ?? citationIndex}`} className="rounded-md bg-parchment px-3 py-2 text-xs text-moss">
                          <p className="font-semibold">
                            {citation.title}
                            {citation.heading ? ` - ${citation.heading}` : ""}
                          </p>
                          {citation.snippet && <p className="mt-1 leading-5">{citation.snippet}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </article>
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
          </div>

          <form onSubmit={handleSubmit} className="shrink-0 border-t border-moss/15 bg-white p-4">
            <div className="flex flex-col gap-3 md:flex-row">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                rows={3}
                className="min-h-24 flex-1 resize-none rounded-md border border-moss/20 px-3 py-3 text-sm shadow-inner"
                placeholder="Ask for a ruling, NPC, combat beat, session summary, or scene setup..."
              />
              <button
                type="submit"
                disabled={isSending || !campaignId}
                className="rounded-md bg-ink px-5 py-3 text-sm font-semibold text-white hover:bg-moss disabled:cursor-not-allowed disabled:opacity-50 md:w-36"
              >
                {isSending ? "Sending" : "Send"}
              </button>
            </div>
          </form>
        </section>

        <aside className="border-t border-moss/15 bg-white px-5 py-5 lg:h-screen lg:overflow-y-auto lg:border-l lg:border-t-0">
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-copper">Dice Roller</h2>
            <div className="mt-3 space-y-3 rounded-md border border-moss/15 p-3">
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

          <section className="mt-7">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-copper">Evaluation Snapshot</h2>
            <div className="mt-3 rounded-md border border-moss/15 p-3">
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
                    <span className="rounded-md bg-mist px-2 py-1 font-semibold text-moss">ready</span>
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
              {party.length === 0 && <p className="rounded-md border border-moss/15 p-3 text-xs text-moss/70">No party members yet.</p>}
              {party.map((character) => (
                <div key={character.id} className="rounded-md border border-moss/15 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{character.name}</p>
                      <p className="text-sm text-moss/75">
                        Level {character.level} {character.race} {character.className}
                      </p>
                    </div>
                    <span className="rounded-md bg-mist px-2 py-1 text-xs font-semibold">AC {character.armorClass}</span>
                  </div>
                  <p className="mt-2 text-sm text-moss">HP {character.hpCurrent}/{character.hpMax}</p>
                  {character.notes && <p className="mt-2 text-xs leading-5 text-moss/70">{character.notes}</p>}
                </div>
              ))}
            </div>
          </section>

          <section className="mt-7">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-copper">Memory</h2>
            <div className="mt-3 space-y-3">
              <MemoryGroup title="NPCs" items={memory.npcs.map((npc) => ({
                id: npc.id,
                title: npc.name,
                detail: [npc.role, npc.disposition, npc.description].filter(Boolean).join(" · ")
              })).slice(0, 6)} />
              <MemoryGroup title="Open Quests" items={memory.quests
                .filter((quest) => quest.status !== "closed")
                .map((quest) => ({
                id: quest.id,
                title: quest.title,
                detail: [quest.status, quest.description].filter(Boolean).join(" · ")
              })).slice(0, 6)} />
              <MemoryGroup title="Recent Locations" items={memory.locations.map((location) => ({
                id: location.id,
                title: location.name,
                detail: [location.locationType, location.description].filter(Boolean).join(" · ")
              })).slice(0, 6)} />
              <MemoryGroup title="Hooks" items={memory.events
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

function MemoryGroup({ title, items }: { title: string; items: Array<{ id: string; title: string; detail: string }> }) {
  return (
    <div className="rounded-md border border-moss/15 p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-copper">{title}</p>
      <div className="mt-2 space-y-2">
        {items.length === 0 && <p className="text-xs text-moss/60">No entries yet.</p>}
        {items.map((item) => (
          <div key={item.id} className="text-xs leading-5 text-moss">
            <p className="font-semibold">{item.title}</p>
            {item.detail && <p className="text-moss/70">{item.detail}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ToolCallCard({ toolCall }: { toolCall: ToolCall }) {
  return (
    <div className="rounded-md border border-moss/15 bg-parchment p-3 text-xs text-moss">
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold text-ink">Tool Used: {toolCall.toolName}</p>
        <span className={`rounded-md px-2 py-1 font-semibold ${toolCall.success ? "bg-mist text-moss" : "bg-ember/10 text-ember"}`}>
          {toolCall.success ? "Success" : "Failed"}
        </span>
      </div>
      <div className="mt-2">
        <p className="font-semibold text-copper">Arguments</p>
        <KeyValue value={toolCall.arguments} />
      </div>
      <div className="mt-2">
        <p className="font-semibold text-copper">Result</p>
        {toolCall.error ? <p className="text-ember">{toolCall.error}</p> : <ToolResult toolCall={toolCall} />}
      </div>
    </div>
  );
}

function ToolResult({ toolCall }: { toolCall: ToolCall }) {
  const result = toolCall.result ?? {};
  if (toolCall.toolName === "rollDice") {
    return (
      <div className="space-y-1">
        <p>Rolls: {JSON.stringify(result.rolls ?? [])}</p>
        <p>Modifier: {formatModifier(result.modifier)}</p>
        <p className="font-semibold">Total: {String(result.total ?? "")}</p>
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
    return (
      <div className="space-y-1">
        <p className="font-semibold">{String(result.difficulty ?? "")}</p>
        <p>Total XP: {String(result.totalMonsterXp ?? "")}</p>
        <p>Adjusted XP: {String(result.adjustedXp ?? "")}</p>
        <p>{String(result.explanation ?? "")}</p>
      </div>
    );
  }
  if (toolCall.toolName === "searchRules" || toolCall.toolName === "searchCampaignMemory") {
    const results = Array.isArray(result.results) ? result.results : [];
    return (
      <div className="space-y-2">
        {results.length === 0 && <p>No matching chunks found.</p>}
        {results.slice(0, 3).map((entry, index) => (
          <div key={index} className="rounded-md bg-white p-2">
            <p className="font-semibold">
              {String(entry.title ?? "")}
              {entry.heading ? ` - ${String(entry.heading)}` : ""}
            </p>
            <p className="mt-1 leading-5">{String(entry.content ?? "").slice(0, 220)}</p>
          </div>
        ))}
      </div>
    );
  }
  return <KeyValue value={result} />;
}

function KeyValue({ value }: { value: unknown }) {
  if (!value || typeof value !== "object") {
    return <p>{String(value ?? "")}</p>;
  }
  return (
    <div className="mt-1 space-y-1">
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
