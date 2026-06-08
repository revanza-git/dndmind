import { getClientId } from "./clientIdentity";

export type Campaign = {
  id: string;
  name: string;
  description: string | null;
  systemTone: string;
  currentSessionId: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CampaignInput = {
  name: string;
  description?: string | null;
  systemTone?: string | null;
};

export type PartyCharacter = {
  id: string;
  campaignId: string;
  name: string;
  className: string | null;
  race: string | null;
  level: number;
  hpCurrent: number | null;
  hpMax: number | null;
  tempHp: number | null;
  armorClass: number | null;
  initiativeModifier: number | null;
  passivePerception: number | null;
  conditions: string[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PartyCharacterInput = {
  name: string;
  className?: string | null;
  race?: string | null;
  level: number;
  hpCurrent?: number | null;
  hpMax?: number | null;
  tempHp?: number | null;
  armorClass?: number | null;
  initiativeModifier?: number | null;
  passivePerception?: number | null;
  conditions?: string[];
  notes?: string | null;
};

export type PartyCharacterEvent = {
  id: string;
  campaignId: string;
  characterId: string;
  eventType: string;
  title: string | null;
  description: string | null;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  sessionId: string | null;
  createdAt: string;
};

export type Session = {
  id: string;
  campaignId: string;
  sessionNumber: number;
  title: string;
  rawNotes: string | null;
  summary: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type ChatContext = {
  useRules: boolean;
  useCampaignMemory: boolean;
  usePartyInfo: boolean;
  useHomebrew: boolean;
};

export type ChatResponse = {
  conversationId: string;
  answer: string;
  mode: string;
  citations: Citation[];
  toolCalls: ToolCall[];
  structuredOutput: StructuredOutput | null;
  suggestedActions: SuggestedAction[];
};

export type PromptSuggestionMode = "auto" | "rules" | "npc" | "character" | "encounter" | "recap" | "summarize";
export type ResolvedPromptSuggestionMode = Exclude<PromptSuggestionMode, "auto">;

export type PromptSuggestionRequest = {
  campaignId: string;
  sessionId?: string | null;
  mode: PromptSuggestionMode;
  currentInput?: string | null;
};

export type PromptSuggestionResponse = {
  prompt: string;
  mode: PromptSuggestionMode;
  resolvedMode?: ResolvedPromptSuggestionMode | null;
  reason?: string | null;
};

export type ToolCall = {
  toolName: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown> | null;
  success: boolean;
  error: string | null;
};

export type StructuredOutputType =
  | "npc"
  | "character"
  | "quest"
  | "location"
  | "encounter"
  | "session_summary"
  | "initiative_order"
  | "dice_roll";

export type StructuredOutput = {
  type: StructuredOutputType;
  data: Record<string, unknown>;
};

export type StructuredImageOutputType = "npc" | "character" | "encounter";
export type ImageStylePreset = "cinematic" | "parchment sketch" | "combat stance" | "anime";

export type ImageGenerationRequest = {
  campaignId: string;
  conversationId?: string | null;
  structuredOutputType: StructuredImageOutputType;
  structuredOutputData: Record<string, unknown>;
  stylePreset?: ImageStylePreset;
};

export type ImageGenerationResponse = {
  imageUrl?: string | null;
  imageData?: string | null;
  imagePrompt: string;
  provider: string;
  model: string;
  status: string;
  error?: string | null;
  imageGeneratedAt?: string | null;
  imageStylePreset?: ImageStylePreset | string | null;
};

export type SaveImageMetadata = {
  imageUrl?: string | null;
  imagePrompt?: string | null;
  imageProvider?: string | null;
  imageModel?: string | null;
  imageGeneratedAt?: string | null;
  imageStylePreset?: ImageStylePreset | string | null;
};

export type SuggestedAction = {
  label: string;
  action: string;
  payload: Record<string, unknown>;
};

export type Citation = {
  source?: string;
  title?: string;
  heading?: string | null;
  chunkId?: string;
  documentId?: string;
  score?: number;
  snippet?: string;
};

export type KnowledgeDocument = {
  id: string;
  campaignId: string | null;
  sourceType: string;
  title: string;
  originalFilename: string | null;
  metadata: {
    status?: string;
    chunkCount?: number;
    embeddingModel?: string;
    mockEmbeddings?: boolean;
    memoryType?: string;
    encounterId?: string;
    clientOwnerId?: string;
  };
  createdAt: string;
  chunkCount: number;
};

export type IngestDocumentResponse = {
  documentId: string;
  chunkCount: number;
  embeddingModel: string;
  mockEmbeddings: boolean;
};

export type MemoryNpc = {
  id: string;
  name: string;
  role: string | null;
  description: string | null;
  disposition: string | null;
  metadata: Record<string, unknown>;
};

export type MemoryQuest = {
  id: string;
  title: string;
  status: string;
  description: string | null;
};

export type MemoryLocation = {
  id: string;
  name: string;
  description: string | null;
  locationType: string | null;
};

export type MemoryEncounter = {
  id: string;
  campaignId: string;
  sessionId: string | null;
  title: string;
  summary: string | null;
  outcome: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ExtractedEncounterSummary = {
  title: string;
  summary: string | null;
  outcome: string | null;
};

export type MemoryEvent = {
  id: string;
  eventType: string;
  title: string;
  description: string | null;
};

export type HookStatus = "open" | "rumor" | "lead" | "active" | "resolved" | "dropped";

export type MemoryHook = {
  id: string;
  campaignId: string;
  sessionId: string | null;
  title: string;
  description: string | null;
  status: HookStatus;
  resolution: string | null;
  relatedEntityType: string | null;
  relatedEntityName: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CampaignMemory = {
  npcs: MemoryNpc[];
  quests: MemoryQuest[];
  locations: MemoryLocation[];
  encounters: MemoryEncounter[];
  events: MemoryEvent[];
  hooks: MemoryHook[];
};

export type SessionSummaryResponse = {
  session: Session;
  summary: {
    summary: string;
    importantEvents: string[];
    npcs: MemoryNpc[];
    locations: MemoryLocation[];
    quests: MemoryQuest[];
    encounters: ExtractedEncounterSummary[];
    items: string[];
    unresolvedHooks: string[];
  };
  memoryDocumentId: string;
};

export type ClearSessionMemoryResponse = {
  session: Session | null;
  deletedMemoryEvents: number;
  deletedHooks: number;
  deletedNpcs: number;
  deletedQuests: number;
  deletedLocations: number;
  deletedEncounters: number;
  deletedMemoryDocuments: number;
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("X-Dndmind-Client-Id", getClientId());

  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers
  });
}

async function apiErrorMessage(response: Response, fallback: string) {
  const text = await response.text();
  if (!text) {
    return fallback;
  }

  try {
    const payload = JSON.parse(text) as { detail?: unknown; error?: unknown; title?: unknown; status?: unknown };
    const detail = typeof payload.detail === "string" ? payload.detail : typeof payload.error === "string" ? payload.error : "";
    if (detail) {
      return friendlyError(detail, fallback);
    }
    if (typeof payload.title === "string" && typeof payload.status === "number") {
      return friendlyError(`${payload.title} (${payload.status})`, fallback);
    }
  } catch {
    return friendlyError(text, fallback);
  }

  return friendlyError(text, fallback);
}

function friendlyError(message: string, fallback: string) {
  const lower = message.toLowerCase();
  if (lower.includes("temporarily busy") || lower.includes("temporarily overloaded") || lower.includes("high demand") || lower.includes("service unavailable")) {
    return "The AI is busy right now and could not finish. Please try again in a moment.";
  }
  if (lower.includes("api key") || lower.includes("api_key")) {
    return "The AI service is not connected correctly. Ask the app admin to check the setup.";
  }
  if (lower.includes("rate limit") || lower.includes("rate-limit") || lower.includes("quota")) {
    return "The AI is getting too many requests right now. Please wait a moment, then try again.";
  }
  if (lower.includes("image generation")) {
    return message;
  }
  if (lower.includes("embedding dimensions") || lower.includes("database expects") || lower.includes("pgvector schema")) {
    return "Campaign knowledge is not set up correctly. Ask the app admin to check the knowledge setup.";
  }
  if (lower.includes("bad gateway") || lower.includes("ai worker failed") || lower.includes("internal server error")) {
    return "DNDMind could not get an AI response just now. Please try again in a moment.";
  }
  if (lower.includes("bad request") || lower.includes("not found") || lower.includes("unauthorized") || lower.includes("forbidden")) {
    return fallback;
  }
  return message || fallback;
}

export async function getCampaigns(): Promise<Campaign[]> {
  const response = await apiFetch("/api/campaigns", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("DNDMind could not load your campaigns. Refresh the page and try again.");
  }
  return response.json();
}

export async function getArchivedCampaigns(): Promise<Campaign[]> {
  const response = await apiFetch("/api/campaigns/archived", { cache: "no-store" });
  if (response.status === 204) {
    return [];
  }
  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not load archived campaigns. Refresh the page and try again."));
  }
  const campaigns = await response.json();
  return Array.isArray(campaigns) ? campaigns : [];
}

export async function createCampaign(input: CampaignInput): Promise<Campaign> {
  const response = await apiFetch("/api/campaigns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not create that campaign. Please try again."));
  }

  return response.json();
}

export async function archiveCampaign(campaignId: string): Promise<Campaign> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/archive`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not archive that campaign. Please try again."));
  }

  return response.json();
}

export async function restoreCampaign(campaignId: string): Promise<Campaign> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/restore`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not restore that campaign. Please try again."));
  }

  return response.json();
}

