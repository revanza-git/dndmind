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
  className: string;
  race: string;
  level: number;
  hpCurrent: number;
  hpMax: number;
  armorClass: number;
  notes: string | null;
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

export async function getCampaigns(): Promise<Campaign[]> {
  const response = await fetch(`${API_BASE_URL}/api/campaigns`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to load campaigns");
  }
  return response.json();
}

export async function getParty(campaignId: string): Promise<PartyCharacter[]> {
  const response = await fetch(`${API_BASE_URL}/api/campaigns/${campaignId}/party`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to load party");
  }
  return response.json();
}

export async function getSessions(campaignId: string): Promise<Session[]> {
  const response = await fetch(`${API_BASE_URL}/api/campaigns/${campaignId}/sessions`, { cache: "no-store" });
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
  const response = await fetch(`${API_BASE_URL}/api/campaigns/${input.campaignId}/sessions`, {
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
  const response = await fetch(`${API_BASE_URL}/api/sessions/${input.sessionId}`, {
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
  const response = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}/summarize`, {
    method: "POST"
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Session summarization failed");
  }

  return response.json();
}

export async function getCampaignMemory(campaignId: string): Promise<CampaignMemory> {
  const response = await fetch(`${API_BASE_URL}/api/campaigns/${campaignId}/memory`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to load campaign memory");
  }
  return response.json();
}

export async function getDocuments(campaignId: string): Promise<KnowledgeDocument[]> {
  const response = await fetch(`${API_BASE_URL}/api/campaigns/${campaignId}/documents`, { cache: "no-store" });
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
  const response = await fetch(`${API_BASE_URL}/api/campaigns/${input.campaignId}/documents/upload`, {
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
  const response = await fetch(`${API_BASE_URL}/api/documents/${documentId}/ingest`, {
    method: "POST"
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Document ingestion failed");
  }

  return response.json();
}

export async function sendChat(input: {
  campaignId: string;
  conversationId: string | null;
  message: string;
  mode: string;
  context: ChatContext;
}): Promise<ChatResponse> {
  const response = await fetch(`${API_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Chat request failed");
  }

  return response.json();
}

export async function executeTool(input: {
  campaignId: string | null;
  conversationId: string | null;
  toolName: string;
  arguments: Record<string, unknown>;
}): Promise<ToolCall> {
  const response = await fetch(`${API_BASE_URL}/api/tools/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Tool execution failed");
  }

  return response.json();
}

export async function saveNpc(campaignId: string, payload: Record<string, unknown>): Promise<{ id: string; npc: MemoryNpc }> {
  const response = await fetch(`${API_BASE_URL}/api/campaigns/${campaignId}/npcs`, {
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
  const response = await fetch(`${API_BASE_URL}/api/campaigns/${campaignId}/quests`, {
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
  const response = await fetch(`${API_BASE_URL}/api/campaigns/${campaignId}/locations`, {
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
  const response = await fetch(`${API_BASE_URL}/api/campaigns/${campaignId}/encounters`, {
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
