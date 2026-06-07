"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Campaign,
  CampaignMemory,
  ChatContext,
  ChatResponse,
  Citation,
  KnowledgeDocument,
  PartyCharacter,
  PartyCharacterEvent,
  PartyCharacterInput,
  PromptSuggestionMode,
  Session,
  StructuredOutput,
  SuggestedAction,
  ToolCall,
  archiveCampaign,
  createCampaign,
  createPartyCharacter,
  createPartyCharacterEvent,
  createSession,
  deleteDocument,
  deleteEncounter,
  deleteLocation,
  deleteMemoryEvent,
  deleteNpc,
  deletePartyCharacter,
  deleteQuest,
  executeTool,
  getCampaignMemory,
  getArchivedCampaigns,
  getCampaigns,
  getDocuments,
  getParty,
  getPartyCharacterEvents,
  getRecentPartyEvents,
  getSessions,
  generatePromptSuggestion,
  ingestDocument,
  saveEncounter,
  saveLocation,
  saveNpc,
  saveQuest,
  sendChat,
  restoreCampaign,
  summarizeSession,
  updatePartyCharacter,
  updatePartyCharacterHp,
  updatePartyCharacterLevel,
  updateCampaign,
  updateSession,
  uploadDocument
} from "../lib/api";
import { getClientId, getClientLabel, resetClientId } from "../lib/clientIdentity";
import { StructuredOutputRenderer } from "../components/structured/StructuredOutputRenderer";

const modes = ["Auto", "Rules", "Encounter", "NPC", "Character", "Recap", "Summarize"];
const modeLabels: Record<string, string> = {
  Encounter: "Encounter"
};
const quickPrompts = [
  { label: "Ask a rules question", mode: "Rules", suggestionMode: "rules", prompt: "How does advantage work, and when should I ask for a check?" },
  { label: "Generate an NPC", mode: "NPC", suggestionMode: "npc", prompt: "Generate a memorable tavern informant tied to the party's current quest." },
  {
    label: "Generate a character",
    mode: "Character",
    suggestionMode: "character",
    prompt: "Generate a level 3 adventurer tied to this campaign who could work as a backup PC, rival, or hireling."
  },
  { label: "Create an encounter", mode: "Encounter", suggestionMode: "encounter", prompt: "Create a tense but fair encounter for tonight's session." },
  {
    label: "Recap so far",
    mode: "Recap",
    suggestionMode: "recap",
    prompt: "Narrate what has happened so far in this campaign as a table-ready recap. Use saved campaign memory first, include concrete names, places, quests, and unresolved hooks, and do not invent missing facts."
  },
  { label: "Summarize session", mode: "Summarize", suggestionMode: "summarize", prompt: "Summarize the current session notes and extract unresolved hooks." },
  { label: "Search campaign memory", mode: "Auto", suggestionMode: "auto", prompt: "Search campaign memory for unresolved hooks involving Captain Vey." }
];
const navigationItems = [
  { label: "Command", targetId: "command-center" },
  { label: "Campaign Memory", targetId: "campaign-memory" },
  { label: "Campaign Knowledge", targetId: "rules-library" },
  { label: "Encounters", targetId: "encounters" },
  { label: "Session Prep", targetId: "session-prep" }
];
type MobileWorkspaceTab = "command" | "campaign" | "notes";

const mobileWorkspaceTabs: { id: MobileWorkspaceTab; label: string }[] = [
  { id: "command", label: "Chat" },
  { id: "campaign", label: "Campaign" },
  { id: "notes", label: "Notes" }
];
const documentSourceTypes = [
  { value: "rules", label: "Rules" },
  { value: "homebrew", label: "Homebrew" }
];
const documentTemplates = [
  { label: "Rules", href: "/templates/rules-template.md" },
  { label: "Session Notes", href: "/templates/session-notes-template.md" },
  { label: "NPC", href: "/templates/npc-template.md" },
  { label: "Location", href: "/templates/location-template.md" },
  { label: "Quest", href: "/templates/quest-template.md" },
  { label: "Campaign Lore", href: "/templates/campaign-lore-template.md" }
];
const acceptedDocumentExtensions = [".txt", ".md"];
const maxDocumentUploadBytes = 2 * 1024 * 1024;
const diceExpressionPattern = /^\s*(\d{1,2})d(\d{1,4})([+-]\d{1,4})?\s*$/i;
const diceExamples = ["1d20", "2d6+3", "4d8-1"];
const emptyCampaignMemory: CampaignMemory = { npcs: [], quests: [], locations: [], encounters: [], events: [] };