export async function updateCampaign(campaignId: string, input: CampaignInput): Promise<Campaign> {
  const response = await apiFetch(`/api/campaigns/${campaignId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not save that campaign. Please try again."));
  }

  return response.json();
}

export async function getParty(campaignId: string): Promise<PartyCharacter[]> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/party`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("DNDMind could not load the party. Refresh the page and try again.");
  }
  return response.json();
}

export async function createPartyCharacter(campaignId: string, input: PartyCharacterInput): Promise<PartyCharacter> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/party`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not add that character. Please try again."));
  }
  return response.json();
}

export async function updatePartyCharacter(characterId: string, input: PartyCharacterInput): Promise<PartyCharacter> {
  const response = await apiFetch(`/api/party/${characterId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not save that character. Please try again."));
  }
  return response.json();
}

export async function deletePartyCharacter(characterId: string): Promise<void> {
  const response = await apiFetch(`/api/party/${characterId}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not remove that character. Please try again."));
  }
}

export async function updatePartyCharacterHp(input: {
  characterId: string;
  hpCurrent: number | null;
  tempHp: number | null;
  note?: string;
}): Promise<PartyCharacter> {
  const response = await apiFetch(`/api/party/${input.characterId}/hp`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hpCurrent: input.hpCurrent, tempHp: input.tempHp, note: input.note ?? null })
  });
  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not update HP. Please try again."));
  }
  return response.json();
}

export async function updatePartyCharacterLevel(input: {
  characterId: string;
  level: number;
  note?: string;
}): Promise<PartyCharacter> {
  const response = await apiFetch(`/api/party/${input.characterId}/level`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ level: input.level, note: input.note ?? null })
  });
  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not update the level. Please try again."));
  }
  return response.json();
}

export async function createPartyCharacterEvent(input: {
  characterId: string;
  eventType: string;
  title?: string;
  description?: string;
  sessionId?: string | null;
}): Promise<PartyCharacterEvent> {
  const response = await apiFetch(`/api/party/${input.characterId}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not save that character note. Please try again."));
  }
  return response.json();
}

