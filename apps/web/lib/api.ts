import { getClientId } from "./clientIdentity";

export type Campaign = {
  id: string;
  name: string;
  description: string | null;
  systemTone: string;
  currentSessionId: string | null;
  createdAt: string;
  updatedAt: string;
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

export type ToolCall = {
  toolName: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown> | null;
  success: boolean;
  error: string | null;
};

export type StructuredOutputType =
  | "npc"
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

export type MemoryEvent = {
  id: string;
  eventType: string;
  title: string;
  description: string | null;
};

export type CampaignMemory = {
  npcs: MemoryNpc[];
  quests: MemoryQuest[];
  locations: MemoryLocation[];
  events: MemoryEvent[];
};

export type SessionSummaryResponse = {
  session: Session;
  summary: {
    summary: string;
    importantEvents: string[];
    npcs: MemoryNpc[];
    locations: MemoryLocation[];
    quests: MemoryQuest[];
    items: string[];
    unresolvedHooks: string[];
  };
  memoryDocumentId: string;
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
    return "Gemini is temporarily busy and could not finish that request. Please try again in a moment. If it keeps happening, switch to another Gemini model in .env.";
  }
  if (lower.includes("api key") || lower.includes("api_key")) {
    return "Gemini is not available because the API key is missing or invalid. Check GEMINI_API_KEY in .env, then restart the worker.";
  }
  if (lower.includes("rate limit") || lower.includes("rate-limit") || lower.includes("quota")) {
    return "Gemini is rate-limiting this project right now. Wait a bit, then retry the request.";
  }
  if (lower.includes("embedding dimensions") || lower.includes("database expects") || lower.includes("pgvector schema")) {
    return "Gemini returned embeddings in a size that does not match the database vector column. Keep GEMINI_EMBEDDING_DIMENSIONS=1536, restart the worker, and ingest again.";
  }
  if (lower.includes("bad gateway") || lower.includes("ai worker failed") || lower.includes("internal server error")) {
    return "DNDMind reached the AI worker, but the provider request failed. Please retry in a moment; check the worker logs if it keeps happening.";
  }
  return message || fallback;
}

export async function getCampaigns(): Promise<Campaign[]> {
  const response = await apiFetch("/api/campaigns", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to load campaigns");
  }
  return response.json();
}

export async function getParty(campaignId: string): Promise<PartyCharacter[]> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/party`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to load party");
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
    const text = await response.text();
    throw new Error(text || "Character creation failed");
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
    const text = await response.text();
    throw new Error(text || "Character update failed");
  }
  return response.json();
}

export async function deletePartyCharacter(characterId: string): Promise<void> {
  const response = await apiFetch(`/api/party/${characterId}`, { method: "DELETE" });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Character delete failed");
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
    const text = await response.text();
    throw new Error(text || "HP update failed");
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
    const text = await response.text();
    throw new Error(text || "Level update failed");
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
    const text = await response.text();
    throw new Error(text || "Character event creation failed");
  }
  return response.json();
}

export async function getPartyCharacterEvents(characterId: string): Promise<PartyCharacterEvent[]> {
  const response = await apiFetch(`/api/party/${characterId}/events`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to load character history");
  }
  return response.json();
}

export async function getRecentPartyEvents(campaignId: string): Promise<PartyCharacterEvent[]> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/party/events`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to load party history");
  }
  return response.json();
}

export async function getSessions(campaignId: string): Promise<Session[]> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/sessions`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to load sessions");
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
    const text = await response.text();
    throw new Error(text || "Session creation failed");
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
    const text = await response.text();
    throw new Error(text || "Session update failed");
  }

  return response.json();
}

export async function summarizeSession(sessionId: string): Promise<SessionSummaryResponse> {
  const response = await apiFetch(`/api/sessions/${sessionId}/summarize`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "Session summarization failed"));
  }

  return response.json();
}

export async function getCampaignMemory(campaignId: string): Promise<CampaignMemory> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/memory`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to load campaign memory");
  }
  return response.json();
}

export async function getDocuments(campaignId: string): Promise<KnowledgeDocument[]> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/documents`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to load documents");
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
    const text = await response.text();
    throw new Error(text || "Document upload failed");
  }

  return response.json();
}

export async function ingestDocument(documentId: string): Promise<IngestDocumentResponse> {
  const response = await apiFetch(`/api/documents/${documentId}/ingest`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "Document ingestion failed"));
  }

  return response.json();
}

export async function deleteDocument(documentId: string): Promise<void> {
  const response = await apiFetch(`/api/documents/${documentId}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(await apiErrorMessage(response, "Document delete failed"));
  }
}

export async function sendChat(input: {
  campaignId: string;
  conversationId: string | null;
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
    throw new Error(await apiErrorMessage(response, "Chat request failed"));
  }

  return response.json();
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
    throw new Error(await apiErrorMessage(response, "Tool execution failed"));
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
    const text = await response.text();
    throw new Error(text || "NPC save failed");
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
    const text = await response.text();
    throw new Error(text || "Quest save failed");
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
    const text = await response.text();
    throw new Error(text || "Location save failed");
  }
  return response.json();
}

export async function saveEncounter(campaignId: string, payload: Record<string, unknown>): Promise<{ id: string; encounter: Record<string, unknown> }> {
  const response = await apiFetch(`/api/campaigns/${campaignId}/encounters`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Encounter save failed");
  }
  return response.json();
}