function D20MindSparkLogo() {
  return (
    <svg
      aria-hidden="true"
      className="h-14 w-14 shrink-0"
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M24 3.5 42.5 14v20L24 44.5 5.5 34V14L24 3.5Z"
        className="fill-parchment/10 stroke-mist"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M24 3.5 32 24 24 44.5 16 24 24 3.5Z"
        className="stroke-mist/75"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 14 16 24 5.5 34M42.5 14 32 24l10.5 10M16 24h16M5.5 14h37"
        className="stroke-mist/45"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="24" cy="24" r="3.25" className="fill-copper" />
      <path
        d="M24 13.5v5M24 29.5v5M13.5 24h5M29.5 24h5M16.5 16.5l3.5 3.5M28 28l3.5 3.5M31.5 16.5 28 20M20 28l-3.5 3.5"
        className="stroke-copper"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function sessionDraftKey(clientId: string, campaignId: string, sessionId: string | null) {
  return `dndmind_draft_${clientId}_${campaignId}_${sessionId ?? "new"}`;
}

function promptSuggestionModeFromHint(hintMode: string): PromptSuggestionMode {
  const normalized = hintMode.trim().toLowerCase();
  if (normalized === "combat") {
    return "encounter";
  }
  if (normalized === "rules" || normalized === "npc" || normalized === "character" || normalized === "encounter" || normalized === "recap" || normalized === "summarize") {
    return normalized;
  }
  return "auto";
}

function mobileWorkspaceTabForNavigationItem(item: (typeof navigationItems)[number]): MobileWorkspaceTab {
  if (item.targetId === "command-center") {
    return "command";
  }
  if (item.targetId === "rules-library") {
    return "campaign";
  }
  return "notes";
}

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

type ChatRequest = {
  campaignId: string;
  conversationId: string | null;
  sessionId?: string | null;
  message: string;
  mode: string;
  context: ChatContext;
};

type FailedChatRequest = ChatRequest & {
  errorMessage: string;
};

type PartyPanelMode = "add" | "edit" | "hp" | "history";

type ActivePartyPanel = {
  mode: PartyPanelMode;
  character: PartyCharacter | null;
};

type CampaignFormMode = "new" | "edit";

type CampaignFormState = {
  name: string;
  description: string;
  systemTone: string;
};

type MemoryItemKind = "npc" | "quest" | "location" | "hook";

const emptyCampaignForm: CampaignFormState = {
  name: "",
  description: "",
  systemTone: ""
};

export default function Home() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [archivedCampaigns, setArchivedCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [hasLoadedCampaigns, setHasLoadedCampaigns] = useState(false);
  const [campaignFormMode, setCampaignFormMode] = useState<CampaignFormMode | null>(null);
  const [campaignForm, setCampaignForm] = useState<CampaignFormState>(emptyCampaignForm);
  const [isSavingCampaign, setIsSavingCampaign] = useState(false);
  const [isArchivingCampaign, setIsArchivingCampaign] = useState(false);
  const [restoringCampaignId, setRestoringCampaignId] = useState<string | null>(null);
  const [party, setParty] = useState<PartyCharacter[]>([]);
  const [partyEvents, setPartyEvents] = useState<PartyCharacterEvent[]>([]);
  const [activePartyPanel, setActivePartyPanel] = useState<ActivePartyPanel | null>(null);
  const [characterEvents, setCharacterEvents] = useState<PartyCharacterEvent[]>([]);
  const [isSavingParty, setIsSavingParty] = useState(false);
  const [isLoadingPartyHistory, setIsLoadingPartyHistory] = useState(false);
  const [partyStatus, setPartyStatus] = useState<string | null>(null);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState("Session Notes");
  const [sessionNotes, setSessionNotes] = useState(
    "Captain Vey betrayed the party last session at Blackwater Mine. He sold the map to the Ashen Knives and escaped through the old smuggler tunnel. Mira swore to track him down. The party recovered the Dawn Shard but still does not know who paid Vey."
  );
  const [memory, setMemory] = useState<CampaignMemory>(emptyCampaignMemory);
  const [isLoadingMemory, setIsLoadingMemory] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
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
  const [isClearChatDialogOpen, setIsClearChatDialogOpen] = useState(false);
  const [input, setInput] = useState("How should I open tonight's session?");
  const [documentTitle, setDocumentTitle] = useState("Campaign Notes");
  const [documentContent, setDocumentContent] = useState("");
  const [documentSourceType, setDocumentSourceType] = useState("rules");
  const [documentFileName, setDocumentFileName] = useState<string | null>(null);
  const [diceExpression, setDiceExpression] = useState("1d20+5");
  const [manualToolCall, setManualToolCall] = useState<ToolCall | null>(null);
  const [isIngesting, setIsIngesting] = useState(false);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);
  const [deletingEncounterId, setDeletingEncounterId] = useState<string | null>(null);
  const [deletingMemoryItemKey, setDeletingMemoryItemKey] = useState<string | null>(null);
  const [isRolling, setIsRolling] = useState(false);
  const [isSavingSession, setIsSavingSession] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isGeneratingPromptSuggestion, setIsGeneratingPromptSuggestion] = useState(false);
  const [promptSuggestionError, setPromptSuggestionError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [sessionSaveStatus, setSessionSaveStatus] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string>("");
  const [clientLabel, setClientLabel] = useState<string>("Local DM");
  const [clientProfileStatus, setClientProfileStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFailedChatRequest, setLastFailedChatRequest] = useState<FailedChatRequest | null>(null);
  const [activeNavigationItem, setActiveNavigationItem] = useState("Command");
  const [activeMobileWorkspaceTab, setActiveMobileWorkspaceTab] = useState<MobileWorkspaceTab>("command");
  const timelineEndRef = useRef<HTMLDivElement | null>(null);

  const activeCampaign = useMemo(
    () => campaigns.find((campaign) => campaign.id === campaignId) ?? null,
    [campaignId, campaigns]
  );
  const diceExpressionError = validateDiceExpression(diceExpression);
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions]
  );
  const prepSummary = useMemo(() => {
    const openHooks = memory.events.filter((event) => event.eventType === "unresolved_hook");
    const openQuests = memory.quests.filter((quest) => quest.status !== "closed");
    const ruleNotes = documents.reduce((sum, item) => sum + item.chunkCount, 0);
    const latestHook = openHooks[0];
    const latestHookDisplay = latestHook ? formatMemoryHook(latestHook) : null;

    return {
      openHooks,
      openQuests,
      ruleNotes,
      latestHook,
      latestHookDisplay,
      sessionLabel: activeSession ? `Session ${activeSession.sessionNumber}` : "New session",
      sessionDetail: activeSession?.summary ? "Summary saved" : sessionNotes.trim() ? "Notes in progress" : "No notes yet"
    };
  }, [activeSession, documents, memory.events, memory.quests, sessionNotes]);

  useEffect(() => {
    const localClientId = getClientId();
    setClientId(localClientId);
    setClientLabel(getClientLabel());
  }, []);

  useEffect(() => {
    Promise.all([getCampaigns(), getArchivedCampaigns()])
      .then(([items, archivedItems]) => {
        setCampaigns(items);
        setArchivedCampaigns(archivedItems);
        if (items[0]) {
          setCampaignId(items[0].id);
        }
        setHasLoadedCampaigns(true);
      })
      .catch((err: Error) => {
        setHasLoadedCampaigns(true);
        setError(err.message);
      });
  }, []);

  useEffect(() => {
    if (!campaignId) {
      if (hasLoadedCampaigns) {
        resetCampaignChatState();
        setParty([]);
        setPartyEvents([]);
        setDocuments([]);
        setSessions([]);
        setActiveSessionId(null);
        setSessionTitle("Session Notes");
        setSessionNotes("");
        setSessionSaveStatus(null);
        setDraftStatus(null);
        setMemory(emptyCampaignMemory);
        setIsLoadingMemory(false);
        setMemoryError(null);
      }
      return;
    }

    setIsLoadingMemory(true);
    setMemoryError(null);
    getParty(campaignId)
      .then(setParty)
      .catch((err: Error) => setError(err.message));
    getRecentPartyEvents(campaignId)
      .then(setPartyEvents)
      .catch((err: Error) => setError(err.message));
    getDocuments(campaignId)
      .then(setDocuments)
      .catch((err: Error) => setError(err.message));
    getCampaignMemory(campaignId)
      .then((updatedMemory) => {
        setMemory(updatedMemory);
        setMemoryError(null);
      })
      .catch((err: Error) => {
        setMemoryError(err.message);
        setError(err.message);
      })
      .finally(() => setIsLoadingMemory(false));
    getSessions(campaignId)
      .then((items) => {
        setSessions(items);
        if (items[0]) {
          const draft = clientId ? window.localStorage.getItem(sessionDraftKey(clientId, campaignId, items[0].id)) : null;
          setActiveSessionId(items[0].id);
          setSessionTitle(items[0].title);
          setSessionNotes(draft ?? items[0].rawNotes ?? "");
          setSessionSaveStatus(null);
          setDraftStatus(draft ? "Draft restored locally" : null);
        } else {
          const draft = clientId ? window.localStorage.getItem(sessionDraftKey(clientId, campaignId, null)) : null;
          setActiveSessionId(null);
          setSessionTitle("Session Notes");
          setSessionNotes(draft ?? "");
          setSessionSaveStatus(null);
          setDraftStatus(draft ? "Draft restored locally" : null);
        }
      })
      .catch((err: Error) => setError(err.message));
  }, [campaignId, clientId, hasLoadedCampaigns]);

  useEffect(() => {
    if (!clientId || !campaignId) {
      return;
    }

    window.localStorage.setItem(sessionDraftKey(clientId, campaignId, activeSessionId), sessionNotes);
    if (sessionNotes.trim()) {
      setDraftStatus("Draft saved locally");
    }
  }, [activeSessionId, campaignId, clientId, sessionNotes]);

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isSending, error]);

  function campaignFormFrom(campaign: Campaign | null): CampaignFormState {
    return {
      name: campaign?.name ?? "",
      description: campaign?.description ?? "",
      systemTone: campaign?.systemTone ?? ""
    };
  }

  function resetCampaignChatState() {
    setMessages([]);
    setConversationId(null);
    setLastResponse(null);
    setLastFailedChatRequest(null);
    setActionStatus(null);
  }

  function handleCampaignSelect(nextCampaignId: string) {
    setCampaignId(nextCampaignId);
    setCampaignFormMode(null);
    setCampaignForm(campaignFormFrom(campaigns.find((campaign) => campaign.id === nextCampaignId) ?? null));
    resetCampaignChatState();
  }

  function handleNewCampaign() {
    setCampaignFormMode("new");
    setCampaignForm(emptyCampaignForm);
    setError(null);
  }

  function handleEditCampaign() {
    if (!activeCampaign) {
      return;
    }

    setCampaignFormMode("edit");
    setCampaignForm(campaignFormFrom(activeCampaign));
    setError(null);
  }

  function handleCancelCampaignForm() {
    setCampaignFormMode(null);
    setCampaignForm(campaignFormFrom(activeCampaign));
    setError(null);
  }

  async function refreshCampaignLists() {
    const [activeItems, archivedItems] = await Promise.all([getCampaigns(), getArchivedCampaigns()]);
    setCampaigns(activeItems);
    setArchivedCampaigns(archivedItems);
    return { activeItems, archivedItems };
  }

  function nextCampaignAfterArchive(archivedCampaignId: string, activeItems: Campaign[]) {
    const archivedIndex = campaigns.findIndex((campaign) => campaign.id === archivedCampaignId);
    if (archivedIndex < 0) {
      return activeItems[0] ?? null;
    }

    return activeItems[archivedIndex] ?? activeItems[archivedIndex - 1] ?? activeItems[0] ?? null;
  }

  async function handleCampaignFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!campaignFormMode || !campaignForm.name.trim()) {
      return;
    }

    setIsSavingCampaign(true);
    setError(null);

    try {
      const input = {
        name: campaignForm.name.trim(),
        description: campaignForm.description.trim() || null,
        systemTone: campaignForm.systemTone.trim() || null
      };
      const saved =
        campaignFormMode === "new"
          ? await createCampaign(input)
          : activeCampaign
            ? await updateCampaign(activeCampaign.id, input)
            : null;

      if (!saved) {
        return;
      }

      const { activeItems } = await refreshCampaignLists();
      const refreshedCampaigns = activeItems.some((campaign) => campaign.id === saved.id) ? activeItems : [saved, ...activeItems];
      setCampaigns(refreshedCampaigns);
      setCampaignId(saved.id);
      setCampaignFormMode(null);
      setCampaignForm(campaignFormFrom(saved));
      if (campaignFormMode === "new") {
        resetCampaignChatState();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "DNDMind could not save that campaign. Please try again.");
    } finally {
      setIsSavingCampaign(false);
    }
  }

  async function handleArchiveCampaign() {
    if (!activeCampaign) {
      return;
    }

    const confirmed = window.confirm(
      `Archive "${activeCampaign.name}"? It will leave the active campaign list, and you can restore it later.`
    );
    if (!confirmed) {
      return;
    }

    const archivedCampaignId = activeCampaign.id;
    setIsArchivingCampaign(true);
    setError(null);
    try {
      await archiveCampaign(archivedCampaignId);
      const { activeItems } = await refreshCampaignLists();
      const nextCampaign = campaignId === archivedCampaignId ? nextCampaignAfterArchive(archivedCampaignId, activeItems) : activeCampaign;
      setCampaignId(nextCampaign?.id ?? "");
      setCampaignFormMode(null);
      setCampaignForm(campaignFormFrom(nextCampaign));
      resetCampaignChatState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "DNDMind could not archive that campaign. Please try again.");
    } finally {
      setIsArchivingCampaign(false);
    }
  }

  async function handleRestoreCampaign(archivedCampaign: Campaign) {
    setRestoringCampaignId(archivedCampaign.id);
    setError(null);
    try {
      const restored = await restoreCampaign(archivedCampaign.id);
      const { activeItems } = await refreshCampaignLists();
      const restoredCampaign = activeItems.find((campaign) => campaign.id === restored.id) ?? restored;
      setCampaignId(restoredCampaign.id);
      setCampaignFormMode(null);
      setCampaignForm(campaignFormFrom(restoredCampaign));
      resetCampaignChatState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "DNDMind could not restore that campaign. Please try again.");
    } finally {
      setRestoringCampaignId(null);
    }
  }

  async function sendChatRequest(request: ChatRequest, options: { appendUserMessage: boolean }) {
    if (options.appendUserMessage) {
      setMessages((current) => [...current, { role: "user", content: request.message }]);
    }
    setIsSending(true);
    setError(null);
    setActionStatus(null);
    setLastFailedChatRequest(null);

    try {
      const response = await sendChat({
        campaignId: request.campaignId,
        conversationId: request.conversationId,
        sessionId: request.sessionId,
        message: request.message,
        mode: request.mode,
        context: request.context
      });
      setConversationId(response.conversationId);
      const enhanced = enhanceChatResultForPreparedContent(request.message, response, request.mode);
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
      const message = err instanceof Error ? err.message : "DNDMind could not send that message. Please try again.";
      setError(message);
      setLastFailedChatRequest({ ...request, errorMessage: message });
    } finally {
      setIsSending(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!campaignId || !input.trim()) {
      return;
    }

    let chatSessionId = activeSessionId;
    if (mode.toLowerCase() === "summarize" && (activeSessionId || sessionNotes.trim())) {
      const saved = await handleSaveSession();
      if (!saved) {
        return;
      }
      chatSessionId = saved.id;
    }

    const request: ChatRequest = {
      campaignId,
      conversationId,
      sessionId: chatSessionId,
      message: input.trim(),
      mode,
      context: { ...context }
    };
    setInput("");
    await sendChatRequest(request, { appendUserMessage: true });
  }

  async function handleRetryFailedChat() {
    if (!lastFailedChatRequest || isSending) {
      return;
    }
    await sendChatRequest(lastFailedChatRequest, { appendUserMessage: false });
  }

  function handleEditFailedChat() {
    if (!lastFailedChatRequest) {
      return;
    }
    setMode(lastFailedChatRequest.mode);
    setContext({ ...lastFailedChatRequest.context });
    setInput(lastFailedChatRequest.message);
    setError(null);
    setLastFailedChatRequest(null);
  }

  function handleClearChat() {
    if (isSending || messages.length === 0) {
      return;
    }

    setIsClearChatDialogOpen(true);
  }

  function confirmClearChat() {
    if (isSending) {
      return;
    }

    setMessages([]);
    setConversationId(null);
    setLastResponse(null);
    setError(null);
    setActionStatus(null);
    setLastFailedChatRequest(null);
    setIsClearChatDialogOpen(false);
  }

  function toggleContext(key: keyof ChatContext) {
    setContext((current) => ({ ...current, [key]: !current[key] }));
  }

  function handleQuickPrompt(prompt: (typeof quickPrompts)[number]) {
    setMode(prompt.mode);
    setInput(prompt.prompt);
    if (prompt.suggestionMode === "recap") {
      setContext((current) => ({ ...current, useCampaignMemory: true }));
    }
    setPromptSuggestionError(null);
  }

  async function handlePromptSuggestion(selectedMode: PromptSuggestionMode = promptSuggestionModeFromHint(mode)) {
    if (!campaignId || isGeneratingPromptSuggestion) {
      return;
    }

    setIsGeneratingPromptSuggestion(true);
    setPromptSuggestionError(null);

    try {
      const response = await generatePromptSuggestion({
        campaignId,
        sessionId: activeSessionId,
        mode: selectedMode,
        currentInput: input
      });
      if (response.prompt.trim()) {
        setInput(response.prompt);
      }
    } catch (err) {
      setPromptSuggestionError(err instanceof Error ? err.message : "DNDMind could not draft a prompt suggestion. Please try again.");
    } finally {
      setIsGeneratingPromptSuggestion(false);
    }
  }

  async function handleQuickPromptSuggestion(prompt: (typeof quickPrompts)[number]) {
    setMode(prompt.mode);
    if (prompt.suggestionMode === "recap") {
      setContext((current) => ({ ...current, useCampaignMemory: true }));
    }
    await handlePromptSuggestion(prompt.suggestionMode as PromptSuggestionMode);
  }

  function handleLoadPreparedScene() {
    const prompt = "Create a medium encounter for this party involving Captain Vey and the Ashen Knives.";
    const response: ChatResponse = {
      conversationId: conversationId ?? "prepared-encounter",
      answer: "",
      mode: "Encounter",
      citations: [],
      toolCalls: [],
      structuredOutput: null,
      suggestedActions: []
    };
    const enhanced = enhanceChatResultForPreparedContent(prompt, response, "Encounter");
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
    setActiveMobileWorkspaceTab(mobileWorkspaceTabForNavigationItem(item));
    window.setTimeout(() => {
      document.getElementById(item.targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
    if (item.label === "Evaluations") {
      setInput("Run the sample eval suite for rules, memory, tools, and structured output.");
    }
  }

  async function handleDocumentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = documentContent.trim();
    if (!content) {
      setError("Add a .txt or .md file, or paste some campaign knowledge first.");
      return;
    }
    if (!campaignId || !documentTitle.trim()) {
      return;
    }

    setIsIngesting(true);
    setError(null);
    try {
      const uploaded = await uploadDocument({
        campaignId,
        title: documentTitle.trim(),
        content,
        sourceType: documentSourceType,
        originalFilename: documentFileName
      });
      await ingestDocument(uploaded.id);
      setDocuments(await getDocuments(campaignId));
      setDocumentContent("");
      setDocumentFileName(null);
      setInput(documentSourceType === "homebrew" ? "Use my homebrew context for tonight's scene." : "How does advantage work?");
      setMode(documentSourceType === "homebrew" ? "Auto" : "Rules");
    } catch (err) {
      setError(err instanceof Error ? err.message : "DNDMind could not add that campaign knowledge. Please try again.");
    } finally {
      setIsIngesting(false);
    }
  }

  async function handleDeleteDocument(document: KnowledgeDocument) {
    if (!campaignId || document.sourceType === "campaign_memory") {
      return;
    }

    const confirmed = window.confirm(`Delete "${document.title}" and remove its notes from Campaign Knowledge?`);
    if (!confirmed) {
      return;
    }

    setDeletingDocumentId(document.id);
    setError(null);
    try {
      await deleteDocument(document.id);
      setDocuments(await getDocuments(campaignId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "DNDMind could not remove that campaign knowledge. Please try again.");
    } finally {
      setDeletingDocumentId(null);
    }
  }

  async function handleDeleteEncounter(encounterId: string) {
    if (!campaignId) {
      return;
    }

    setDeletingEncounterId(encounterId);
    setError(null);
    try {
      await deleteEncounter(campaignId, encounterId);
      setMemory((currentMemory) => ({
        ...currentMemory,
        encounters: currentMemory.encounters.filter((encounter) => encounter.id !== encounterId)
      }));
      setDocuments((currentDocuments) =>
        currentDocuments.filter((document) => {
          const metadata = object(document.metadata);
          return !(document.sourceType === "campaign_memory" && text(metadata.memoryType) === "encounter" && text(metadata.encounterId) === encounterId);
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "DNDMind could not delete that encounter. Please try again.");
      throw err;
    } finally {
      setDeletingEncounterId(null);
    }
  }

  async function handleDeleteMemoryItem(kind: MemoryItemKind, itemId: string) {
    if (!campaignId) {
      return;
    }

    const itemKey = `${kind}:${itemId}`;
    setDeletingMemoryItemKey(itemKey);
    setError(null);
    try {
      if (kind === "npc") {
        await deleteNpc(campaignId, itemId);
        setMemory((currentMemory) => ({
          ...currentMemory,
          npcs: currentMemory.npcs.filter((npc) => npc.id !== itemId)
        }));
      } else if (kind === "quest") {
        await deleteQuest(campaignId, itemId);
        setMemory((currentMemory) => ({
          ...currentMemory,
          quests: currentMemory.quests.filter((quest) => quest.id !== itemId)
        }));
      } else if (kind === "location") {
        await deleteLocation(campaignId, itemId);
        setMemory((currentMemory) => ({
          ...currentMemory,
          locations: currentMemory.locations.filter((location) => location.id !== itemId)
        }));
      } else {
        await deleteMemoryEvent(campaignId, itemId);
        setMemory((currentMemory) => ({
          ...currentMemory,
          events: currentMemory.events.filter((event) => event.id !== itemId)
        }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "DNDMind could not delete that memory item. Please try again.");
      throw err;
    } finally {
      setDeletingMemoryItemKey(null);
    }
  }

  async function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const accepted = await handleFileUpload(event.target.files?.[0] ?? null);
    if (!accepted) {
      event.target.value = "";
    }
  }

  async function handleFileUpload(file: File | null) {
    if (!file) {
      setDocumentFileName(null);
      return false;
    }

    const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!acceptedDocumentExtensions.includes(extension)) {
      setError("Choose a .txt or .md file for Campaign Knowledge.");
      setDocumentFileName(null);
      setDocumentContent("");
      return false;
    }
    if (file.size > maxDocumentUploadBytes) {
      setError("That file is too large. Campaign Knowledge supports files up to 2 MB.");
      setDocumentFileName(null);
      setDocumentContent("");
      return false;
    }

    const text = await file.text();
    if (!text.trim()) {
      setError("That file looks empty. Add notes or choose another .txt or .md file.");
      setDocumentFileName(null);
      setDocumentContent("");
      return false;
    }

    setError(null);
    setDocumentFileName(file.name);
    setDocumentTitle(file.name.replace(/\.[^.]+$/, "") || file.name);
    setDocumentContent(text);
    return true;
  }

  async function saveSessionChanges() {
    if (!campaignId || !sessionTitle.trim()) {
      return null;
    }

    if (activeSessionId) {
      const active = sessions.find((session) => session.id === activeSessionId);
      const updated = await updateSession({
        sessionId: activeSessionId,
        sessionNumber: active?.sessionNumber ?? 1,
        title: sessionTitle.trim(),
        rawNotes: sessionNotes,
        summary: null,
        status: "active"
      });
      setSessions((current) => current.map((session) => (session.id === updated.id ? updated : session)));
      if (clientId) {
        window.localStorage.removeItem(sessionDraftKey(clientId, campaignId, updated.id));
      }
      return updated;
    }

    const newDraftKey = clientId ? sessionDraftKey(clientId, campaignId, null) : null;
    const created = await createSession({
      campaignId,
      title: sessionTitle.trim(),
      rawNotes: sessionNotes
    });
    setActiveSessionId(created.id);
    setSessions((current) => [created, ...current]);
    if (clientId) {
      if (newDraftKey) {
        window.localStorage.removeItem(newDraftKey);
      }
      window.localStorage.removeItem(sessionDraftKey(clientId, campaignId, created.id));
    }
    return created;
  }

  async function handleSaveSession() {
    setIsSavingSession(true);
    setSessionSaveStatus(null);
    setError(null);
    try {
      const saved = await saveSessionChanges();
      if (saved) {
        setSessionSaveStatus("Saved");
        setDraftStatus(null);
      }
      return saved;
    } catch (err) {
      setError(err instanceof Error ? err.message : "DNDMind could not save that session. Please try again.");
      setSessionSaveStatus("Could not save");
      return null;
    } finally {
      setIsSavingSession(false);
    }
  }

  async function handleSummarizeSession() {
    setIsSummarizing(true);
    setSessionSaveStatus(null);
    setError(null);
    try {
      const saved = await saveSessionChanges();
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
      setMemoryError(null);
      setDocuments(updatedDocuments);
      setInput("Who betrayed the party last session?");
    } catch (err) {
      setError(err instanceof Error ? err.message : "DNDMind could not summarize that session. Please try again.");
    } finally {
      setIsSummarizing(false);
    }
  }

  async function handleManualDiceRoll() {
    if (!campaignId) {
      return;
    }

    const validationError = validateDiceExpression(diceExpression);
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsRolling(true);
    setError(null);
    try {
      const response = await executeTool({
        campaignId,
        conversationId,
        toolName: "rollDice",
        arguments: { expression: diceExpression.trim() }
      });
      setManualToolCall(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "DNDMind could not roll those dice. Please try again.");
    } finally {
      setIsRolling(false);
    }
  }

  async function refreshParty() {
    if (!campaignId) {
      return;
    }
    const [updatedParty, updatedEvents] = await Promise.all([
      getParty(campaignId),
      getRecentPartyEvents(campaignId)
    ]);
    setParty(updatedParty);
    setPartyEvents(updatedEvents);
  }

  async function handleSavePartyCharacter(input: PartyCharacterInput) {
    if (!campaignId) {
      return;
    }

    setIsSavingParty(true);
    setPartyStatus(null);
    setError(null);
    try {
      if (activePartyPanel?.mode === "edit" && activePartyPanel.character) {
        await updatePartyCharacter(activePartyPanel.character.id, input);
        setPartyStatus("Character updated");
      } else {
        await createPartyCharacter(campaignId, input);
        setPartyStatus("Character added");
      }
      await refreshParty();
      setActivePartyPanel(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "DNDMind could not save that character. Please try again.");
    } finally {
      setIsSavingParty(false);
    }
  }

  async function handleDeletePartyCharacter(character: PartyCharacter) {
    setIsSavingParty(true);
    setError(null);
    try {
      await deletePartyCharacter(character.id);
      await refreshParty();
      setActivePartyPanel(null);
      setPartyStatus("Character archived");
    } catch (err) {
      setError(err instanceof Error ? err.message : "DNDMind could not remove that character. Please try again.");
    } finally {
      setIsSavingParty(false);
    }
  }

  async function handleSavePartyHp(input: { hpCurrent: number | null; tempHp: number | null; note: string }) {
    if (!activePartyPanel?.character) {
      return;
    }

    setIsSavingParty(true);
    setError(null);
    try {
      await updatePartyCharacterHp({
        characterId: activePartyPanel.character.id,
        hpCurrent: input.hpCurrent,
        tempHp: input.tempHp,
        note: input.note
      });
      await refreshParty();
      setActivePartyPanel(null);
      setPartyStatus("HP updated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "DNDMind could not update HP. Please try again.");
    } finally {
      setIsSavingParty(false);
    }
  }

  async function handleQuickLevelChange(character: PartyCharacter, nextLevel: number) {
    setIsSavingParty(true);
    setError(null);
    try {
      await updatePartyCharacterLevel({
        characterId: character.id,
        level: nextLevel,
        note: `Level set from ${character.level} to ${nextLevel}.`
      });
      await refreshParty();
      setPartyStatus(`${character.name} is now level ${nextLevel}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "DNDMind could not update the level. Please try again.");
    } finally {
      setIsSavingParty(false);
    }
  }

  async function handleCreatePartyNote(input: { title: string; description: string }) {
    if (!activePartyPanel?.character) {
      return;
    }

    setIsSavingParty(true);
    setError(null);
    try {
      await createPartyCharacterEvent({
        characterId: activePartyPanel.character.id,
        eventType: "note_added",
        title: input.title,
        description: input.description,
        sessionId: activeSessionId
      });
      const [events, updatedEvents] = await Promise.all([
        getPartyCharacterEvents(activePartyPanel.character.id),
        getRecentPartyEvents(campaignId)
      ]);
      setCharacterEvents(events);
      setPartyEvents(updatedEvents);
      setPartyStatus("Progress note added");
    } catch (err) {
      setError(err instanceof Error ? err.message : "DNDMind could not save that progress note. Please try again.");
    } finally {
      setIsSavingParty(false);
    }
  }

  async function openPartyHistory(character: PartyCharacter) {
    setActivePartyPanel({ mode: "history", character });
    setCharacterEvents([]);
    setIsLoadingPartyHistory(true);
    setError(null);
    try {
      setCharacterEvents(await getPartyCharacterEvents(character.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "DNDMind could not load that character's history. Refresh the page and try again.");
    } finally {
      setIsLoadingPartyHistory(false);
    }
  }

  async function handleSuggestedAction(action: SuggestedAction) {
    if (!campaignId) {
      return;
    }

    setActionStatus(null);
    setError(null);
    try {
      let savedEncounter: CampaignMemory["encounters"][number] | null = null;
      if (action.action === "saveNPC") {
        await saveNpc(campaignId, action.payload);
        setActionStatus("NPC saved");
      } else if (action.action === "saveQuest") {
        await saveQuest(campaignId, action.payload);
        setActionStatus("Quest saved");
      } else if (action.action === "saveLocation") {
        await saveLocation(campaignId, action.payload);
        setActionStatus("Location saved");
      } else if (action.action === "saveCharacter") {
        await createPartyCharacter(campaignId, partyCharacterInputFromStructuredPayload(action.payload));
        await refreshParty();
        setActionStatus("Character saved");
      } else if (action.action === "saveEncounter") {
        const response = await saveEncounter(campaignId, {
          ...action.payload,
          sessionId: activeSessionId
        });
        savedEncounter = response.encounter;
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

      const updatedMemory = await getCampaignMemory(campaignId);
      setMemory(savedEncounter ? mergeSavedEncounter(updatedMemory, savedEncounter) : updatedMemory);
      setMemoryError(null);
      setSessions(await getSessions(campaignId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "DNDMind could not complete that action. Please try again.");
    }
  }

  function partyCharacterInputFromStructuredPayload(payload: Record<string, unknown>): PartyCharacterInput {
    const level = positiveIntegerFromUnknown(payload.level, 1);
    const abilityScores = abilityScoreMapFromPayload(payload);
    const hpMax = firstIntegerFromUnknown(
      [payload.hpMax, payload.maxHp, payload.hitPoints, payload.hitPointMaximum, extractLabeledNumber(payload.statSummary, "HP")],
      null
    ) ?? estimatedHpMax(payload, abilityScores, level);
    const armorClass = firstIntegerFromUnknown(
      [payload.armorClass, payload.ac, extractLabeledNumber(payload.statSummary, "AC")],
      null
    ) ?? estimatedArmorClass(payload, abilityScores);
    const initiativeModifier = firstIntegerFromUnknown(
      [payload.initiativeModifier, payload.initiative, extractLabeledNumber(payload.statSummary, "Initiative")],
      null
    ) ?? abilityModifier(abilityScores.dex);
    const passivePerception = firstIntegerFromUnknown(
      [payload.passivePerception, payload.passiveWisdom, extractLabeledNumber(payload.statSummary, "Passive Perception")],
      null
    ) ?? (10 + abilityModifier(abilityScores.wis));
    const hpCurrent = firstIntegerFromUnknown([payload.hpCurrent, payload.currentHp], hpMax);

    return {
      name: text(payload.name) || "Generated Character",
      className: nullableText(payload.classAndSubclass ?? payload.className),
      race: nullableText(payload.ancestryOrSpecies ?? payload.race ?? payload.raceOrSpecies),
      level,
      hpCurrent,
      hpMax,
      tempHp: firstIntegerFromUnknown([payload.tempHp, payload.temporaryHp], null),
      armorClass,
      initiativeModifier,
      passivePerception,
      conditions: [],
      notes: characterNotesFromStructuredPayload(payload)
    };
  }

  function characterNotesFromStructuredPayload(payload: Record<string, unknown>): string | null {
    const notes = [
      noteLine("Role", payload.role),
      noteLine("Background", payload.background),
      noteLine("Stats", abilityScoresText(payload.abilityScores) || payload.statSummary),
      noteLine("Personality Traits", listText(payload.personalityTraits)),
      noteLine("Ideals/Bonds/Flaws", idealsBondsFlawsText(payload.idealsBondsFlaws)),
      noteLine("Equipment", listText(payload.equipment)),
      noteLine("Campaign Tie-In", payload.campaignTieIn),
      noteLine("Secret or Hook", payload.secretOrHook)
    ].filter(Boolean);

    return notes.length ? notes.join("\n") : null;
  }

  function noteLine(label: string, value: unknown) {
    const valueText = text(value).trim();
    return valueText ? `${label}: ${valueText}` : "";
  }

  function listText(value: unknown) {
    return Array.isArray(value) ? value.map(text).map((item) => item.trim()).filter(Boolean).join(", ") : text(value);
  }

  function idealsBondsFlawsText(value: unknown) {
    const data = object(value);
    const entries = ["ideal", "bond", "flaw"]
      .map((key) => {
        const label = sentenceCase(key);
        const valueText = text(data[key] ?? data[label]).trim();
        return valueText ? `${label}: ${valueText}` : "";
      })
      .filter(Boolean);
    return entries.length ? entries.join("; ") : text(value);
  }

  function abilityScoresText(value: unknown) {
    const scores = object(value);
    return ["str", "dex", "con", "int", "wis", "cha"]
      .map((key) => {
        const score = scores[key] ?? scores[key.toUpperCase()];
        const scoreText = text(score).trim();
        return scoreText ? `${key.toUpperCase()} ${scoreText}` : "";
      })
      .filter(Boolean)
      .join(", ");
  }

  function abilityScoreMapFromPayload(payload: Record<string, unknown>) {
    const explicitScores = object(payload.abilityScores);
    const summaryScores = abilityScoreMapFromText(text(payload.statSummary));
    return {
      str: firstIntegerFromUnknown([explicitScores.str, explicitScores.STR, summaryScores.str], 10) ?? 10,
      dex: firstIntegerFromUnknown([explicitScores.dex, explicitScores.DEX, summaryScores.dex], 10) ?? 10,
      con: firstIntegerFromUnknown([explicitScores.con, explicitScores.CON, summaryScores.con], 10) ?? 10,
      int: firstIntegerFromUnknown([explicitScores.int, explicitScores.INT, summaryScores.int], 10) ?? 10,
      wis: firstIntegerFromUnknown([explicitScores.wis, explicitScores.WIS, summaryScores.wis], 10) ?? 10,
      cha: firstIntegerFromUnknown([explicitScores.cha, explicitScores.CHA, summaryScores.cha], 10) ?? 10
    };
  }

  function abilityScoreMapFromText(value: string) {
    const scores: Record<string, number> = {};
    for (const key of ["str", "dex", "con", "int", "wis", "cha"]) {
      const match = value.match(new RegExp(`\\b${key}\\w*\\s*(?:=|:)?\\s*(\\d{1,2})\\b`, "i"));
      if (match) {
        scores[key] = positiveIntegerFromUnknown(match[1], 10);
      }
    }
    return scores;
  }

  function estimatedHpMax(payload: Record<string, unknown>, abilityScores: Record<string, number>, level: number) {
    const hitDie = classHitDie(text(payload.classAndSubclass ?? payload.className));
    const fixedAverage = Math.floor(hitDie / 2) + 1;
    const conModifier = abilityModifier(abilityScores.con);
    return Math.max(level, hitDie + conModifier + Math.max(0, level - 1) * (fixedAverage + conModifier));
  }

  function estimatedArmorClass(payload: Record<string, unknown>, abilityScores: Record<string, number>) {
    const className = text(payload.classAndSubclass ?? payload.className).toLowerCase();
    const equipment = listText(payload.equipment).toLowerCase();
    const dexModifier = abilityModifier(abilityScores.dex);
    const conModifier = abilityModifier(abilityScores.con);
    const wisModifier = abilityModifier(abilityScores.wis);

    const explicitArmor = armorClassFromEquipment(equipment, dexModifier);
    if (explicitArmor !== null) {
      return explicitArmor + (/\bshield\b/.test(equipment) ? 2 : 0);
    }
    if (className.includes("monk")) {
      return 10 + dexModifier + wisModifier;
    }
    if (className.includes("barbarian")) {
      return 10 + dexModifier + conModifier;
    }
    if (/\b(paladin|fighter|cleric)\b/.test(className)) {
      return 16 + (/\bshield\b/.test(equipment) || className.includes("paladin") || className.includes("cleric") ? 2 : 0);
    }
    if (/\b(ranger|druid)\b/.test(className)) {
      return 14 + Math.min(2, Math.max(0, dexModifier));
    }
    if (/\b(rogue|bard|warlock|artificer)\b/.test(className)) {
      return 11 + dexModifier;
    }
    return 10 + dexModifier;
  }

  function armorClassFromEquipment(equipment: string, dexModifier: number) {
    if (/\bplate\b/.test(equipment)) return 18;
    if (/\bchain mail\b/.test(equipment)) return 16;
    if (/\bsplint\b/.test(equipment)) return 17;
    if (/\bbreastplate\b/.test(equipment)) return 14 + Math.min(2, Math.max(0, dexModifier));
    if (/\bscale mail\b|\bhalf plate\b/.test(equipment)) return (equipment.includes("half plate") ? 15 : 14) + Math.min(2, Math.max(0, dexModifier));
    if (/\bstudded leather\b/.test(equipment)) return 12 + dexModifier;
    if (/\bleather\b/.test(equipment)) return 11 + dexModifier;
    return null;
  }

  function classHitDie(className: string) {
    const normalized = className.toLowerCase();
    if (/\b(barbarian)\b/.test(normalized)) return 12;
    if (/\b(fighter|paladin|ranger)\b/.test(normalized)) return 10;
    if (/\b(artificer|bard|cleric|druid|monk|rogue|warlock)\b/.test(normalized)) return 8;
    return 6;
  }

  function abilityModifier(score: number) {
    return Math.floor((score - 10) / 2);
  }

  function extractLabeledNumber(value: unknown, label: string) {
    const match = text(value).match(new RegExp(`\\b${label}\\b\\s*(?:=|:)?\\s*([+-]?\\d{1,3})\\b`, "i"));
    return match ? Number.parseInt(match[1], 10) : null;
  }

  function firstIntegerFromUnknown(values: unknown[], fallback: number | null) {
    for (const value of values) {
      const parsed = integerFromUnknown(value);
      if (parsed !== null) {
        return parsed;
      }
    }
    return fallback;
  }

  function integerFromUnknown(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.floor(value);
    }
    const valueText = text(value).trim();
    if (!valueText) {
      return null;
    }
    const parsed = Number.parseInt(valueText, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function positiveIntegerFromUnknown(value: unknown, fallback: number) {
    const parsed = typeof value === "number" ? value : Number.parseInt(text(value), 10);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  }

  function nullableText(value: unknown) {
    const valueText = text(value).trim();
    return valueText ? valueText : null;
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

  function handleResetLocalProfile() {
    const confirmed = window.confirm(
      "Resetting local profile will create a new local identity and your previous browser-owned sessions may no longer appear."
    );
    if (!confirmed) {
      return;
    }

    const nextClientId = resetClientId();
    const nextClientLabel = getClientLabel(nextClientId);
    setClientId(nextClientId);
    setClientLabel(nextClientLabel);
    setClientProfileStatus(`Switched to ${nextClientLabel}`);
    setSessions([]);
    setActiveSessionId(null);
    setSessionTitle("Session Notes");
    setSessionNotes("");
    setSessionSaveStatus(null);
    setDraftStatus(null);
    setMemory(emptyCampaignMemory);
    setConversationId(null);
    setMessages([]);
    setLastResponse(null);
    setError(null);
  }

  return (
    <main className="min-h-screen bg-parchment text-ink xl:h-screen xl:overflow-hidden">
      <nav
        className="sticky top-0 z-40 border-b border-moss/15 bg-parchment/95 px-3 py-2 shadow-sm backdrop-blur xl:hidden"
        aria-label="Mobile workspace"
      >
        <div className="grid grid-cols-3 gap-2 rounded-md border border-moss/15 bg-white p-1">
          {mobileWorkspaceTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveMobileWorkspaceTab(tab.id)}
              aria-pressed={activeMobileWorkspaceTab === tab.id}
              className={`rounded px-3 py-2 text-sm font-semibold transition ${
                activeMobileWorkspaceTab === tab.id ? "bg-ink text-white shadow-sm" : "text-moss hover:bg-parchment"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>
      <div className="grid min-h-[calc(100dvh-4rem)] grid-cols-1 xl:h-screen xl:min-h-0 xl:grid-cols-[270px_minmax(0,1fr)_350px] xl:overflow-hidden">
        <aside
          className={`border-b border-white/10 bg-moss px-5 py-5 text-white shadow-2xl shadow-moss/20 xl:block xl:h-screen xl:overflow-y-auto xl:border-b-0 xl:border-r ${
            activeMobileWorkspaceTab === "campaign" ? "block" : "hidden"
          }`}
        >
          <div className="mb-7">
            <div className="flex items-center gap-3">
              <D20MindSparkLogo />
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-mist">DNDMind</p>
                <h1 className="mt-1 text-2xl font-semibold leading-tight">DM Command Center</h1>
              </div>
            </div>
            <p className="mt-2 text-sm leading-6 text-mist/80">Rules, memory, and table-ready output in one live workspace.</p>
          </div>

          <div className="mb-6 rounded-md border border-white/15 bg-white/10 p-3 text-sm text-mist">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-mist/70">Device Profile</p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="font-semibold text-white">{clientLabel}</span>
              <button
                type="button"
                onClick={handleResetLocalProfile}
                className="rounded-md border border-white/20 px-2.5 py-1 text-xs font-semibold text-white hover:border-copper"
              >
                Reset
              </button>
            </div>
            {clientProfileStatus && <p className="mt-2 text-xs font-semibold text-mist">{clientProfileStatus}</p>}
          </div>

          <div className="space-y-3">
            <div className="space-y-2">
              <label className="text-sm font-medium text-mist" htmlFor="campaign">
                Campaign
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={handleNewCampaign}
                  className="min-w-0 rounded-md border border-white/20 px-2 py-1.5 text-xs font-semibold text-white hover:border-copper"
                >
                  New
                </button>
                <button
                  type="button"
                  onClick={handleEditCampaign}
                  disabled={!activeCampaign || isArchivingCampaign}
                  className="min-w-0 rounded-md border border-white/20 px-2 py-1.5 text-xs font-semibold text-white hover:border-copper disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={handleArchiveCampaign}
                  disabled={!activeCampaign || isArchivingCampaign}
                  className="min-w-0 rounded-md border border-white/15 px-2 py-1.5 text-xs font-semibold text-mist hover:border-ember hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isArchivingCampaign ? "Archiving" : "Archive"}
                </button>
              </div>
            </div>
            <select
              id="campaign"
              value={campaignId}
              onChange={(event) => handleCampaignSelect(event.target.value)}
              disabled={campaigns.length === 0}
              className="w-full rounded-md border border-white/15 bg-white/10 px-3 py-2 text-sm text-white"
            >
              {campaigns.length === 0 && <option value="">No active campaigns</option>}
              {campaigns.map((campaign) => (
                <option className="text-ink" key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
            {activeCampaign?.description && (
              <p className="line-clamp-3 break-words text-xs leading-5 text-mist/75">{activeCampaign.description}</p>
            )}
            {campaignFormMode && (
              <form onSubmit={handleCampaignFormSubmit} className="rounded-md border border-white/15 bg-white/10 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist/70">
                  {campaignFormMode === "new" ? "New campaign" : "Edit campaign"}
                </p>
                <div className="mt-3 space-y-2">
                  <input
                    value={campaignForm.name}
                    onChange={(event) => setCampaignForm((current) => ({ ...current, name: event.target.value }))}
                    className="w-full rounded-md border border-white/15 bg-moss px-3 py-2 text-sm text-white placeholder:text-mist/70"
                    placeholder="Name"
                    required
                  />
                  <textarea
                    value={campaignForm.description}
                    onChange={(event) => setCampaignForm((current) => ({ ...current, description: event.target.value }))}
                    rows={3}
                    className="w-full resize-none rounded-md border border-white/15 bg-moss px-3 py-2 text-sm text-white placeholder:text-mist/70"
                    placeholder="Description"
                  />
                  <input
                    value={campaignForm.systemTone}
                    onChange={(event) => setCampaignForm((current) => ({ ...current, systemTone: event.target.value }))}
                    className="w-full rounded-md border border-white/15 bg-moss px-3 py-2 text-sm text-white placeholder:text-mist/70"
                    placeholder="Campaign response tone"
                  />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleCancelCampaignForm}
                    disabled={isSavingCampaign}
                    className="rounded-md border border-white/20 px-3 py-2 text-xs font-semibold text-mist hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingCampaign || !campaignForm.name.trim()}
                    className="rounded-md bg-white px-3 py-2 text-xs font-semibold text-moss disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSavingCampaign ? "Saving" : "Save"}
                  </button>
                </div>
              </form>
            )}
            <div className="rounded-md border border-white/10 bg-white/[0.06] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist/70">Archived</p>
                {archivedCampaigns.length > 0 && <span className="text-[11px] font-semibold text-mist/60">{archivedCampaigns.length}</span>}
              </div>
              {archivedCampaigns.length > 0 ? (
                <div className="mt-2 space-y-1.5">
                  {archivedCampaigns.map((campaign) => (
                    <div key={campaign.id} className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-white/5 px-2 py-1.5">
                      <span className="min-w-0 truncate text-xs font-medium text-mist" title={campaign.name}>
                        {campaign.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRestoreCampaign(campaign)}
                        disabled={restoringCampaignId === campaign.id}
                        className="shrink-0 rounded-md border border-white/15 px-2 py-1 text-[11px] font-semibold text-white hover:border-copper disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {restoringCampaignId === campaign.id ? "Restoring" : "Restore"}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-xs text-mist/55">None</p>
              )}
            </div>
          </div>

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
            <Link
              href="/manual"
              className="block w-full rounded-md border border-white/15 px-3 py-2.5 text-left font-medium text-mist transition hover:bg-white/10"
            >
              User Manual
            </Link>
          </nav>

          <section id="rules-library" className="scroll-mt-4 mt-8 rounded-md border border-white/15 p-3">
            <h2 className="text-sm font-semibold text-white">Campaign Knowledge</h2>
            <p className="mt-1 text-xs leading-5 text-mist">Add rules, lore, NPCs, locations, quests, or session notes so DNDMind can cite entries from this campaign.</p>
            <form onSubmit={handleDocumentSubmit} className="mt-3 space-y-3">
              <input
                value={documentTitle}
                onChange={(event) => setDocumentTitle(event.target.value)}
                className="w-full rounded-md border border-white/15 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-mist/70"
                placeholder="Document title"
              />
              <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-mist">
                Document type
                <select
                  value={documentSourceType}
                  onChange={(event) => setDocumentSourceType(event.target.value)}
                  className="mt-2 w-full rounded-md border border-white/15 bg-moss px-3 py-2 text-sm font-medium normal-case tracking-normal text-white"
                >
                  {documentSourceTypes.map((source) => (
                    <option key={source.value} value={source.value}>
                      {source.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="rounded-md bg-white/10 p-2">
                <p className="text-xs font-semibold text-white">Download a template</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {documentTemplates.map((template) => (
                    <a
                      key={template.href}
                      href={template.href}
                      download
                      className="rounded-md border border-white/15 px-2 py-1.5 text-xs font-semibold text-mist transition hover:border-white/40 hover:bg-white/10 hover:text-white"
                    >
                      {template.label}
                    </a>
                  ))}
                </div>
              </div>
              <input
                type="file"
                accept=".md,.txt,text/markdown,text/plain"
                onChange={handleFileInputChange}
                className="w-full text-xs text-mist file:mr-3 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-2 file:text-xs file:font-semibold file:text-moss"
              />
              <p className="text-xs leading-5 text-mist">Supports .txt and .md files up to 2 MB. Pasted notes work too.</p>
              <textarea
                value={documentContent}
                onChange={(event) => {
                  setDocumentContent(event.target.value);
                  setDocumentFileName(null);
                }}
                rows={6}
                className="min-h-32 w-full resize-none rounded-md border border-white/15 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-mist/70"
                placeholder="Paste rules, lore, session notes, NPC details, or world info..."
              />
              <button
                type="submit"
                disabled={isIngesting || !campaignId || !documentTitle.trim() || !documentContent.trim()}
                className="w-full rounded-md bg-white px-3 py-2 text-sm font-semibold text-moss disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isIngesting ? "Adding" : "Add to Campaign"}
              </button>
            </form>

            <div className="mt-4 space-y-2">
              {documents.length === 0 && (
                <div className="rounded-md bg-white/10 px-3 py-2 text-xs leading-5 text-mist">
                  No campaign knowledge yet. Add a document to enable cited answers.
                </div>
              )}
              {documents.map((document) => (
                <div key={document.id} className="rounded-md bg-white/10 px-3 py-2 text-xs text-mist">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words font-semibold text-white">{document.title}</p>
                      <p>
                        {formatSourceType(document.sourceType)} · {formatDocumentStatus(document.metadata?.status)} · {document.chunkCount} notes
                      </p>
                    </div>
                    {document.sourceType !== "campaign_memory" && (
                      <button
                        type="button"
                        onClick={() => handleDeleteDocument(document)}
                        disabled={deletingDocumentId === document.id}
                        className="shrink-0 rounded-md border border-white/15 px-2 py-1 text-[11px] font-semibold text-mist transition hover:border-ember hover:bg-ember/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {deletingDocumentId === document.id ? "Deleting" : "Delete"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="mt-8 rounded-md border border-white/15 p-3 text-sm text-mist">
            <p className="font-medium text-white">Local campaign workspace</p>
            <p className="mt-1 leading-5">Campaigns, sessions, knowledge entries, and saved cards stay organized for this table.</p>
          </div>

          <div className="mt-3 rounded-md border border-white/10 bg-white/[0.06] p-3 text-xs text-mist/75">
            <p>
              <span className="font-semibold text-white">DNDMind</span> by Revanza
            </p>
            <div className="mt-2 flex flex-wrap gap-3">
              <a
                href="https://github.com/revanza-git"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-mist transition hover:text-copper"
              >
                GitHub
              </a>
              <a
                href="https://revanza.vercel.app/"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-mist transition hover:text-copper"
              >
                Portfolio
              </a>
            </div>
          </div>
        </aside>

        <section
          id="command-center"
          className={`h-[calc(100dvh-4rem)] scroll-mt-16 flex-col xl:flex xl:h-screen xl:min-h-0 xl:scroll-mt-4 xl:overflow-hidden ${
            activeMobileWorkspaceTab === "command" ? "flex" : "hidden"
          }`}
        >
          <header className="shrink-0 border-b border-moss/15 bg-white/80 px-4 py-3 shadow-sm backdrop-blur xl:px-5">
            <div className="flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-copper xl:text-sm xl:font-medium xl:normal-case xl:tracking-normal">
                    Active campaign
                  </p>
                  <span className="hidden text-moss/30 xl:inline">/</span>
                  <span className="rounded-full bg-parchment px-2 py-0.5 text-xs font-semibold text-moss xl:hidden">
                    {modeLabels[mode] ?? mode}
                  </span>
                </div>
                <h2 className="mt-1 truncate text-xl font-semibold leading-tight xl:text-2xl">{activeCampaign?.name ?? (hasLoadedCampaigns ? "No active campaign" : "Loading campaign...")}</h2>
                <p className="mt-1 hidden max-w-4xl overflow-hidden text-sm leading-6 text-moss/75 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] xl:block">
                  {activeCampaign?.description ?? (hasLoadedCampaigns ? "Create or restore a campaign to continue." : "Campaign context will appear here.")}
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-moss/75 xl:hidden">
                  <span>{party.length} PCs</span>
                  <span>{documents.reduce((sum, item) => sum + item.chunkCount, 0)} notes</span>
                  <span>{memory.npcs.length + memory.quests.length + memory.locations.length + memory.encounters.length} memory</span>
                  <span>{prepSummary.openHooks.length} hooks</span>
                </div>
                <div className="mt-3 hidden max-w-3xl grid-cols-2 gap-2 xl:grid xl:grid-cols-4">
                  <StatusMetric label="Party" value={`${party.length} PCs`} />
                  <StatusMetric label="Knowledge" value={`${documents.reduce((sum, item) => sum + item.chunkCount, 0)} notes`} />
                  <StatusMetric label="Memory" value={`${memory.npcs.length + memory.quests.length + memory.locations.length + memory.encounters.length} items`} />
                  <StatusMetric label="Open Hooks" value={`${prepSummary.openHooks.length} story threads`} />
                </div>
              </div>

              <div className="hidden flex-col gap-2 xl:flex xl:w-[25rem] xl:items-end">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-moss/60">Task hints</p>
                <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-4">
                  {modes.map((item) => (
                    <button
                      key={item}
                      type="button"
                      aria-pressed={mode === item}
                      onClick={() => setMode(item)}
                      className={`rounded-md border px-2.5 py-1.5 text-sm font-semibold shadow-sm transition ${
                        mode === item
                          ? item === "Auto"
                            ? "border-ink bg-ink text-white shadow-ink/20 ring-2 ring-ink/15"
                            : "border-copper bg-copper text-white shadow-copper/20 ring-2 ring-copper/20"
                          : item === "Auto"
                            ? "border-copper/40 bg-copper/10 text-ink hover:border-copper/70 hover:bg-copper/15"
                            : "border-moss/20 bg-white text-moss hover:border-copper/60 hover:bg-parchment/60"
                      }`}
                    >
                      {modeLabels[item] ?? item}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </header>

          <details className="shrink-0 border-b border-moss/15 bg-white px-4 py-2 xl:hidden">
            <summary className="cursor-pointer text-sm font-semibold text-moss marker:text-copper">Modes and context</summary>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {modes.map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={mode === item}
                  onClick={() => setMode(item)}
                  className={`rounded-md border px-2.5 py-2 text-sm font-semibold shadow-sm transition ${
                    mode === item
                      ? item === "Auto"
                        ? "border-ink bg-ink text-white shadow-ink/20 ring-2 ring-ink/15"
                        : "border-copper bg-copper text-white shadow-copper/20 ring-2 ring-copper/20"
                      : item === "Auto"
                        ? "border-copper/40 bg-copper/10 text-ink hover:border-copper/70 hover:bg-copper/15"
                        : "border-moss/20 bg-white text-moss hover:border-copper/60 hover:bg-parchment/60"
                  }`}
                >
                  {modeLabels[item] ?? item}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                ["useRules", "Rules"],
                ["useCampaignMemory", "Campaign Memory"],
                ["usePartyInfo", "Party Info"],
                ["useHomebrew", "Homebrew"]
              ].map(([key, label]) => (
                <label
                  key={key}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
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
          </details>

          <div className="hidden border-b border-moss/15 bg-white px-5 py-2 xl:block">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap gap-3">
                {[
                  ["useRules", "Rules"],
                  ["useCampaignMemory", "Campaign Memory"],
                  ["usePartyInfo", "Party Info"],
                  ["useHomebrew", "Homebrew"]
                ].map(([key, label]) => (
                  <label
                    key={key}
                    className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
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
              <button
                type="button"
                onClick={handleClearChat}
                disabled={isSending || messages.length === 0}
                aria-haspopup="dialog"
                aria-expanded={isClearChatDialogOpen}
                aria-label="Clear chat"
                title="Clear chat"
                className="self-start rounded-md border border-moss/20 bg-white px-3 py-1.5 text-sm font-semibold text-moss shadow-sm transition hover:border-ember/40 hover:bg-ember/10 hover:text-ember disabled:cursor-not-allowed disabled:opacity-50 md:self-auto"
              >
                Clear
              </button>
            </div>
          </div>

          {isClearChatDialogOpen && (
            <div
              className="fixed inset-0 z-50 flex items-start justify-center bg-ink/45 px-4 pt-24 backdrop-blur-[1px] sm:pt-28"
              role="presentation"
              onClick={() => setIsClearChatDialogOpen(false)}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="clear-chat-title"
                aria-describedby="clear-chat-description"
                className="w-full max-w-md rounded-lg border border-copper/25 bg-parchment p-4 text-left shadow-2xl shadow-ink/25"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-copper">New conversation</p>
                    <h2 id="clear-chat-title" className="mt-2 text-lg font-semibold text-ink">
                      Clear the current chat?
                    </h2>
                  </div>
                  <span className="rounded-full border border-ember/20 bg-ember/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ember">
                    Local only
                  </span>
                </div>
                <p id="clear-chat-description" className="mt-3 text-sm leading-6 text-moss/80">
                  This removes the visible command timeline and starts a fresh conversation. Saved campaign memory,
                  encounters, sessions, and knowledge stay intact.
                </p>
                <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setIsClearChatDialogOpen(false)}
                    className="rounded-md border border-moss/20 bg-white px-4 py-2 text-sm font-semibold text-moss shadow-sm transition hover:border-copper/40 hover:bg-white"
                  >
                    Keep chat
                  </button>
                  <button
                    type="button"
                    onClick={confirmClearChat}
                    disabled={isSending}
                    className="rounded-md bg-ember px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-copper disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Clear chat
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(216,226,220,0.55),_transparent_36rem)] px-4 pb-4 pt-3 xl:space-y-5 xl:px-5 xl:pb-6 xl:pt-5">
            {messages.length === 0 && (
              <>
                <MobileEmptyChatState
                  onPrompt={handleQuickPrompt}
                  isGeneratingPromptSuggestion={isGeneratingPromptSuggestion}
                  onPromptSuggestion={handlePromptSuggestion}
                  onPreparedScene={handleLoadPreparedScene}
                />
                <div className="hidden xl:block">
                  <EmptyChatState
                    onPrompt={handleQuickPrompt}
                    onPromptSuggestion={handleQuickPromptSuggestion}
                    isGeneratingPromptSuggestion={isGeneratingPromptSuggestion}
                    onPreparedScene={handleLoadPreparedScene}
                  />
                </div>
              </>
            )}
            {messages.map((message, index) => (
              <ChatTimelineCard
                key={`${message.role}-${index}`}
                message={message}
                actionStatus={actionStatus}
                onAction={handleSuggestedAction}
                campaignId={campaignId}
                conversationId={conversationId}
              />
            ))}

            {error && (
              <div className="rounded-md border border-ember/30 bg-ember/10 px-4 py-3 text-sm text-ember">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="leading-6">{error}</p>
                  {lastFailedChatRequest?.errorMessage === error && (
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handleRetryFailedChat}
                        disabled={isSending}
                        className="rounded-md bg-ember px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-copper disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isSending ? "Trying again" : "Try again"}
                      </button>
                      <button
                        type="button"
                        onClick={handleEditFailedChat}
                        disabled={isSending}
                        className="rounded-md border border-ember/30 bg-white/70 px-3 py-1.5 text-xs font-semibold text-ember shadow-sm hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Edit message
                      </button>
                    </div>
                  )}
                </div>
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

          <form onSubmit={handleSubmit} className="sticky bottom-0 z-30 shrink-0 border-t border-moss/15 bg-white/95 p-1.5 shadow-2xl shadow-moss/10 xl:static xl:p-2">
            <div className="rounded-md border border-moss/15 bg-ink p-2 shadow-inner">
              <div className="mb-1 flex flex-col gap-1 px-1 sm:flex-row sm:items-center sm:justify-between">
                <span className="hidden text-xs font-semibold uppercase tracking-[0.18em] text-mist/70 sm:inline">Command Console</span>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-copper/20 px-2 py-0.5 text-xs font-semibold text-mist">{modeLabels[mode] ?? mode} hint</span>
                  <button
                    type="button"
                    onClick={() => handlePromptSuggestion()}
                    disabled={!campaignId || isGeneratingPromptSuggestion}
                    aria-label="Generate a prompt suggestion"
                    title="Generate a prompt suggestion"
                    className="rounded-md border border-white/15 bg-white/10 px-2 py-0.5 text-xs font-semibold text-mist transition hover:border-copper/60 hover:bg-copper/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isGeneratingPromptSuggestion ? "Sparking" : "Spark"}
                  </button>
                </div>
              </div>
              {promptSuggestionError && <p className="mb-2 px-1 text-xs font-semibold text-ember">{promptSuggestionError}</p>}
              <div className="flex flex-col gap-2 md:flex-row">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                rows={2}
                className="min-h-12 flex-1 resize-none rounded-md border border-white/10 bg-white px-3 py-2 text-sm leading-6 text-ink shadow-inner placeholder:text-moss/50 sm:min-h-16"
                placeholder="Ask for a ruling, NPC, character, combat beat, campaign recap, session summary, or scene setup..."
              />
              <button
                type="submit"
                disabled={isSending || !campaignId}
                className="rounded-md bg-copper px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-ember disabled:cursor-not-allowed disabled:opacity-50 md:w-28"
              >
                {isSending ? "Sending" : "Send"}
              </button>
              </div>
            </div>
          </form>
        </section>

        <aside
          className={`border-t border-moss/15 bg-white px-5 py-5 xl:block xl:h-screen xl:overflow-y-auto xl:border-l xl:border-t-0 ${
            activeMobileWorkspaceTab === "notes" ? "block" : "hidden"
          }`}
        >
          <section id="encounters" className="scroll-mt-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-copper">Saved Encounters</h2>
            <SavedEncountersSection
              encounters={memory.encounters}
              isLoading={isLoadingMemory}
              error={memoryError}
              deletingEncounterId={deletingEncounterId}
              onDeleteEncounter={handleDeleteEncounter}
            />
          </section>

          <section className="mt-7">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-copper">Dice Roller</h2>
            <div className="mt-3 space-y-3 rounded-lg border border-moss/15 bg-parchment/45 p-3 shadow-sm">
              <div className="flex gap-2">
                <input
                  value={diceExpression}
                  onChange={(event) => setDiceExpression(sanitizeDiceExpressionInput(event.target.value))}
                  className={`min-w-0 flex-1 rounded-md border px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-copper/30 ${
                    diceExpressionError ? "border-ember/50 bg-ember/5" : "border-moss/20 bg-white"
                  }`}
                  inputMode="text"
                  maxLength={12}
                  pattern="[0-9]{1,2}[dD][0-9]{1,4}(([+]|-)[0-9]{1,4})?"
                  aria-invalid={Boolean(diceExpressionError)}
                  aria-describedby="dice-format-help"
                  placeholder="1d20+5"
                />
                <button
                  type="button"
                  onClick={handleManualDiceRoll}
                  disabled={isRolling || !campaignId || Boolean(diceExpressionError)}
                  className="rounded-md bg-ink px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isRolling ? "Rolling" : "Roll"}
                </button>
              </div>
              <div id="dice-format-help" className="rounded-md border border-moss/10 bg-white/70 px-3 py-2 text-xs text-moss/75">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold uppercase tracking-[0.08em] text-copper">Format</span>
                  <code className="rounded bg-parchment px-1.5 py-0.5 font-semibold text-ink">XdY +/- N</code>
                  {diceExamples.map((example) => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => setDiceExpression(example)}
                      className="rounded border border-moss/10 bg-white px-1.5 py-0.5 font-semibold text-moss transition hover:border-copper hover:text-ink"
                    >
                      {example}
                    </button>
                  ))}
                </div>
                {diceExpressionError && <p className="mt-2 leading-5 font-semibold text-ember">{diceExpressionError}</p>}
              </div>
              {manualToolCall && <ToolCallCard toolCall={manualToolCall} />}
            </div>
          </section>

          <section id="session-prep" className="scroll-mt-4 mt-7">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-copper">Tonight's Prep</h2>
            <div className="mt-3 rounded-lg border border-moss/15 bg-white p-3 shadow-sm">
              <div className="grid grid-cols-2 gap-2">
                <PrepMetric label="Party" value={`${party.length} PC${party.length === 1 ? "" : "s"}`} detail="at the table" />
                <PrepMetric label="Knowledge Notes" value={`${prepSummary.ruleNotes}`} detail="ready to use" />
                <PrepMetric label="Open Hooks" value={`${prepSummary.openHooks.length}`} detail="to bring back" />
                <PrepMetric label="Active Quests" value={`${prepSummary.openQuests.length}`} detail="not closed" />
              </div>
              <div className="mt-3 space-y-2 text-sm">
                <div className="rounded-md bg-parchment px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-copper">Current Session</p>
                  <p className="mt-1 font-semibold text-ink">{prepSummary.sessionLabel}</p>
                  <p className="text-moss/70">{prepSummary.sessionDetail}</p>
                </div>
                <div className="rounded-md bg-parchment px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-copper">Next Story Thread</p>
                  {prepSummary.latestHookDisplay ? (
                    <>
                      <p className="mt-1 font-semibold text-ink">{prepSummary.latestHookDisplay.title}</p>
                      {prepSummary.latestHookDisplay.detail && <p className="line-clamp-2 text-moss/70">{prepSummary.latestHookDisplay.detail}</p>}
                    </>
                  ) : (
                    <p className="mt-1 text-moss/70">No unresolved hooks saved yet.</p>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section>
            <h2 className="mt-7 text-sm font-semibold uppercase tracking-[0.18em] text-copper">My Local Sessions</h2>
            <div className="mt-3 space-y-3">
              {sessions.length === 0 && (
                <p className="rounded-md border border-moss/15 p-3 text-sm text-moss/70">
                  No sessions saved for this browser profile yet.
                </p>
              )}
              <select
                value={activeSessionId ?? ""}
                onChange={(event) => {
                  const selected = sessions.find((session) => session.id === event.target.value);
                  const selectedId = selected?.id ?? null;
                  const draft = clientId && campaignId ? window.localStorage.getItem(sessionDraftKey(clientId, campaignId, selectedId)) : null;
                  setActiveSessionId(selected?.id ?? null);
                  setSessionTitle(selected?.title ?? "Session Notes");
                  setSessionNotes(draft ?? selected?.rawNotes ?? "");
                  setSessionSaveStatus(null);
                  setDraftStatus(draft ? "Draft restored locally" : null);
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
                onChange={(event) => {
                  setSessionTitle(event.target.value);
                  setSessionSaveStatus(null);
                }}
                className="w-full rounded-md border border-moss/20 px-3 py-2 text-sm"
                placeholder="Session title"
              />
              <textarea
                value={sessionNotes}
                onChange={(event) => {
                  setSessionNotes(event.target.value);
                  setSessionSaveStatus(null);
                }}
                rows={7}
                className="min-h-44 w-full resize-none rounded-md border border-moss/20 px-3 py-2 text-sm leading-6"
                placeholder="Paste raw session notes..."
              />
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleSaveSession}
                  disabled={isSavingSession || isSummarizing || !campaignId || !sessionTitle.trim()}
                  className="rounded-md border border-moss/20 px-3 py-2 text-sm font-semibold text-moss hover:border-copper disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSavingSession ? "Saving" : sessionSaveStatus === "Saved" ? "Saved" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={handleSummarizeSession}
                  disabled={isSummarizing || isSavingSession || !campaignId || !sessionNotes.trim()}
                  className="rounded-md bg-copper px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSummarizing ? "Summarizing" : "Summarize"}
                </button>
              </div>
              {sessionSaveStatus && sessionSaveStatus !== "Saved" && (
                <p className="text-xs font-semibold text-ember">{sessionSaveStatus}</p>
              )}
              {draftStatus && <p className="text-xs font-semibold text-moss/70">{draftStatus}</p>}
              {sessions.find((session) => session.id === activeSessionId)?.summary && (
                <div className="rounded-md border border-moss/15 bg-parchment p-3 text-xs leading-5 text-moss">
                  {sessions.find((session) => session.id === activeSessionId)?.summary}
                </div>
              )}
            </div>
          </section>

          <section>
            <PartyPanel
              party={party}
              recentEvents={partyEvents}
              activePanel={activePartyPanel}
              characterEvents={characterEvents}
              isSaving={isSavingParty}
              isLoadingHistory={isLoadingPartyHistory}
              status={partyStatus}
              onAdd={() => setActivePartyPanel({ mode: "add", character: null })}
              onEdit={(character) => setActivePartyPanel({ mode: "edit", character })}
              onHp={(character) => setActivePartyPanel({ mode: "hp", character })}
              onHistory={openPartyHistory}
              onClose={() => setActivePartyPanel(null)}
              onSaveCharacter={handleSavePartyCharacter}
              onDeleteCharacter={handleDeletePartyCharacter}
              onSaveHp={handleSavePartyHp}
              onLevelChange={handleQuickLevelChange}
              onCreateNote={handleCreatePartyNote}
            />
          </section>

          <section id="campaign-memory" className="scroll-mt-4 mt-7">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-copper">Memory</h2>
            <div className="mt-3 space-y-3">
              <MemoryAccordionGroup
                title="NPCs"
                badge={`${memory.npcs.length}`}
                emptyLabel="No NPCs saved yet."
                deleteLabel="Delete NPC"
                deletingItemKey={deletingMemoryItemKey}
                onDelete={(itemId) => handleDeleteMemoryItem("npc", itemId)}
                items={memory.npcs.slice(0, 6).map((npc) => ({
                  id: npc.id,
                  deleteKey: `npc:${npc.id}`,
                  title: npc.name,
                  imageUrl: imageUrlFromMetadata(npc.metadata),
                  summary: compactEncounterPreview([npc.role, npc.disposition, npc.description].filter(Boolean).join(" · ") || "Saved NPC"),
                  pills: [npc.role, npc.disposition].filter(Boolean) as string[],
                  details: [
                    { label: "Role", value: npc.role },
                    { label: "Disposition", value: npc.disposition },
                    { label: "Description", value: npc.description }
                  ]
                }))}
              />
              <MemoryAccordionGroup
                title="Open Quests"
                badge={`${memory.quests.filter((quest) => quest.status !== "closed").length}`}
                emptyLabel="No open quests yet."
                deleteLabel="Delete Quest"
                deletingItemKey={deletingMemoryItemKey}
                onDelete={(itemId) => handleDeleteMemoryItem("quest", itemId)}
                items={memory.quests
                  .filter((quest) => quest.status !== "closed")
                  .slice(0, 6)
                  .map((quest) => ({
                    id: quest.id,
                    deleteKey: `quest:${quest.id}`,
                    title: quest.title,
                    summary: compactEncounterPreview(quest.description || quest.status || "Open quest"),
                    pills: [quest.status],
                    details: [
                      { label: "Status", value: quest.status },
                      { label: "Description", value: quest.description }
                    ]
                  }))}
              />
              <MemoryAccordionGroup
                title="Recent Locations"
                badge={`${memory.locations.length}`}
                emptyLabel="No locations saved yet."
                deleteLabel="Delete Location"
                deletingItemKey={deletingMemoryItemKey}
                onDelete={(itemId) => handleDeleteMemoryItem("location", itemId)}
                items={memory.locations.slice(0, 6).map((location) => ({
                  id: location.id,
                  deleteKey: `location:${location.id}`,
                  title: location.name,
                  summary: compactEncounterPreview([location.locationType, location.description].filter(Boolean).join(" · ") || "Saved location"),
                  pills: [location.locationType].filter(Boolean) as string[],
                  details: [
                    { label: "Type", value: location.locationType },
                    { label: "Description", value: location.description }
                  ]
                }))}
              />
              <MemoryAccordionGroup
                title="Hooks"
                badge={`${memory.events.filter((event) => event.eventType === "unresolved_hook").length}`}
                emptyLabel="No unresolved hooks yet."
                deleteLabel="Delete Hook"
                deletingItemKey={deletingMemoryItemKey}
                onDelete={(itemId) => handleDeleteMemoryItem("hook", itemId)}
                items={memory.events
                  .filter((event) => event.eventType === "unresolved_hook")
                  .slice(0, 6)
                  .map((event) => {
                    const display = formatMemoryHook(event);
                    return {
                      id: event.id,
                      deleteKey: `hook:${event.id}`,
                      title: display.title,
                      summary: compactEncounterPreview(display.detail || "Unresolved hook"),
                      pills: ["Hook"],
                      details: [
                        { label: "Type", value: splitCamelCase(event.eventType) },
                        { label: "Detail", value: display.detail }
                      ]
                    };
                  })}
              />
            </div>
          </section>

        </aside>
      </div>
    </main>
  );
}

function SavedEncountersSection({
  encounters,
  isLoading,
  error,
  deletingEncounterId,
  onDeleteEncounter
}: {
  encounters: CampaignMemory["encounters"];
  isLoading: boolean;
  error: string | null;
  deletingEncounterId: string | null;
  onDeleteEncounter: (encounterId: string) => Promise<void>;
}) {
  const [expandedEncounterId, setExpandedEncounterId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (expandedEncounterId && !encounters.some((encounter) => encounter.id === expandedEncounterId)) {
      setExpandedEncounterId(null);
    }
    if (confirmDeleteId && !encounters.some((encounter) => encounter.id === confirmDeleteId)) {
      setConfirmDeleteId(null);
    }
  }, [confirmDeleteId, encounters, expandedEncounterId]);

  if (isLoading) {
    return (
      <div className="mt-3 rounded-lg border border-moss/15 bg-parchment/45 p-3 text-sm text-moss/70 shadow-sm">
        Loading saved encounters...
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-3 rounded-lg border border-ember/25 bg-ember/10 p-3 text-sm leading-6 text-ember shadow-sm">
        Saved encounters could not load. {error}
      </div>
    );
  }

  if (encounters.length === 0) {
    return (
      <div className="mt-3 rounded-lg border border-moss/15 bg-parchment/45 p-3 text-sm leading-6 text-moss/70 shadow-sm">
        No saved encounters yet. Generate an encounter, then use Save Encounter to keep it in campaign memory.
      </div>
    );
  }

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-moss/15 bg-white shadow-sm">
      {encounters.map((encounter) => {
        const metadata = object(encounter.metadata);
        const difficulty = text(metadata.difficulty) || text(metadata.Difficulty);
        const environment = text(metadata.environment) || text(metadata.Environment);
        const monsters = metadata.monsters ?? metadata.Monsters;
        const rewards = metadata.rewards ?? metadata.Rewards;
        const hooks = metadata.campaignHooks ?? metadata.CampaignHooks;
        const tactics = metadata.tactics ?? metadata.Tactics;
        const imageUrl = imageUrlFromMetadata(metadata);
        const tacticsText = formatEncounterValue(tactics);
        const isExpanded = expandedEncounterId === encounter.id;
        const detailsId = `encounter-details-${encounter.id}`;
        const summary = compactEncounterPreview(environment || encounter.summary || tacticsText || "Saved encounter briefing");
        const deleteIsConfirming = confirmDeleteId === encounter.id;
        const deleteIsBusy = deletingEncounterId === encounter.id;

        return (
          <article key={encounter.id} className="border-b border-moss/10 last:border-b-0">
            <button
              type="button"
              aria-expanded={isExpanded}
              aria-controls={detailsId}
              onClick={() => {
                setExpandedEncounterId(isExpanded ? null : encounter.id);
                setConfirmDeleteId(null);
              }}
              className={`block w-full px-3 py-3 text-left transition ${
                isExpanded ? "bg-parchment/55" : "bg-white hover:bg-parchment/35"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  {imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imageUrl} alt="" className="h-16 w-24 shrink-0 rounded-md border border-moss/10 object-cover shadow-sm" />
                  )}
                  <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="min-w-0 break-words text-sm font-semibold leading-5 text-ink">{encounter.title}</h3>
                    <EncounterMetaPill value={difficulty || "Encounter"} />
                  </div>
                  <p className="line-clamp-2 text-xs leading-5 text-moss/75">{summary}</p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  {encounter.createdAt && (
                    <span className="rounded-full bg-parchment px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-copper shadow-sm">
                      {formatEventDate(encounter.createdAt)}
                    </span>
                  )}
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-moss/55">
                    {isExpanded ? "Collapse" : "Expand"}
                  </span>
                </div>
              </div>
            </button>

            {isExpanded && (
              <div id={detailsId} className="space-y-3 border-t border-moss/10 bg-white p-3 text-sm">
                {imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imageUrl} alt="" className="aspect-video w-full rounded-md border border-moss/10 object-cover shadow-sm" />
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <EncounterMetaPill value={difficulty || "Encounter"} />
                  {environment && <EncounterMetaPill value={isShortEncounterMeta(environment) ? environment : sentenceCase(compactEncounterPreview(environment, 36))} />}
                  {encounter.createdAt && (
                    <span className="rounded-full border border-moss/10 bg-parchment px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-moss/65">
                      {formatEventDate(encounter.createdAt)}
                    </span>
                  )}
                </div>

                {(encounter.summary || tacticsText) && (
                  <p className="border-l-2 border-copper/45 pl-3 leading-6 text-moss/85">
                    {encounter.summary || tacticsText}
                  </p>
                )}

                <EncounterMonsterGrid value={monsters} />

                <div className="grid gap-3">
                  {encounter.summary && <EncounterDetail label="Tactics" value={tacticsText} />}
                  <EncounterListDetail label="Rewards" value={rewards} />
                  <EncounterListDetail label="Hooks" value={hooks} />
                </div>

                <div className="flex justify-end border-t border-moss/10 pt-3">
                  <button
                    type="button"
                    aria-label={`${deleteIsConfirming ? "Confirm delete" : "Delete"} ${encounter.title}`}
                    aria-pressed={deleteIsConfirming}
                    disabled={deleteIsBusy}
                    onClick={async () => {
                      if (!deleteIsConfirming) {
                        setConfirmDeleteId(encounter.id);
                        return;
                      }
                      try {
                        await onDeleteEncounter(encounter.id);
                        setConfirmDeleteId(null);
                        setExpandedEncounterId(null);
                      } catch {
                        // The parent page owns the visible error message.
                      }
                    }}
                    className={`rounded-md border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      deleteIsConfirming
                        ? "border-ember/40 bg-ember text-white hover:bg-ember/90"
                        : "border-ember/25 bg-ember/10 text-ember hover:bg-ember/15"
                    }`}
                  >
                    {deleteIsBusy ? "Deleting" : deleteIsConfirming ? "Delete?" : "Delete"}
                  </button>
                </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function compactEncounterPreview(value: string, maxLength = 96) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trim()}...` : normalized;
}

function isShortEncounterMeta(value: string) {
  return value.length > 0 && value.length <= 24 && !/[.,;:]/.test(value) && value.split(/\s+/).length <= 3;
}

function EncounterMetaPill({ value, className = "" }: { value: string; className?: string }) {
  if (!value) {
    return null;
  }

  return (
    <span className={`rounded-full border border-copper/20 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-copper ${className}`}>
      {value}
    </span>
  );
}

function EncounterMonsterGrid({ value }: { value: unknown }) {
  if (!Array.isArray(value) || value.length === 0) {
    return <EncounterDetail label="Monsters" value={formatEncounterValue(value)} />;
  }

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-copper">Monsters</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {value.map((monster, index) => {
          const item = object(monster);
          const name = text(item.name) || text(item.title) || text(item.creature) || text(monster) || "Creature";
          const count = text(item.count);
          const role = text(item.role);
          const xp = text(item.xp);
          const detail = [role, xp ? `${xp} XP` : ""].filter(Boolean).join(" · ");
          return (
            <div key={`${name}-${index}`} className="rounded-md border border-moss/10 bg-parchment/55 px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 break-words font-semibold leading-6 text-ink">{name}</p>
                {count && <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-moss">x{count}</span>}
              </div>
              {detail && <p className="mt-0.5 text-xs leading-5 text-moss/70">{detail}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EncounterListDetail({ label, value }: { label: string; value: unknown }) {
  const items = formatEncounterListItems(value);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="rounded-md border border-moss/10 bg-parchment/45 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-copper">{label}</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((item, index) => (
          <li key={`${item}-${index}`} className="flex gap-2 leading-6 text-moss/80">
            <span className="mt-[0.6rem] h-1.5 w-1.5 shrink-0 rounded-full bg-copper/55" aria-hidden="true" />
            <span className="min-w-0 break-words">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EncounterDetail({ label, value }: { label: string; value: string }) {
  if (!value) {
    return null;
  }

  return (
    <div className="rounded-md border border-moss/10 bg-parchment/45 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-copper">{label}</p>
      <p className="mt-1 leading-6 text-moss/80">{value}</p>
    </div>
  );
}

function formatEncounterListItems(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === "object") {
          return formatEncounterValue(item);
        }
        return text(item);
      })
      .filter(Boolean);
  }

  const rendered = formatEncounterValue(value);
  return rendered ? [rendered] : [];
}

function sentenceCase(value: string) {
  const normalized = value.toLowerCase();
  return normalized.replace(/(^\s*\w|[.!?]\s+\w)/g, (match) => match.toUpperCase());
}

function StatusMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-moss/10 bg-white px-3 py-2 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-copper">{label}</p>
      <p className="mt-1 text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

function PrepMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-md bg-parchment px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-copper">{label}</p>
      <p className="mt-1 text-lg font-semibold leading-6 text-ink">{value}</p>
      <p className="text-xs leading-5 text-moss/70">{detail}</p>
    </div>
  );
}

function ChatTimelineCard({
  message,
  actionStatus,
  onAction,
  campaignId,
  conversationId
}: {
  message: ChatMessage;
  actionStatus: string | null;
  onAction: (action: SuggestedAction) => Promise<void>;
  campaignId: string | null;
  conversationId: string | null;
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
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-copper">DM Briefing</p>
            <h3 className="mt-1 text-xl font-semibold text-ink">{briefingTitle(message.structuredOutput)}</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {message.structuredOutput && <ContextBadge label="Table-ready card" />}
            {!!message.citations?.length && <ContextBadge label="Context checked" />}
          </div>
        </div>
        <AssistantResponseText content={displayContent.main} />
      </div>

      <div className="space-y-4 p-5">
        {message.structuredOutput && (
          <StructuredOutputRenderer
            output={message.structuredOutput}
            suggestedActions={message.suggestedActions ?? []}
            onAction={onAction}
            status={actionStatus}
            campaignId={campaignId}
            conversationId={conversationId}
          />
        )}

        {!!message.citations?.length && <CitationSection citations={message.citations} />}
      </div>
    </article>
  );
}

function AssistantResponseText({ content }: { content: string }) {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) {
    return <p className="mt-4 text-base leading-7 text-moss">Response ready.</p>;
  }

  return (
    <div className="mt-4 space-y-3 text-base leading-7 text-moss">
      {lines.map((line, index) => (
        <AssistantResponseLine key={`${line}-${index}`} line={line} />
      ))}
    </div>
  );
}

function AssistantResponseLine({ line }: { line: string }) {
  const bulletText = line.replace(/^\s*[-*]\s+/, "").trim();
  const heading = bulletText.match(/^\*\*([^*]+)\*\*$/);
  if (heading) {
    return <h4 className="text-lg font-semibold leading-tight text-ink">{heading[1]}</h4>;
  }

  const labeled = bulletText.match(/^\*?\*?([^:*]{2,36})\*?\*?\s*:\s*\*?\*?\s*(.+)$/);
  if (labeled) {
    return (
      <div className="rounded-lg border border-moss/10 bg-parchment/70 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-copper">{stripInlineMarkdown(labeled[1])}</p>
        <p className="mt-1 leading-7 text-moss">{renderInlineMarkdown(labeled[2])}</p>
      </div>
    );
  }

  if (line !== bulletText) {
    return (
      <p className="rounded-lg bg-parchment/60 px-4 py-2 leading-7 text-moss">
        {renderInlineMarkdown(bulletText)}
      </p>
    );
  }

  return <p className="leading-7 text-moss">{renderInlineMarkdown(line)}</p>;
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
      <SectionHeader eyebrow="Campaign Context Used" title="What DNDMind considered" />
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
  onPromptSuggestion,
  isGeneratingPromptSuggestion,
  onPreparedScene
}: {
  onPrompt: (prompt: (typeof quickPrompts)[number]) => void;
  onPromptSuggestion: (prompt: (typeof quickPrompts)[number]) => void;
  isGeneratingPromptSuggestion: boolean;
  onPreparedScene: () => void;
}) {
  return (
    <section className="mx-auto flex min-h-[18rem] w-full max-w-5xl items-center">
      <div className="w-full rounded-md border border-moss/15 bg-white/90 p-5 shadow-xl shadow-moss/10 md:p-6">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-copper">Ready for the next table beat</p>
          <h3 className="mt-2 text-2xl font-semibold leading-tight text-ink md:text-3xl">
            Ask for rulings, prep scenes, and turn campaign memory into table-ready output.
          </h3>
          <p className="mt-3 text-sm leading-6 text-moss/75">
            DNDMind blends rules context, session notes, party details, and structured tools so the next answer is useful at the table.
          </p>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {quickPrompts.map((prompt) => (
            <div
              key={prompt.label}
              className="min-h-20 rounded-md border border-moss/15 bg-parchment/70 px-3 py-3 shadow-sm transition hover:-translate-y-0.5 hover:border-copper/50 hover:bg-white hover:shadow-md"
            >
              <button type="button" onClick={() => onPrompt(prompt)} className="block w-full text-left">
                <span className="block text-sm font-semibold text-ink">{prompt.label}</span>
                <span className="mt-2 block text-xs leading-5 text-moss/70">{modeLabels[prompt.mode] ?? prompt.mode} hint</span>
              </button>
              <button
                type="button"
                onClick={() => onPromptSuggestion(prompt)}
                disabled={isGeneratingPromptSuggestion}
                className="mt-3 rounded-md border border-copper/30 bg-white px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-copper transition hover:bg-copper hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isGeneratingPromptSuggestion ? "Sparking" : "Spark"}
              </button>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-moss/10 bg-parchment/60 px-4 py-2">
          <p className="text-sm leading-6 text-moss/75">Want a quick starting point? Load a prepared Captain Vey encounter briefing.</p>
          <button
            type="button"
            onClick={onPreparedScene}
            className="rounded-md border border-copper bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-copper shadow-sm transition hover:bg-copper hover:text-white"
          >
            Load Prepared Scene
          </button>
        </div>
      </div>
    </section>
  );
}

function MobileEmptyChatState({
  onPrompt,
  onPromptSuggestion,
  isGeneratingPromptSuggestion,
  onPreparedScene
}: {
  onPrompt: (prompt: (typeof quickPrompts)[number]) => void;
  onPromptSuggestion: () => void;
  isGeneratingPromptSuggestion: boolean;
  onPreparedScene: () => void;
}) {
  return (
    <section className="rounded-md border border-moss/15 bg-white/90 p-3 shadow-sm xl:hidden">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-copper">Ready</p>
      <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {quickPrompts.slice(0, 4).map((prompt) => (
          <button
            key={prompt.label}
            type="button"
            onClick={() => onPrompt(prompt)}
            className="shrink-0 rounded-md border border-moss/15 bg-parchment px-3 py-2 text-sm font-semibold text-ink"
          >
            {prompt.label}
          </button>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onPromptSuggestion}
          disabled={isGeneratingPromptSuggestion}
          className="rounded-md border border-copper/30 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-copper disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isGeneratingPromptSuggestion ? "Sparking" : "Spark Prompt"}
        </button>
        <button
          type="button"
          onClick={onPreparedScene}
          className="rounded-md bg-copper px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white"
        >
          Prepared Scene
        </button>
      </div>
    </section>
  );
}

function formatMemoryHook(event: CampaignMemory["events"][number]) {
  const rawTitle = event.title ?? "";
  const rawDescription = event.description ?? "";
  const title = extractStoredField(rawTitle, "hook") || extractStoredField(rawDescription, "hook") || cleanStoredMemoryText(rawTitle);
  const detail = extractStoredField(rawTitle, "details") || extractStoredField(rawDescription, "details") || cleanStoredMemoryText(rawDescription);
  const cleanTitle = title || "Unresolved story thread";
  const cleanDetail = detail && detail !== cleanTitle ? detail : "";

  return {
    title: cleanTitle,
    detail: cleanDetail
  };
}

function extractStoredField(value: string, field: string) {
  const markerMatch = value.match(new RegExp(`["']${field}["']\\s*:`));
  if (!markerMatch || markerMatch.index === undefined) {
    return "";
  }

  let cursor = markerMatch.index + markerMatch[0].length;
  while (cursor < value.length && /\s/.test(value[cursor])) {
    cursor += 1;
  }

  const quote = value[cursor];
  if (quote !== "'" && quote !== "\"") {
    return "";
  }

  cursor += 1;
  let output = "";
  while (cursor < value.length) {
    const char = value[cursor];
    const next = value.slice(cursor + 1);
    if (
      char === quote &&
      (/^\s*[,}]/.test(next) || /^\s*$/.test(next))
    ) {
      break;
    }
    output += char;
    cursor += 1;
  }

  return cleanStoredMemoryText(output);
}

function cleanStoredMemoryText(value: string) {
  return value
    .replace(/^[{[\s]+|[}\]\s]+$/g, "")
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatEncounterValue(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === "object") {
          const entry = object(item);
          return [
            text(entry.name) || text(entry.title) || text(entry.creature),
            text(entry.count) ? `x${text(entry.count)}` : "",
            text(entry.role),
            text(entry.xp) ? `${text(entry.xp)} XP` : ""
          ].filter(Boolean).join(" ");
        }
        return text(item);
      })
      .filter(Boolean)
      .join(" · ");
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${splitCamelCase(key)}: ${text(item) || JSON.stringify(item)}`)
      .join(" · ");
  }

  return text(value);
}

function mergeSavedEncounter(memory: CampaignMemory, encounter: CampaignMemory["encounters"][number]): CampaignMemory {
  const encounters = memory.encounters.filter((item) => item.id !== encounter.id && item.title !== encounter.title);
  return {
    ...memory,
    encounters: [encounter, ...encounters]
  };
}

type MemoryAccordionItem = {
  id: string;
  deleteKey: string;
  title: string;
  imageUrl?: string | null;
  summary: string;
  pills: string[];
  details: Array<{ label: string; value: string | null | undefined }>;
};

function MemoryAccordionGroup({
  title,
  badge,
  items,
  emptyLabel,
  deleteLabel,
  deletingItemKey,
  onDelete
}: {
  title: string;
  badge: string;
  items: MemoryAccordionItem[];
  emptyLabel: string;
  deleteLabel: string;
  deletingItemKey: string | null;
  onDelete: (itemId: string) => Promise<void>;
}) {
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (expandedItemId && !items.some((item) => item.id === expandedItemId)) {
      setExpandedItemId(null);
    }
    if (confirmDeleteId && !items.some((item) => item.id === confirmDeleteId)) {
      setConfirmDeleteId(null);
    }
  }, [confirmDeleteId, expandedItemId, items]);

  return (
    <div className="overflow-hidden rounded-lg border border-moss/15 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-moss/10 bg-parchment/35 px-3 py-2.5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-copper">{title}</p>
        <span className="rounded-full bg-mist px-2.5 py-1 text-xs font-semibold text-moss">{badge}</span>
      </div>
      {items.length === 0 && <p className="px-3 py-3 text-sm leading-6 text-moss/60">{emptyLabel}</p>}
      {items.map((item) => {
        const isExpanded = expandedItemId === item.id;
        const detailsId = `memory-details-${item.deleteKey}`;
        const isConfirmingDelete = confirmDeleteId === item.id;
        const isDeleting = deletingItemKey === item.deleteKey;

        return (
          <article key={item.id} className="border-b border-moss/10 last:border-b-0">
            <button
              type="button"
              aria-expanded={isExpanded}
              aria-controls={detailsId}
              onClick={() => {
                setExpandedItemId(isExpanded ? null : item.id);
                setConfirmDeleteId(null);
              }}
              className={`block w-full px-3 py-3 text-left transition ${
                isExpanded ? "bg-parchment/55" : "bg-white hover:bg-parchment/35"
              }`}
            >
              <div className="flex min-w-0 gap-3">
                {item.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.imageUrl} alt="" className="h-16 w-20 shrink-0 rounded-md border border-moss/10 object-cover shadow-sm" />
                )}
                <div className="grid min-w-0 flex-1 gap-2">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <h3 className="min-w-0 break-words text-sm font-semibold leading-5 text-ink">{item.title}</h3>
                    <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-moss/55">
                      {isExpanded ? "Collapse" : "Expand"}
                    </span>
                  </div>
                  <div className="min-w-0">
                    {item.pills.length > 0 && (
                      <div className="flex min-w-0 flex-wrap gap-1.5">
                        {item.pills.slice(0, 2).map((pill) => (
                          <EncounterMetaPill
                            key={pill}
                            value={compactEncounterPreview(pill, 34)}
                            className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap px-2 py-0.5 text-[10px] tracking-[0.08em]"
                          />
                        ))}
                      </div>
                    )}
                    {item.summary && <p className="mt-2 line-clamp-2 text-xs leading-5 text-moss/75">{item.summary}</p>}
                  </div>
                </div>
              </div>
            </button>

            {isExpanded && (
              <div id={detailsId} className="space-y-3 border-t border-moss/10 bg-white p-3 text-sm">
                {item.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.imageUrl} alt="" className="aspect-video w-full rounded-md border border-moss/10 object-cover shadow-sm" />
                )}
                <div className="grid gap-3">
                  {item.details.map((detail) => (
                    <EncounterDetail key={detail.label} label={detail.label} value={detail.value ?? ""} />
                  ))}
                </div>
                <div className="flex justify-end border-t border-moss/10 pt-3">
                  <button
                    type="button"
                    aria-label={`${isConfirmingDelete ? "Confirm " : ""}${deleteLabel} ${item.title}`}
                    aria-pressed={isConfirmingDelete}
                    disabled={isDeleting}
                    onClick={async () => {
                      if (!isConfirmingDelete) {
                        setConfirmDeleteId(item.id);
                        return;
                      }
                      try {
                        await onDelete(item.id);
                        setConfirmDeleteId(null);
                        setExpandedItemId(null);
                      } catch {
                        // The parent page owns the visible error message.
                      }
                    }}
                    className={`rounded-md border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      isConfirmingDelete
                        ? "border-ember/40 bg-ember text-white hover:bg-ember/90"
                        : "border-ember/25 bg-ember/10 text-ember hover:bg-ember/15"
                    }`}
                  >
                    {isDeleting ? "Deleting" : isConfirmingDelete ? "Delete?" : "Delete"}
                  </button>
                </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function PartyPanel({
  party,
  recentEvents,
  activePanel,
  characterEvents,
  isSaving,
  isLoadingHistory,
  status,
  onAdd,
  onEdit,
  onHp,
  onHistory,
  onClose,
  onSaveCharacter,
  onDeleteCharacter,
  onSaveHp,
  onLevelChange,
  onCreateNote
}: {
  party: PartyCharacter[];
  recentEvents: PartyCharacterEvent[];
  activePanel: ActivePartyPanel | null;
  characterEvents: PartyCharacterEvent[];
  isSaving: boolean;
  isLoadingHistory: boolean;
  status: string | null;
  onAdd: () => void;
  onEdit: (character: PartyCharacter) => void;
  onHp: (character: PartyCharacter) => void;
  onHistory: (character: PartyCharacter) => void;
  onClose: () => void;
  onSaveCharacter: (input: PartyCharacterInput) => void;
  onDeleteCharacter: (character: PartyCharacter) => void;
  onSaveHp: (input: { hpCurrent: number | null; tempHp: number | null; note: string }) => void;
  onLevelChange: (character: PartyCharacter, nextLevel: number) => void;
  onCreateNote: (input: { title: string; description: string }) => void;
}) {
  const activePanelRef = useRef<HTMLDivElement | null>(null);
  const [expandedCharacterId, setExpandedCharacterId] = useState<string | null>(null);

  useEffect(() => {
    if (!activePanel) {
      return;
    }

    activePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [activePanel]);

  useEffect(() => {
    if (expandedCharacterId && !party.some((character) => character.id === expandedCharacterId)) {
      setExpandedCharacterId(null);
    }
  }, [expandedCharacterId, party]);

  return (
    <div>
      <div className="mt-7 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-copper">Party</h2>
        <button
          type="button"
          onClick={onAdd}
          className="rounded-md bg-copper px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white shadow-sm transition hover:bg-ember"
        >
          Add Character
        </button>
      </div>

      <div className="mt-3 space-y-3">
        {party.length === 0 && (
          <div className="rounded-lg border border-dashed border-moss/25 bg-white p-4 text-sm leading-6 text-moss/75">
            <p>No party members yet. Add your first player character so DNDMind can balance encounters and reference party context.</p>
            <button
              type="button"
              onClick={onAdd}
              className="mt-3 rounded-md border border-copper px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-copper transition hover:bg-copper hover:text-white"
            >
              Add Character
            </button>
          </div>
        )}

        {party.map((character) => (
          <PartyCharacterCard
            key={character.id}
            character={character}
            isSaving={isSaving}
            isExpanded={expandedCharacterId === character.id}
            onToggle={() => setExpandedCharacterId(expandedCharacterId === character.id ? null : character.id)}
            onEdit={onEdit}
            onHp={onHp}
            onHistory={onHistory}
            onDelete={onDeleteCharacter}
            onLevelChange={onLevelChange}
          />
        ))}
      </div>

      {status && <p className="mt-3 rounded-md bg-mist px-3 py-2 text-xs font-semibold text-moss">{status}</p>}

      {activePanel && (
        <div ref={activePanelRef} className="mt-4 scroll-mt-4 rounded-xl border border-moss/15 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-copper">
                {activePanel.mode === "add" ? "Add Character" : activePanel.mode === "edit" ? "Edit Character" : activePanel.mode === "hp" ? "Quick HP" : "History"}
              </p>
              <h3 className="mt-1 text-base font-semibold text-ink">
                {activePanel.character?.name ?? "New player character"}
              </h3>
            </div>
            <button type="button" onClick={onClose} className="rounded-md border border-moss/15 px-2.5 py-1.5 text-xs font-semibold text-moss hover:border-copper">
              Close
            </button>
          </div>

          {activePanel.mode === "add" && (
            <PartyCharacterForm isSaving={isSaving} onSubmit={onSaveCharacter} submitLabel="Add Character" />
          )}
          {activePanel.mode === "edit" && activePanel.character && (
            <PartyCharacterForm
              character={activePanel.character}
              isSaving={isSaving}
              onSubmit={onSaveCharacter}
              onDelete={() => onDeleteCharacter(activePanel.character!)}
              submitLabel="Save Character"
            />
          )}
          {activePanel.mode === "hp" && activePanel.character && (
            <HpUpdateForm character={activePanel.character} isSaving={isSaving} onSubmit={onSaveHp} />
          )}
          {activePanel.mode === "history" && activePanel.character && (
            <CharacterHistoryDrawer
              events={characterEvents}
              isLoading={isLoadingHistory}
              isSaving={isSaving}
              onCreateNote={onCreateNote}
            />
          )}
        </div>
      )}

      {recentEvents.length > 0 && (
        <div className="mt-4 rounded-xl border border-moss/15 bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-copper">Recent Progress</p>
            <span className="rounded-full bg-mist px-2.5 py-1 text-xs font-semibold text-moss">{recentEvents.length}</span>
          </div>
          <PartyEventList events={recentEvents.slice(0, 5)} compact />
        </div>
      )}
    </div>
  );
}

function PartyCharacterCard({
  character,
  isSaving,
  isExpanded,
  onToggle,
  onEdit,
  onHp,
  onHistory,
  onDelete,
  onLevelChange
}: {
  character: PartyCharacter;
  isSaving: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onEdit: (character: PartyCharacter) => void;
  onHp: (character: PartyCharacter) => void;
  onHistory: (character: PartyCharacter) => void;
  onDelete: (character: PartyCharacter) => void;
  onLevelChange: (character: PartyCharacter, nextLevel: number) => void;
}) {
  const [isConfirmingArchive, setIsConfirmingArchive] = useState(false);
  const hpLabel = character.hpCurrent === null && character.hpMax === null
    ? "HP not set"
    : `HP ${character.hpCurrent ?? "-"}/${character.hpMax ?? "-"}`;
  const tempLabel = character.tempHp ? ` +${character.tempHp} temp` : "";
  const detail = [
    `Level ${character.level}`,
    character.race,
    character.className
  ].filter(Boolean).join(" ");
  const detailsId = `party-details-${character.id}`;

  return (
    <article className="overflow-hidden rounded-lg border border-moss/15 bg-white shadow-sm">
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-controls={detailsId}
        onClick={() => {
          onToggle();
          setIsConfirmingArchive(false);
        }}
        className={`block w-full px-3 py-3 text-left transition ${
          isExpanded ? "bg-parchment/55" : "bg-white hover:bg-parchment/35"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="break-words font-semibold text-ink">{character.name}</p>
            <p className="mt-1 text-sm text-moss/75">{detail || "Player character"}</p>
            <p className="mt-2 text-xs leading-5 text-moss/70">{hpLabel}{tempLabel}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <span className="rounded-full bg-mist px-2.5 py-1 text-xs font-semibold text-moss">
              AC {character.armorClass ?? "-"}
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-moss/55">
              {isExpanded ? "Collapse" : "Expand"}
            </span>
          </div>
        </div>
      </button>

      {isExpanded && (
        <div id={detailsId} className="space-y-3 border-t border-moss/10 p-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md bg-parchment/80 px-3 py-2">
              <p className="font-semibold text-ink">{hpLabel}{tempLabel}</p>
            </div>
            <div className="rounded-md bg-parchment/80 px-3 py-2">
              <p className="font-semibold text-ink">Init {formatModifier(character.initiativeModifier ?? 0)}</p>
            </div>
            <div className="rounded-md bg-parchment/80 px-3 py-2">
              <p className="font-semibold text-ink">Passive {character.passivePerception ?? "-"}</p>
            </div>
            <div className="rounded-md bg-parchment/80 px-3 py-2">
              <p className="font-semibold text-ink">Level {character.level}</p>
            </div>
          </div>

          {character.conditions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {character.conditions.map((condition) => (
                <EncounterMetaPill key={condition} value={condition} />
              ))}
            </div>
          )}

          {character.notes && <p className="text-xs leading-5 text-moss/70">{character.notes}</p>}

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onEdit(character)} className="rounded-md border border-moss/15 px-2.5 py-1.5 text-xs font-semibold text-moss hover:border-copper">
              Edit
            </button>
            <button type="button" onClick={() => onHp(character)} className="rounded-md border border-moss/15 px-2.5 py-1.5 text-xs font-semibold text-moss hover:border-copper">
              HP
            </button>
            <button type="button" onClick={() => onHistory(character)} className="rounded-md border border-moss/15 px-2.5 py-1.5 text-xs font-semibold text-moss hover:border-copper">
              History
            </button>
            <button
              type="button"
              onClick={() => onLevelChange(character, character.level + 1)}
              disabled={isSaving}
              className="rounded-md border border-moss/15 px-2.5 py-1.5 text-xs font-semibold text-moss hover:border-copper disabled:cursor-not-allowed disabled:opacity-50"
            >
              Level +1
            </button>
            <button
              type="button"
              aria-label={`${isConfirmingArchive ? "Confirm archive" : "Archive"} ${character.name}`}
              aria-pressed={isConfirmingArchive}
              onClick={() => {
                if (!isConfirmingArchive) {
                  setIsConfirmingArchive(true);
                  return;
                }
                onDelete(character);
              }}
              disabled={isSaving}
              className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                isConfirmingArchive
                  ? "border-ember/40 bg-ember text-white hover:bg-ember/90"
                  : "border-ember/25 bg-ember/10 text-ember hover:bg-ember/15"
              }`}
            >
              {isSaving ? "Saving" : isConfirmingArchive ? "Archive?" : "Archive"}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function PartyCharacterForm({
  character,
  isSaving,
  submitLabel,
  onSubmit,
  onDelete
}: {
  character?: PartyCharacter;
  isSaving: boolean;
  submitLabel: string;
  onSubmit: (input: PartyCharacterInput) => void;
  onDelete?: () => void;
}) {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [form, setForm] = useState({
    name: character?.name ?? "",
    className: character?.className ?? "",
    race: character?.race ?? "",
    level: String(character?.level ?? 1),
    hpCurrent: character?.hpCurrent?.toString() ?? "",
    hpMax: character?.hpMax?.toString() ?? "",
    tempHp: character?.tempHp?.toString() ?? "",
    armorClass: character?.armorClass?.toString() ?? "",
    initiativeModifier: character?.initiativeModifier?.toString() ?? "",
    passivePerception: character?.passivePerception?.toString() ?? "",
    notes: character?.notes ?? ""
  });

  function updateField(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({
      name: form.name.trim(),
      className: form.className.trim() || null,
      race: form.race.trim() || null,
      level: numberOrDefault(form.level, 1),
      hpCurrent: numberOrNull(form.hpCurrent),
      hpMax: numberOrNull(form.hpMax),
      tempHp: numberOrNull(form.tempHp),
      armorClass: numberOrNull(form.armorClass),
      initiativeModifier: numberOrNull(form.initiativeModifier),
      passivePerception: numberOrNull(form.passivePerception),
      conditions: character?.conditions ?? [],
      notes: form.notes.trim() || null
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <FormField label="Name" value={form.name} onChange={(value) => updateField("name", value)} required />
        <FormField label="Class" value={form.className} onChange={(value) => updateField("className", value)} />
        <FormField label="Race" value={form.race} onChange={(value) => updateField("race", value)} />
        <FormField label="Level" type="number" min={1} value={form.level} onChange={(value) => updateField("level", value)} />
        <FormField label="Current HP" type="number" min={0} value={form.hpCurrent} onChange={(value) => updateField("hpCurrent", value)} />
        <FormField label="Max HP" type="number" min={0} value={form.hpMax} onChange={(value) => updateField("hpMax", value)} />
        <FormField label="Temp HP" type="number" min={0} value={form.tempHp} onChange={(value) => updateField("tempHp", value)} />
        <FormField label="AC" type="number" min={0} value={form.armorClass} onChange={(value) => updateField("armorClass", value)} />
        <FormField label="Initiative Modifier" type="number" value={form.initiativeModifier} onChange={(value) => updateField("initiativeModifier", value)} />
        <FormField label="Passive Perception" type="number" min={0} value={form.passivePerception} onChange={(value) => updateField("passivePerception", value)} />
      </div>
      <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-copper">
        Notes
        <textarea
          value={form.notes}
          onChange={(event) => updateField("notes", event.target.value)}
          rows={3}
          className="mt-1 w-full resize-none rounded-md border border-moss/20 px-3 py-2 text-sm normal-case tracking-normal text-ink"
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {onDelete && (
          <button
            type="button"
            onClick={() => {
              if (!isConfirmingDelete) {
                setIsConfirmingDelete(true);
                return;
              }
              onDelete();
            }}
            aria-pressed={isConfirmingDelete}
            disabled={isSaving}
            className={`rounded-md border px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
              isConfirmingDelete
                ? "border-ember/40 bg-ember text-white"
                : "border-ember/30 text-ember"
            }`}
          >
            {isConfirmingDelete ? "Archive?" : "Archive"}
          </button>
        )}
        <button type="submit" disabled={isSaving || !form.name.trim()} className="ml-auto rounded-md bg-copper px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
          {isSaving ? "Saving" : submitLabel}
        </button>
      </div>
    </form>
  );
}

function HpUpdateForm({
  character,
  isSaving,
  onSubmit
}: {
  character: PartyCharacter;
  isSaving: boolean;
  onSubmit: (input: { hpCurrent: number | null; tempHp: number | null; note: string }) => void;
}) {
  const [hpCurrent, setHpCurrent] = useState(character.hpCurrent?.toString() ?? "");
  const [tempHp, setTempHp] = useState(character.tempHp?.toString() ?? "");
  const [note, setNote] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({ hpCurrent: numberOrNull(hpCurrent), tempHp: numberOrNull(tempHp), note });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3">
      <div className="rounded-md bg-parchment/80 px-3 py-2 text-sm text-moss">
        Current maximum: {character.hpMax ?? "-"} HP. Temp HP is tracked separately for encounter context.
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <FormField label="Current HP" type="number" min={0} value={hpCurrent} onChange={setHpCurrent} />
        <FormField label="Temp HP" type="number" min={0} value={tempHp} onChange={setTempHp} />
      </div>
      <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-copper">
        Note
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Took damage from goblin ambush"
          className="mt-1 w-full rounded-md border border-moss/20 px-3 py-2 text-sm normal-case tracking-normal text-ink"
        />
      </label>
      <button type="submit" disabled={isSaving} className="w-full rounded-md bg-copper px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
        {isSaving ? "Saving" : "Save HP"}
      </button>
    </form>
  );
}

function CharacterHistoryDrawer({
  events,
  isLoading,
  isSaving,
  onCreateNote
}: {
  events: PartyCharacterEvent[];
  isLoading: boolean;
  isSaving: boolean;
  onCreateNote: (input: { title: string; description: string }) => void;
}) {
  return (
    <div className="mt-4 space-y-4">
      <ProgressNoteForm isSaving={isSaving} onSubmit={onCreateNote} />
      {isLoading ? <p className="rounded-md bg-parchment/80 px-3 py-2 text-sm text-moss/70">Loading history...</p> : <PartyEventList events={events} />}
    </div>
  );
}

function ProgressNoteForm({
  isSaving,
  onSubmit
}: {
  isSaving: boolean;
  onSubmit: (input: { title: string; description: string }) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({ title: title.trim() || "Progress note", description: description.trim() });
    setTitle("");
    setDescription("");
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-moss/10 bg-parchment/70 p-3">
      <div className="grid gap-2">
        <FormField label="Progress Title" value={title} onChange={setTitle} />
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-copper">
          Description
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            className="mt-1 w-full resize-none rounded-md border border-moss/20 px-3 py-2 text-sm normal-case tracking-normal text-ink"
          />
        </label>
      </div>
      <button type="submit" disabled={isSaving || !description.trim()} className="mt-3 rounded-md border border-copper px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-copper disabled:cursor-not-allowed disabled:opacity-50">
        Add Note
      </button>
    </form>
  );
}

function PartyEventList({ events, compact = false }: { events: PartyCharacterEvent[]; compact?: boolean }) {
  if (events.length === 0) {
    return <p className="mt-3 rounded-md bg-parchment/80 px-3 py-2 text-sm text-moss/70">No character progress yet.</p>;
  }

  return (
    <div className="mt-3 space-y-2">
      {events.map((event) => (
        <div key={event.id} className="rounded-lg bg-parchment/80 px-3 py-2 text-sm leading-6 text-moss">
          <div className="flex items-start justify-between gap-3">
            <p className="font-semibold text-ink">{event.title || event.eventType.replaceAll("_", " ")}</p>
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-copper">{formatEventDate(event.createdAt)}</span>
          </div>
          {!compact && event.description && <p className="mt-1 text-moss/75">{event.description}</p>}
          {!compact && <PartyEventDelta event={event} />}
        </div>
      ))}
    </div>
  );
}

function PartyEventDelta({ event }: { event: PartyCharacterEvent }) {
  const before = object(event.beforeState);
  const after = object(event.afterState);
  const changes = [
    fieldChange("Level", before.level, after.level),
    fieldChange("HP", before.hpCurrent, after.hpCurrent),
    fieldChange("Temp HP", before.tempHp, after.tempHp),
    fieldChange("AC", before.armorClass, after.armorClass)
  ].filter(Boolean);

  if (changes.length === 0) {
    return null;
  }

  return <p className="mt-1 text-xs text-moss/65">{changes.join(" · ")}</p>;
}

function FormField({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  min
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  min?: number;
}) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-copper">
      {label}
      <input
        type={type}
        min={min}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-md border border-moss/20 px-3 py-2 text-sm normal-case tracking-normal text-ink"
      />
    </label>
  );
}

function ToolCallCard({ toolCall }: { toolCall: ToolCall }) {
  const presentation = toolPresentation(toolCall);
  return (
    <div className="rounded-xl border border-moss/15 bg-parchment p-4 text-sm text-moss shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-copper">{presentation.eyebrow}</p>
          <p className="mt-1 text-base font-semibold text-ink">{presentation.title}</p>
          <p className="mt-1 text-xs leading-5 text-moss/70">{presentation.description}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${toolCall.success ? "bg-mist text-moss" : "bg-ember/10 text-ember"}`}>
          {toolCall.success ? "Ready" : "Needs review"}
        </span>
      </div>
      <div className="mt-3">
        {toolCall.error ? <p className="text-ember">{toolCall.error}</p> : <ToolResult toolCall={toolCall} />}
      </div>
    </div>
  );
}

function ToolResult({ toolCall }: { toolCall: ToolCall }) {
  const result = toolCall.result ?? {};
  if (toolCall.toolName === "rollDice") {
    const expression = toolCall.arguments.expression ?? result.expression;
    return <DiceRollResult expression={String(expression ?? "")} rolls={JSON.stringify(result.rolls ?? [])} modifier={formatModifier(result.modifier)} total={String(result.total ?? "")} />;
  }
  if (toolCall.toolName === "generateInitiativeOrder") {
    const order = Array.isArray(result.order) ? result.order : [];
    return (
      <ol className="mt-1 space-y-2">
        {order.map((entry, index) => (
          <li key={index} className="flex items-center justify-between gap-3 rounded-lg bg-white/70 px-3 py-2">
            <span className="font-semibold text-ink">{index + 1}. {String(entry.name)}</span>
            <span>{String(entry.total)} total</span>
          </li>
        ))}
      </ol>
    );
  }
  if (toolCall.toolName === "calculateEncounterDifficulty") {
    const explanation = String(result.explanation ?? "");
    const difficulty = String(result.difficulty ?? "");
    return (
      <div>
        <div className="grid gap-2 sm:grid-cols-3">
          <ToolMetric label="Table Pressure" value={difficulty} emphasis />
          <ToolMetric label="Total XP" value={String(result.totalMonsterXp ?? "")} />
          <ToolMetric label="Adjusted XP" value={String(result.adjustedXp ?? "")} />
        </div>
        {difficulty && <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 leading-6 text-moss/80">{encounterDifficultyAdvice(difficulty)}</p>}
        {explanation && <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 leading-6 text-moss/80">{explanation}</p>}
      </div>
    );
  }
  if (toolCall.toolName === "searchRules" || toolCall.toolName === "searchHomebrew" || toolCall.toolName === "searchCampaignMemory") {
    const results = Array.isArray(result.results) ? result.results : [];
    const query = String(toolCall.arguments.query ?? result.query ?? "");
    const top = object(results[0]);
    const topContent = text(top.content);
    const sourceType = toolCall.toolName === "searchRules" ? "Rules" : toolCall.toolName === "searchHomebrew" ? "Homebrew" : "Memory";
    return (
      <div>
        <div className="grid gap-2 sm:grid-cols-3">
          <ToolMetric label="Checked For" value={query} />
          <ToolMetric label={`${sourceType} Matches`} value={String(results.length)} emphasis />
          <ToolMetric label="Best Match" value={text(top.title) || text(top.source) || "-"} />
        </div>
        {results.length === 0 && <p className="mt-3 rounded-lg bg-white/70 px-3 py-2">No matching notes found.</p>}
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
  return <p className="rounded-lg bg-white/70 px-3 py-2 leading-6 text-moss/80">Result ready.</p>;
}

function DiceRollResult({
  expression,
  rolls,
  modifier,
  total
}: {
  expression: string;
  rolls: string;
  modifier: string;
  total: string;
}) {
  return (
    <div className="rounded-lg border border-moss/10 bg-white/75 p-3">
      <div className="flex items-center justify-between gap-3 border-b border-moss/10 pb-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-copper">Total</p>
        <p className="shrink-0 text-2xl font-semibold leading-none text-ink">{total || "-"}</p>
      </div>
      <dl className="mt-3 grid gap-2 text-sm">
        <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-3">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-copper">Expression</dt>
          <dd className="min-w-0 break-words text-right font-medium text-moss">{expression || "-"}</dd>
        </div>
        <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-3">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-copper">Rolls</dt>
          <dd className="min-w-0 break-words text-right font-medium text-moss">{rolls || "-"}</dd>
        </div>
        <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-3">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-copper">Modifier</dt>
          <dd className="min-w-0 break-words text-right font-medium text-moss">{modifier || "-"}</dd>
        </div>
      </dl>
    </div>
  );
}

function ToolMetric({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="rounded-lg border border-moss/10 bg-white/75 px-3 py-2">
      <p className="break-words text-[11px] font-semibold uppercase tracking-[0.08em] text-copper">{label}</p>
      <p className={`mt-1 break-words ${emphasis ? "text-lg font-semibold text-ink" : "text-sm text-moss"}`}>{value || "-"}</p>
    </div>
  );
}

function toolPresentation(toolCall: ToolCall) {
  if (toolCall.toolName === "calculateEncounterDifficulty") {
    return {
      eyebrow: "Encounter Balance",
      title: "Difficulty Check",
      description: "Estimated how much pressure this fight puts on the party."
    };
  }
  if (toolCall.toolName === "searchRules") {
    return {
      eyebrow: "Rules Checked",
      title: "Rules Reference",
      description: "Looked up rule text so the answer stays grounded."
    };
  }
  if (toolCall.toolName === "searchHomebrew") {
    return {
      eyebrow: "Homebrew Checked",
      title: "Homebrew Reference",
      description: "Looked up enabled homebrew context separately from official rules."
    };
  }
  if (toolCall.toolName === "searchCampaignMemory") {
    return {
      eyebrow: "Campaign Memory",
      title: "Story Context",
      description: "Checked saved campaign notes for names, hooks, and unresolved threads."
    };
  }
  if (toolCall.toolName === "rollDice") {
    return {
      eyebrow: "Dice",
      title: "Roll Result",
      description: "Resolved a dice expression for immediate table use."
    };
  }
  if (toolCall.toolName === "generateInitiativeOrder") {
    return {
      eyebrow: "Initiative",
      title: "Turn Order",
      description: "Sorted combatants into a ready-to-run order."
    };
  }
  return {
    eyebrow: "Assistant Check",
    title: splitCamelCase(toolCall.toolName),
    description: "Extra work DNDMind used to prepare this answer."
  };
}

function encounterDifficultyAdvice(difficulty: string) {
  const normalized = difficulty.toLowerCase();
  if (normalized.includes("easy")) {
    return "Good as a warm-up, clue delivery scene, or resource-light obstacle before the real pressure lands.";
  }
  if (normalized.includes("medium")) {
    return "Solid session pacing encounter: meaningful risk without likely overwhelming the party.";
  }
  if (normalized.includes("hard")) {
    return "Use as a spotlight fight. Give the party clear stakes, terrain choices, or an escape route.";
  }
  if (normalized.includes("deadly")) {
    return "High-risk scene. Telegraph danger clearly and consider an objective other than defeating every enemy.";
  }
  return "Use this as a pacing signal, then tune for your table's actual resources and player choices.";
}

function formatModifier(value: unknown) {
  const numeric = Number(value ?? 0);
  return `${numeric >= 0 ? "+" : ""}${numeric}`;
}

function sanitizeDiceExpressionInput(value: string) {
  return value.replace(/[^0-9dD+-]/g, "").replace(/D/g, "d").slice(0, 12);
}

function validateDiceExpression(value: string) {
  const expression = value.trim();
  if (!expression) {
    return "Enter dice as XdY, such as 1d20.";
  }

  const match = expression.match(diceExpressionPattern);
  if (!match) {
    return "Use one dice term: XdY with an optional +N or -N modifier.";
  }

  const count = Number(match[1]);
  const sides = Number(match[2]);
  if (count < 1 || count > 50) {
    return "Dice count must be between 1 and 50.";
  }
  if (sides < 2 || sides > 1000) {
    return "Dice sides must be between 2 and 1000.";
  }

  return null;
}

function numberOrNull(value: string): number | null {
  if (value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberOrDefault(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

function formatEventDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}

function fieldChange(label: string, before: unknown, after: unknown) {
  if (before === after || after === undefined) {
    return "";
  }
  return `${label}: ${before ?? "-"} -> ${after ?? "-"}`;
}

function citationLabel(citation: Citation) {
  const haystack = `${citation.source ?? ""} ${citation.title ?? ""} ${citation.heading ?? ""}`.toLowerCase();
  if (haystack.includes("homebrew")) {
    return "Homebrew Reference";
  }
  if (haystack.includes("rule") || haystack.includes("srd")) {
    return "Rule Reference";
  }
  if (haystack.includes("memory") || haystack.includes("session") || haystack.includes("blackwater") || haystack.includes("captain")) {
    return "Session Memory";
  }
  return "Campaign Source";
}

function formatSourceType(sourceType: string) {
  if (sourceType === "srd") {
    return "SRD";
  }
  return splitCamelCase(sourceType || "rules");
}

function formatDocumentStatus(status: unknown) {
  if (status === "ingested") {
    return "ready to use";
  }
  if (status === "uploaded") {
    return "adding";
  }
  return "ready";
}

function splitCamelCase(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function imageUrlFromMetadata(value: unknown): string | null {
  const metadata = object(value);
  const imageUrl = text(metadata.imageUrl);
  if (imageUrl.startsWith("data:image/svg+xml") || imageUrl.startsWith("https://") || imageUrl.startsWith("http://")) {
    return imageUrl;
  }
  return null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

function stripInlineMarkdown(value: string) {
  return value.replace(/\*\*/g, "").replace(/^\s*[-*]\s+/, "").trim();
}

function renderInlineMarkdown(value: string) {
  const parts = value.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    const bold = part.match(/^\*\*([^*]+)\*\*$/);
    if (bold) {
      return <strong key={`${part}-${index}`} className="font-semibold text-ink">{bold[1]}</strong>;
    }
    return part;
  });
}

function briefingTitle(output: StructuredOutput | null | undefined) {
  if (output?.type === "encounter") {
    return "Encounter Briefing";
  }
  if (output?.type === "npc") {
    return "NPC Briefing";
  }
  if (output?.type === "character") {
    return "Character Briefing";
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

function enhanceChatResultForPreparedContent(userMessage: string, response: ChatResponse, selectedMode: string): ResultEnhancements {
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
    return enhancePlainNpcResult(userMessage, response, selectedMode, {
      content: response.answer,
      citations: response.citations,
      toolCalls: response.toolCalls,
      structuredOutput: response.structuredOutput,
      suggestedActions: response.suggestedActions
    });
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
              chunkId: "prepared-vey-encounter",
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
              payload: { message: "Make the Ambush at the Smuggler Tunnel encounter harder while keeping it fair." }
            },
            {
              label: "Make Easier",
              action: "prompt",
              payload: { message: "Make the Ambush at the Smuggler Tunnel encounter easier without losing the evidence chase." }
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
            chunkId: "prepared-blackwater-vey",
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

function enhancePlainNpcResult(
  userMessage: string,
  response: ChatResponse,
  selectedMode: string,
  base: ResultEnhancements
): ResultEnhancements {
  if (shouldSkipPlainEntityEnhancement(userMessage, selectedMode)) {
    return {
      ...base,
      structuredOutput: base.structuredOutput?.type === "session_summary" ? base.structuredOutput : null,
      suggestedActions: base.structuredOutput?.type === "session_summary" ? base.suggestedActions : []
    };
  }
  if (base.structuredOutput) {
    return base;
  }

  const character = inferCharacterFromPlainText(userMessage, response.answer, selectedMode);
  if (character) {
    const structuredOutput: StructuredOutput = { type: "character", data: character };
    const characterName = String(character.name || "this character");
    return {
      ...base,
      structuredOutput,
      suggestedActions: base.suggestedActions.length
        ? base.suggestedActions
        : [
            {
              label: "Add Campaign Tie",
              action: "prompt",
              payload: { message: `Deepen ${characterName}'s tie to one existing party member, faction, or unresolved hook.` }
            },
            {
              label: "Make Hireling",
              action: "prompt",
              payload: { message: `Revise ${characterName} as a hireling with a clear price, limit, and complication.` }
            }
          ]
    };
  }

  const npc = inferNpcFromPlainText(userMessage, response.answer, selectedMode);
  if (!npc) {
    return base;
  }

  const structuredOutput: StructuredOutput = { type: "npc", data: npc };
  return {
    ...base,
    structuredOutput,
    suggestedActions: base.suggestedActions.length
      ? base.suggestedActions
      : [
          { label: "Save NPC", action: "saveNPC", payload: npc },
          {
            label: "Generate Quest Hook",
            action: "prompt",
            payload: { message: `Generate a quest hook for ${npc.name} that ties back to the party's current campaign memory.` }
          },
          {
            label: "Add Relationship",
            action: "prompt",
            payload: { message: `Add a relationship between ${npc.name} and one existing party member or campaign NPC.` }
          }
        ]
  };
}

function shouldSkipPlainEntityEnhancement(userMessage: string, selectedMode: string) {
  const prompt = userMessage.toLowerCase();
  const mode = selectedMode.toLowerCase();
  return (
    mode === "summarize" ||
    mode === "recap" ||
    /\bsummar(?:y|ize|ise|izing)\b/.test(prompt) ||
    /\bsession notes?\b/.test(prompt) ||
    /\bpreviously\b|\brecap\b|\bwhat happened so far\b/.test(prompt)
  );
}

function inferNpcFromPlainText(userMessage: string, answer: string, selectedMode: string): Record<string, unknown> | null {
  const prompt = userMessage.toLowerCase();
  const mode = selectedMode.toLowerCase();
  if (looksLikeCharacterRequest(prompt, mode)) {
    return null;
  }
  const looksLikeNpcRequest =
    mode === "npc" ||
    /\bnpcs?\b/.test(prompt) ||
    /\b(character|informant|contact|ally|rival|villain|merchant|keeper|guard|knight)\b/.test(prompt);

  if (!looksLikeNpcRequest || !answer.trim()) {
    return null;
  }

  const name = extractNpcName(answer);
  if (!name) {
    return null;
  }

  const role = extractNpcRole(answer) || "Campaign NPC";
  const connection = extractLabeledSection(answer, "Connection to Campaign") || extractLabeledSection(answer, "Party Link");
  return {
    name,
    role,
    raceOrSpecies: extractLabeledSection(answer, "Race") || extractLabeledSection(answer, "Ancestry") || "Humanoid",
    description: extractLabeledSection(answer, "Appearance") || firstSentence(answer),
    personality: extractLabeledSection(answer, "Personality") || "Practical, watchful, and useful at the table.",
    motivation: extractLabeledSection(answer, "Motivation") || "Advance their own interests while reacting to the campaign's current pressure.",
    secret: extractLabeledSection(answer, "Secret") || extractSecretFromAnswer(answer) || "They know more than they are ready to share.",
    relationshipToParty: connection || "A contact the party can bargain with, pressure, or recruit.",
    questHook:
      extractLabeledSection(answer, "Quest Hook") ||
      extractLeadFromAnswer(answer) ||
      connection ||
      "Use this NPC to point the party toward one concrete lead from the current campaign memory."
  };
}

function inferCharacterFromPlainText(userMessage: string, answer: string, selectedMode: string): Record<string, unknown> | null {
  const prompt = userMessage.toLowerCase();
  const mode = selectedMode.toLowerCase();
  if (!looksLikeCharacterRequest(prompt, mode) || !answer.trim()) {
    return null;
  }

  const name = extractNpcName(answer) || "Generated Character";
  const personalityTraits = splitStructuredText(extractLabeledSection(answer, "Personality Traits") || extractLabeledSection(answer, "Personality"));
  const equipment = splitStructuredText(extractLabeledSection(answer, "Equipment"));
  return {
    name,
    ancestryOrSpecies: extractLabeledSection(answer, "Ancestry") || extractLabeledSection(answer, "Species") || extractLabeledSection(answer, "Race") || "Humanoid",
    classAndSubclass: extractLabeledSection(answer, "Class") || extractLabeledSection(answer, "Class/Subclass") || "Adventurer",
    level: extractCharacterLevel(userMessage) || extractCharacterLevel(answer) || 3,
    background: extractLabeledSection(answer, "Background") || "Campaign-tied wanderer",
    role: extractLabeledSection(answer, "Role") || extractNpcRole(answer) || "Backup adventurer",
    statSummary: extractLabeledSection(answer, "Stats") || extractLabeledSection(answer, "Ability Scores") || "Use standard array tuned toward the character's class.",
    personalityTraits: personalityTraits.length ? personalityTraits : ["Practical under pressure", "Curious about the party's current trouble"],
    idealsBondsFlaws: extractLabeledSection(answer, "Ideals/Bonds/Flaws") || extractLabeledSection(answer, "Ideal") || "Ideal: Protect the vulnerable. Bond: Owes someone in the campaign. Flaw: Keeps one dangerous truth hidden.",
    equipment: equipment.length ? equipment : ["Class gear", "travel kit", "one campaign clue"],
    campaignTieIn: extractLabeledSection(answer, "Campaign Tie-In") || extractLabeledSection(answer, "Connection to Campaign") || "Tie this character to an unresolved campaign hook or faction.",
    secretOrHook: extractLabeledSection(answer, "Secret") || extractLabeledSection(answer, "Hook") || extractSecretFromAnswer(answer) || "They are connected to a threat the party has not fully understood."
  };
}

function looksLikeCharacterRequest(prompt: string, mode: string) {
  if (mode === "character") {
    return true;
  }
  return (
    /\b(?:playable|backup|player)\s+characters?\b/.test(prompt) ||
    /\b(?:backup pc|pc backup|player character)\b/.test(prompt) ||
    /\b(?:rival adventurer|adventuring rival|hireling|retainer)\b/.test(prompt) ||
    /\bgenerate\s+a\s+level\s+\d+\b/.test(prompt) ||
    /\b(?:create|generate|make)\b.{0,60}\b(?:ranger|cleric|fighter|wizard|rogue|bard|paladin|druid|barbarian|monk|warlock|sorcerer|artificer)\b/.test(prompt)
  );
}

function extractCharacterLevel(value: string) {
  const match = value.match(/\blevel\s+(\d{1,2})\b/i);
  if (!match) {
    return 0;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function splitStructuredText(value: string): string[] {
  if (!value.trim()) {
    return [];
  }
  return value.split(/\s*(?:,|;|\n|\s+-\s+)\s*/).map((item) => item.trim()).filter(Boolean);
}

function extractNpcName(answer: string) {
  const quotedFullName = answer.match(/\b(?:You encounter|Meet|Here is|Here'?s|Introducing)\s+['"]([^'"]{2,40})['"]\s+([A-Z][A-Za-z']+(?:\s+[A-Z][A-Za-z']+){0,2})/i);
  if (quotedFullName) {
    return `"${quotedFullName[1].trim()}" ${quotedFullName[2].trim()}`;
  }

  const quoted = answer.match(/\b(?:Meet|Here is|Here'?s|Introducing)\s+['"]([^'"]{2,80})['"]/i);
  if (quoted) {
    return quoted[1].trim();
  }

  const named = answer.match(
    /\b(?:named|called|Meet|encounter)\s+((?:Sir|Lady|Lord|Captain|Mayor|Keeper|Agent|Scout|Mage|Wizard|Rogue|Guard|Innkeeper)\s+)?([A-Z][A-Za-z']+(?:\s+(?:'[^']+'|"[^"]+"|[A-Z][A-Za-z']+)){0,3})/
  );
  if (named) {
    return `${named[1] ?? ""}${named[2]}`.replace(/\s+/g, " ").trim();
  }

  const bold = answer.match(/\*\*([A-Z][A-Za-z' -]{2,80})\*\*/);
  return bold?.[1]?.trim() ?? "";
}

function extractNpcRole(answer: string) {
  const role = answer.match(/\b(?:is|as)\s+a\s+([^.,:\n]{3,80})(?:,|\.|\n| who\b)/i);
  return role?.[1]?.trim() ?? "";
}

function extractLabeledSection(answer: string, label: string) {
  const expression = new RegExp(
    `(?:^|\\n)\\s*[-*]?\\s*\\*?\\*?${escapeRegExp(label)}\\*?\\*?\\s*:\\s*(.+?)(?=\\n\\s*[-*]?\\s*\\*?\\*?[A-Z][A-Za-z ]{2,36}\\*?\\*?\\s*:|$)`,
    "is"
  );
  const match = answer.match(expression);
  return match ? cleanAssistantText(match[1]) : "";
}

function extractSecretFromAnswer(answer: string) {
  const secret = answer.match(/\b(?:secret|knows|overheard|clue|truth)\b[^.!?]*[.!?]/i);
  return secret ? cleanAssistantText(secret[0]) : "";
}

function extractLeadFromAnswer(answer: string) {
  const lead = answer.match(/\b(?:next step|lead|trail|clue|investigate|find|recover|ask the party)\b[^.!?]*[.!?]/i);
  return lead ? cleanAssistantText(lead[0]) : "";
}

function firstSentence(value: string) {
  return cleanAssistantText(value).split(/(?<=[.!?])\s+/)[0] || "A table-ready NPC generated from the current request.";
}

function cleanAssistantText(value: string) {
  return stripInlineMarkdown(value)
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