export async function getPartyCharacterEvents(characterId: string): Promise<PartyCharacterEvent[]> {
  const response = await apiFetch(`/api/party/${characterId}/events`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("DNDMind could not load that character's history. Refresh the page and try again.");
  }
  return response.json();
}

export async function getRecentPartyEvents(campaignId: string): Promise<PartyCharacterEvent[]> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/party/events`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("DNDMind could not load the party history. Refresh the page and try again.");
  }
  return response.json();
}

export async function getSessions(campaignId: string): Promise<Session[]> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/sessions`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("DNDMind could not load your sessions. Refresh the page and try again.");
  }
  return response.json();
}

export async function createSession(input: {
  campaignId: string;
  sessionNumber?: number;
  title: string;
  rawNotes: string;
}): Promise<Session> {
  const response = await apiFetch(`/api/campaigns/${input.campaignId}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionNumber: input.sessionNumber ?? 0,
      title: input.title,
      rawNotes: input.rawNotes,
      status: "active"
    })
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not create that session. Please try again."));
  }

  return response.json();
}

export async function updateSession(input: {
  sessionId: string;
  sessionNumber: number;
  title: string;
  rawNotes: string;
  summary?: string | null;
  status?: string;
}): Promise<Session> {
  const response = await apiFetch(`/api/sessions/${input.sessionId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionNumber: input.sessionNumber,
      title: input.title,
      rawNotes: input.rawNotes,
      summary: input.summary ?? null,
      status: input.status ?? "active"
    })
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not save that session. Please try again."));
  }

  return response.json();
}

export async function deleteSession(sessionId: string): Promise<void> {
  const response = await apiFetch(`/api/sessions/${sessionId}`, {
    method: "DELETE"
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not delete that session. Please try again."));
  }
}

export async function summarizeSession(sessionId: string): Promise<SessionSummaryResponse> {
  const response = await apiFetch(`/api/sessions/${sessionId}/summarize`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not summarize that session. Please try again."));
  }

  return response.json();
}

export async function clearSessionMemory(sessionId: string): Promise<ClearSessionMemoryResponse> {
  const response = await apiFetch(`/api/sessions/${sessionId}/clear-memory`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not clear that session memory. Please try again."));
  }

  return response.json();
}

export async function getCampaignMemory(campaignId: string): Promise<CampaignMemory> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/memory`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("DNDMind could not load campaign memory. Refresh the page and try again.");
  }
  return normalizeCampaignMemory(await response.json());
}

function normalizeCampaignMemory(value: unknown): CampaignMemory {
  const memory = value && typeof value === "object" ? (value as Partial<CampaignMemory>) : {};
  return {
    npcs: Array.isArray(memory.npcs) ? memory.npcs : [],
    quests: Array.isArray(memory.quests) ? memory.quests : [],
    locations: Array.isArray(memory.locations) ? memory.locations : [],
    encounters: Array.isArray(memory.encounters) ? memory.encounters : [],
    events: Array.isArray(memory.events) ? memory.events : [],
    hooks: Array.isArray(memory.hooks) ? memory.hooks : []
  };
}

export async function getDocuments(campaignId: string): Promise<KnowledgeDocument[]> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/documents`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("DNDMind could not load campaign knowledge. Refresh the page and try again.");
  }
  return response.json();
}

export async function uploadDocument(input: {
  campaignId: string;
  title: string;
  content: string;
  sourceType?: string;
  originalFilename?: string | null;
}): Promise<KnowledgeDocument> {
  const response = await apiFetch(`/api/campaigns/${input.campaignId}/documents/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: input.title,
      content: input.content,
      sourceType: input.sourceType ?? "rules",
      originalFilename: input.originalFilename ?? null,
      metadata: {}
    })
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not add that campaign knowledge. Please try again."));
  }

  return response.json();
}

export async function ingestDocument(documentId: string): Promise<IngestDocumentResponse> {
  const response = await apiFetch(`/api/documents/${documentId}/ingest`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not prepare that campaign knowledge. Please try again."));
  }

  return response.json();
}

export async function deleteDocument(documentId: string): Promise<void> {
  const response = await apiFetch(`/api/documents/${documentId}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not remove that campaign knowledge. Please try again."));
  }
}

export async function sendChat(input: {
  campaignId: string;
  conversationId: string | null;
  sessionId?: string | null;
  message: string;
  mode: string;
  context: ChatContext;
}): Promise<ChatResponse> {
  const response = await apiFetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not send that message. Please try again."));
  }

  return response.json();
}

export async function generatePromptSuggestion(input: PromptSuggestionRequest): Promise<PromptSuggestionResponse> {
  const response = await apiFetch("/api/prompt-suggestions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not draft a prompt suggestion. Please try again."));
  }

  return response.json();
}

export async function generateImage(input: ImageGenerationRequest): Promise<ImageGenerationResponse> {
  const response = await apiFetch("/api/images/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not generate an image. Please try again."));
  }

  const image = (await response.json()) as ImageGenerationResponse;
  if (image.status === "failed") {
    throw new Error(image.error || "DNDMind could not generate an image. Please try again.");
  }
  return image;
}

export async function executeTool(input: {
  campaignId: string | null;
  conversationId: string | null;
  toolName: string;
  arguments: Record<string, unknown>;
}): Promise<ToolCall> {
  const response = await apiFetch("/api/tools/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not complete that action. Please try again."));
  }

  return response.json();
}

export async function saveNpc(campaignId: string, payload: Record<string, unknown>): Promise<{ id: string; npc: MemoryNpc }> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/npcs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not save that NPC. Please try again."));
  }
  return response.json();
}

export async function saveQuest(campaignId: string, payload: Record<string, unknown>): Promise<{ id: string; quest: MemoryQuest }> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/quests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not save that quest. Please try again."));
  }
  return response.json();
}

export async function saveLocation(campaignId: string, payload: Record<string, unknown>): Promise<{ id: string; location: MemoryLocation }> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/locations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not save that location. Please try again."));
  }
  return response.json();
}

export async function saveMemoryEvent(campaignId: string, payload: Record<string, unknown>): Promise<{ id: string; memoryEvent: MemoryEvent }> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/memory-events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not save that hook. Please try again."));
  }
  return response.json();
}

export async function saveHook(campaignId: string, payload: Record<string, unknown>): Promise<{ id: string; hook: MemoryHook }> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/hooks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not save that hook. Please try again."));
  }
  return response.json();
}

export async function updateHook(campaignId: string, hookId: string, payload: Record<string, unknown>): Promise<{ id: string; hook: MemoryHook }> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/hooks/${hookId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not update that hook. Please try again."));
  }
  return response.json();
}

export async function resolveHook(campaignId: string, hookId: string, resolution?: string): Promise<{ id: string; hook: MemoryHook }> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/hooks/${hookId}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resolution: resolution ?? null })
  });
  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not resolve that hook. Please try again."));
  }
  return response.json();
}

export async function dropHook(campaignId: string, hookId: string): Promise<{ id: string; hook: MemoryHook }> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/hooks/${hookId}/drop`, {
    method: "POST"
  });
  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not drop that hook. Please try again."));
  }
  return response.json();
}

export async function saveEncounter(campaignId: string, payload: Record<string, unknown>): Promise<{ id: string; encounter: MemoryEncounter; memoryDocumentId: string }> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/encounters`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not save that encounter. Please try again."));
  }
  return response.json();
}

export async function deleteNpc(campaignId: string, npcId: string): Promise<void> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/npcs/${npcId}`, {
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not delete that NPC. Please try again."));
  }
}

export async function deleteQuest(campaignId: string, questId: string): Promise<void> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/quests/${questId}`, {
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not delete that quest. Please try again."));
  }
}

export async function deleteLocation(campaignId: string, locationId: string): Promise<void> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/locations/${locationId}`, {
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not delete that location. Please try again."));
  }
}

export async function deleteMemoryEvent(campaignId: string, eventId: string): Promise<void> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/memory-events/${eventId}`, {
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not delete that hook. Please try again."));
  }
}

export async function deleteHook(campaignId: string, hookId: string): Promise<void> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/hooks/${hookId}`, {
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not delete that hook. Please try again."));
  }
}

export async function deleteEncounter(campaignId: string, encounterId: string): Promise<void> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/encounters/${encounterId}`, {
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "DNDMind could not delete that encounter. Please try again."));
  }
}
