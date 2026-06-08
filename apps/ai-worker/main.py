import os
import json
import re
from typing import Any, Literal
from uuid import UUID

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import psycopg

from app.orchestration.gemini_provider import real_campaign_recap, real_chat_response, real_prompt_suggestion, real_session_summary
from app.orchestration.image_generation import generate_image, image_generation_enabled, image_provider
from app.orchestration.scope_guard import is_in_scope_prompt, out_of_scope_answer, out_of_scope_suggested_actions
from app.orchestration.tool_loop import detect_prompt_intent, execute_manual_tool, run_mock_tool_loop
from app.orchestration.structured_output import build_mock_structured_output, build_suggested_actions
from rag.chunker import chunk_text
from rag.embeddings import (
    embed_texts,
    embedding_model_name,
    embedding_provider,
    mock_embeddings_enabled,
    mock_llm_enabled,
    vector_literal,
)
from rag.sanitizer import MAX_UPLOAD_CHUNKS, sanitize_uploaded_text
from rag.retriever import (
    database_url,
    format_memory_context,
    format_rules_context,
    search_homebrew as retrieve_homebrew,
    search_memory as retrieve_memory,
    search_rules as retrieve_rules,
)


app = FastAPI(title="DNDMind AI Worker", version="0.1.0")


class ChatContext(BaseModel):
    useRules: bool = True
    useCampaignMemory: bool = True
    usePartyInfo: bool = True
    useHomebrew: bool = False


class Campaign(BaseModel):
    id: UUID
    name: str
    description: str | None = None
    systemTone: str = ""
    currentSessionId: UUID | None = None
    archivedAt: str | None = None


class PartyCharacter(BaseModel):
    id: UUID
    campaignId: UUID
    name: str
    className: str | None = None
    race: str | None = None
    level: int
    hpCurrent: int | None = None
    hpMax: int | None = None
    tempHp: int | None = None
    armorClass: int | None = None
    initiativeModifier: int | None = None
    passivePerception: int | None = None
    conditions: list[str] = Field(default_factory=list)
    notes: str | None = None


class ChatSession(BaseModel):
    id: UUID
    campaignId: UUID
    sessionNumber: int
    title: str
    rawNotes: str | None = None
    summary: str | None = None
    status: str = "active"


class ChatRequest(BaseModel):
    campaignId: UUID
    conversationId: UUID
    message: str
    mode: str = "Auto"
    clientOwnerId: str | None = None
    context: ChatContext
    campaign: Campaign
    party: list[PartyCharacter] = Field(default_factory=list)
    session: ChatSession | None = None


class ChatResponse(BaseModel):
    conversationId: UUID
    answer: str
    mode: str
    citations: list[dict[str, Any]] = Field(default_factory=list)
    toolCalls: list[dict[str, Any]] = Field(default_factory=list)
    structuredOutput: dict[str, Any] | None = None
    suggestedActions: list[dict[str, Any]] = Field(default_factory=list)


class SearchRequest(BaseModel):
    campaignId: UUID | None = None
    clientOwnerId: str | None = None
    query: str
    limit: int = 5


class IngestDocumentRequest(BaseModel):
    documentId: UUID
    campaignId: UUID | None = None
    sourceType: str = "rules"
    title: str
    content: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    clientOwnerId: str | None = None


class IngestDocumentResponse(BaseModel):
    documentId: UUID
    chunkCount: int
    embeddingModel: str
    mockEmbeddings: bool


class SummarizeSessionRequest(BaseModel):
    campaignId: UUID
    sessionId: UUID
    sessionNumber: int
    title: str
    rawNotes: str


class CampaignRecapRequest(BaseModel):
    campaignId: UUID
    campaignName: str
    clientOwnerId: str | None = None
    activeSessionTitle: str | None = None
    activeSessionRawNotes: str | None = None
    activeSessionSummary: str | None = None


class CampaignRecapResponse(BaseModel):
    recap: str
    citations: list[dict[str, Any]] = Field(default_factory=list)


class ExtractedNpc(BaseModel):
    name: str
    role: str | None = None
    description: str | None = None
    disposition: str | None = None


class ExtractedQuest(BaseModel):
    title: str
    status: str = "open"
    description: str | None = None


class ExtractedLocation(BaseModel):
    name: str
    locationType: str | None = None
    description: str | None = None


class ExtractedEncounter(BaseModel):
    title: str
    summary: str | None = None
    outcome: str | None = None


class SummarizeSessionResponse(BaseModel):
    summary: str
    importantEvents: list[str] = Field(default_factory=list)
    npcs: list[ExtractedNpc] = Field(default_factory=list)
    locations: list[ExtractedLocation] = Field(default_factory=list)
    quests: list[ExtractedQuest] = Field(default_factory=list)
    encounters: list[ExtractedEncounter] = Field(default_factory=list)
    items: list[str] = Field(default_factory=list)
    unresolvedHooks: list[str] = Field(default_factory=list)


class ToolExecuteRequest(BaseModel):
    campaignId: UUID | None = None
    conversationId: UUID | None = None
    toolName: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    clientOwnerId: str | None = None


class ToolExecuteResponse(BaseModel):
    toolName: str
    arguments: dict[str, Any]
    result: dict[str, Any] | None = None
    success: bool
    error: str | None = None


PromptSuggestionMode = Literal["auto", "rules", "npc", "character", "encounter", "recap", "summarize"]
ResolvedPromptSuggestionMode = Literal["rules", "npc", "character", "encounter", "recap", "summarize"]
StructuredImageOutputType = Literal["npc", "character", "encounter"]


class PromptSuggestionSession(BaseModel):
    id: UUID
    campaignId: UUID
    sessionNumber: int
    title: str
    rawNotes: str | None = None
    summary: str | None = None
    status: str = "active"


class PromptSuggestionMemory(BaseModel):
    npcs: list[dict[str, Any]] = Field(default_factory=list)
    quests: list[dict[str, Any]] = Field(default_factory=list)
    locations: list[dict[str, Any]] = Field(default_factory=list)
    encounters: list[dict[str, Any]] = Field(default_factory=list)
    events: list[dict[str, Any]] = Field(default_factory=list)
    hooks: list[dict[str, Any]] = Field(default_factory=list)


class PromptSuggestionRequest(BaseModel):
    campaignId: UUID
    sessionId: UUID | None = None
    mode: PromptSuggestionMode = "auto"
    currentInput: str | None = None
    clientOwnerId: str | None = None
    campaign: Campaign
    party: list[PartyCharacter] = Field(default_factory=list)
    session: PromptSuggestionSession | None = None
    memory: PromptSuggestionMemory = Field(default_factory=PromptSuggestionMemory)


class PromptSuggestionResponse(BaseModel):
    prompt: str
    mode: PromptSuggestionMode
    resolvedMode: ResolvedPromptSuggestionMode | None = None
    reason: str | None = None


class ImageGenerationRequest(BaseModel):
    campaignId: UUID
    conversationId: UUID | None = None
    structuredOutputType: StructuredImageOutputType
    structuredOutputData: dict[str, Any] = Field(default_factory=dict)
    stylePreset: str = "cinematic"
    clientOwnerId: str | None = None


class ImageGenerationResponse(BaseModel):
    imageUrl: str | None = None
    imageData: str | None = None
    imagePrompt: str
    provider: str
    model: str
    status: str
    error: str | None = None
    imageGeneratedAt: str | None = None
    imageStylePreset: str | None = None


@app.get("/health")
def health() -> dict[str, str | bool]:
    return {
        "status": "ok",
        "service": "ai-worker",
        "mockLlm": mock_llm_enabled(),
        "mockEmbeddings": mock_embeddings_enabled(),
        "llmProvider": os.getenv("LLM_PROVIDER", "gemini"),
        "embeddingProvider": "mock" if mock_embeddings_enabled() else embedding_provider(),
        "imageGenerationEnabled": image_generation_enabled(),
        "imageProvider": image_provider(),
    }


@app.post("/ai/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    if not is_in_scope_prompt(request.message):
        return out_of_scope_chat_response(request)

    if _is_active_session_summary_request(request):
        try:
            return active_session_summary_chat_response(request)
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=friendly_provider_error(str(exc))) from exc

    if mock_llm_enabled():
        return mock_chat_response(request)

    try:
        provider_response = real_chat_response(request)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=friendly_provider_error(str(exc))) from exc

    return ChatResponse(
        conversationId=request.conversationId,
        mode=request.mode,
        **provider_response,
    )


def out_of_scope_chat_response(request: ChatRequest) -> ChatResponse:
    return ChatResponse(
        conversationId=request.conversationId,
        answer=out_of_scope_answer(),
        mode=request.mode,
        citations=[],
        toolCalls=[],
        structuredOutput=None,
        suggestedActions=out_of_scope_suggested_actions(),
    )


def _is_active_session_summary_request(request: ChatRequest) -> bool:
    if request.session is None or not (request.session.rawNotes or "").strip():
        return False
    mode = str(request.mode or "").strip().lower()
    if mode == "summarize":
        return True
    return bool(re.search(r"\bsummar(?:y|ize|ise|izing)\b.*\bsession\b|\bsession notes?\b", request.message, re.IGNORECASE))


def active_session_summary_chat_response(request: ChatRequest) -> ChatResponse:
    session = request.session
    if session is None:
        raise RuntimeError("Active session is missing.")

    summary_request = SummarizeSessionRequest(
        campaignId=request.campaignId,
        sessionId=session.id,
        sessionNumber=session.sessionNumber,
        title=session.title,
        rawNotes=session.rawNotes or "",
    )
    summary = mock_session_summary(summary_request) if mock_llm_enabled() else SummarizeSessionResponse(**real_session_summary(summary_request))
    data = summary.model_dump()
    structured_output = {"type": "session_summary", "data": data}
    suggested_actions = build_suggested_actions(structured_output)
    answer = _format_session_summary_answer(session, summary)

    return ChatResponse(
        conversationId=request.conversationId,
        answer=answer,
        mode=request.mode,
        citations=[],
        toolCalls=[],
        structuredOutput=structured_output,
        suggestedActions=suggested_actions,
    )


def _format_session_summary_answer(session: ChatSession, summary: SummarizeSessionResponse) -> str:
    lines = [
        f"Session {session.sessionNumber}: {session.title}",
        "",
        summary.summary,
    ]
    if summary.importantEvents:
        lines.extend(["", "Important events:"])
        lines.extend(f"- {event}" for event in summary.importantEvents[:6])
    if summary.unresolvedHooks:
        lines.extend(["", "Unresolved hooks:"])
        lines.extend(f"- {hook}" for hook in summary.unresolvedHooks[:6])
    return "\n".join(lines).strip()


@app.post("/ai/tools/execute", response_model=ToolExecuteResponse)
def execute_tool_endpoint(request: ToolExecuteRequest) -> ToolExecuteResponse:
    context = {
        "campaignId": request.campaignId,
        "conversationId": request.conversationId,
        "clientOwnerId": request.clientOwnerId,
    }
    response = execute_manual_tool(request.toolName, request.arguments, context)
    return ToolExecuteResponse(**response)


@app.post("/prompt-suggestions", response_model=PromptSuggestionResponse)
def prompt_suggestions(request: PromptSuggestionRequest) -> PromptSuggestionResponse:
    if request.mode == "summarize" or (
        request.mode == "auto" and request.session and request.session.rawNotes and not request.session.summary
    ):
        return mock_prompt_suggestion(request)

    if mock_llm_enabled():
        return mock_prompt_suggestion(request)

    try:
        return PromptSuggestionResponse(**real_prompt_suggestion(request))
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=friendly_provider_error(str(exc))) from exc


@app.post("/images/generate", response_model=ImageGenerationResponse)
def generate_image_endpoint(request: ImageGenerationRequest) -> ImageGenerationResponse:
    return ImageGenerationResponse(**generate_image(request))


@app.post("/ai/ingest-document", response_model=IngestDocumentResponse)
def ingest_document(request: IngestDocumentRequest) -> IngestDocumentResponse:
    sanitized_content = sanitize_uploaded_text(request.content)
    if not sanitized_content:
        raise HTTPException(status_code=400, detail="That document is empty after safety cleanup. Add plain-text notes and try again.")

    chunks = chunk_text(sanitized_content)[:MAX_UPLOAD_CHUNKS]
    try:
        embeddings = embed_texts([chunk.content for chunk in chunks]) if chunks else []
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=friendly_provider_error(str(exc))) from exc
    embedding_model = "mock" if mock_embeddings_enabled() else embedding_model_name()

    client_owner_id = request.clientOwnerId or request.metadata.get("clientOwnerId")

    with psycopg.connect(database_url()) as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM knowledge_chunks WHERE document_id = %s", (request.documentId,))
            for chunk, embedding in zip(chunks, embeddings):
                cur.execute(
                    """
                    INSERT INTO knowledge_chunks
                      (document_id, campaign_id, source_type, chunk_index, heading, content, token_count, embedding, metadata)
                    VALUES
                      (%s, %s, %s, %s, %s, %s, %s, %s::vector, %s::jsonb)
                    """,
                    (
                        request.documentId,
                        request.campaignId,
                        request.sourceType,
                        chunk.chunk_index,
                        chunk.heading,
                        chunk.content,
                        chunk.token_count,
                        vector_literal(embedding),
                        json.dumps(
                            chunk.metadata
                            | {"embeddingModel": embedding_model}
                            | ({"clientOwnerId": client_owner_id} if client_owner_id else {})
                        ),
                    ),
                )

            cur.execute(
                """
                UPDATE knowledge_documents
                SET metadata = metadata || %s::jsonb
                WHERE id = %s
                """,
                (
                    json.dumps(
                        {
                            "status": "ingested",
                            "chunkCount": len(chunks),
                            "embeddingModel": embedding_model,
                            "mockEmbeddings": mock_embeddings_enabled(),
                            **({"clientOwnerId": client_owner_id} if client_owner_id else {}),
                        }
                    ),
                    request.documentId,
                ),
            )
        conn.commit()

    return IngestDocumentResponse(
        documentId=request.documentId,
        chunkCount=len(chunks),
        embeddingModel=embedding_model,
        mockEmbeddings=mock_embeddings_enabled(),
    )


@app.post("/ai/summarize-session", response_model=SummarizeSessionResponse)
def summarize_session(request: SummarizeSessionRequest) -> SummarizeSessionResponse:
    if mock_llm_enabled():
        return mock_session_summary(request)

    try:
        return SummarizeSessionResponse(**real_session_summary(request))
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=friendly_provider_error(str(exc))) from exc


@app.post("/ai/campaign-recap", response_model=CampaignRecapResponse)
def campaign_recap(request: CampaignRecapRequest) -> CampaignRecapResponse:
    rows = retrieve_memory(
        request.campaignId,
        _campaign_recap_query(request),
        8,
        request.clientOwnerId,
    )
    context_text = format_memory_context(rows)
    citations = [row["citation"] for row in rows if row.get("citation")]

    if mock_llm_enabled():
        return mock_campaign_recap(request, context_text, citations)

    try:
        return CampaignRecapResponse(**real_campaign_recap(request, context_text, citations))
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=friendly_provider_error(str(exc))) from exc


@app.post("/ai/search-rules")
def search_rules(request: SearchRequest) -> dict[str, Any]:
    rows = retrieve_rules(request.campaignId, request.query, request.limit)
    return {
        "query": request.query,
        "results": [
            {
                "chunkId": str(row["chunk_id"]),
                "documentId": str(row["document_id"]),
                "title": row["title"],
                "sourceType": row.get("source_type"),
                "heading": row.get("heading"),
                "content": row["content"],
                "score": row.get("score"),
                "citation": row["citation"],
            }
            for row in rows
        ],
    }


@app.post("/ai/search-homebrew")
def search_homebrew(request: SearchRequest) -> dict[str, Any]:
    rows = retrieve_homebrew(request.campaignId, request.query, request.limit)
    return {
        "query": request.query,
        "results": [
            {
                "chunkId": str(row["chunk_id"]),
                "documentId": str(row["document_id"]),
                "title": row["title"],
                "sourceType": row.get("source_type"),
                "heading": row.get("heading"),
                "content": row["content"],
                "score": row.get("score"),
                "citation": row["citation"],
            }
            for row in rows
        ],
    }


@app.post("/ai/search-memory")
def search_memory(request: SearchRequest) -> dict[str, Any]:
    if request.campaignId is None:
        return {"campaignId": None, "query": request.query, "results": []}

    rows = retrieve_memory(request.campaignId, request.query, request.limit, request.clientOwnerId)
    return {
        "campaignId": request.campaignId,
        "query": request.query,
        "results": [
            {
                "chunkId": str(row["chunk_id"]),
                "documentId": str(row["document_id"]),
                "title": row["title"],
                "sourceType": row.get("source_type"),
                "heading": row.get("heading"),
                "content": row["content"],
                "score": row.get("score"),
                "citation": row["citation"],
            }
            for row in rows
        ],
    }


def mock_chat_response(request: ChatRequest) -> ChatResponse:
    enabled_context = []
    if request.context.useRules:
        enabled_context.append("rules")
    if request.context.useCampaignMemory:
        enabled_context.append("campaign memory")
    if request.context.usePartyInfo:
        enabled_context.append("party info")
    if request.context.useHomebrew:
        enabled_context.append("homebrew")

    party_line = None
    if request.context.usePartyInfo:
        party_line = "No party members are registered yet."
    if request.context.usePartyInfo and request.party:
        party_line = ", ".join(
            _format_party_member(pc)
            for pc in request.party
        )

    tool_calls, citations, structured_output = run_mock_tool_loop(request)
    structured_output = build_mock_structured_output(request, tool_calls) or structured_output
    suggested_actions = build_suggested_actions(structured_output)
    tool_section = _format_tool_section(tool_calls)
    structured_section = _format_structured_section(structured_output)
    party_section = f"Party snapshot: {party_line}.\n\n" if party_line is not None else ""
    tone_section = _format_campaign_tone_section(request)

    answer = (
        f"Mode: {request.mode}. For {request.campaign.name}, I would handle this as a DM co-pilot request: "
        f"'{request.message}'.\n\n"
        f"{tone_section}"
        f"Available context: {', '.join(enabled_context) if enabled_context else 'none'}.\n"
        f"{party_section}"
        "Confirmed memory and rules results are treated as established context. Creative suggestions should build on them without replacing them."
        f"{tool_section}"
        f"{structured_section}"
    )

    return ChatResponse(
        conversationId=request.conversationId,
        answer=answer,
        mode=request.mode,
        citations=citations,
        toolCalls=tool_calls,
        structuredOutput=structured_output,
        suggestedActions=suggested_actions,
    )


def mock_prompt_suggestion(request: PromptSuggestionRequest) -> PromptSuggestionResponse:
    resolved_mode, reason = _resolve_prompt_suggestion_mode(request)
    prompt = _build_prompt_suggestion(request, resolved_mode)
    return PromptSuggestionResponse(
        prompt=prompt,
        mode=request.mode,
        resolvedMode=resolved_mode if request.mode == "auto" else None,
        reason=reason,
    )


def _resolve_prompt_suggestion_mode(request: PromptSuggestionRequest) -> tuple[ResolvedPromptSuggestionMode, str]:
    if request.mode != "auto":
        return request.mode, f"Using the selected {request.mode} hint."

    current = str(request.currentInput or "").lower()
    current_intent = detect_prompt_intent(current)
    if re.search(r"\b(rule|ruling|spell|advantage|check|action|bonus action|reaction|saving throw)\b", current):
        return "rules", "The current draft looks like a rules or ruling question."
    if "character" in current_intent.detected or re.search(r"\b(playable character|player character|backup character|backup pc|hireling|retainer|rival adventurer|level \d+ .*(?:ranger|cleric|fighter|wizard|rogue|bard|paladin|druid|barbarian|monk|warlock|sorcerer|artificer))\b", current):
        return "character", "The current draft asks for a playable or near-playable character."
    if "npc" in current_intent.detected or re.search(r"\b(npc|villain|ally|informant|shopkeeper|patron)\b", current):
        return "npc", "The current draft asks for a character."
    if re.search(r"\b(encounter|combat|monster|ambush|fight|battle)\b", current):
        return "encounter", "The current draft points toward an encounter."
    if re.search(r"\b(what happened so far|previously|campaign recap|recap so far)\b", current):
        return "recap", "The current draft asks for a campaign recap."
    if re.search(r"\b(summary|summarize|session notes|hooks?)\b", current):
        return "summarize", "The current draft points toward session summarization."

    session_text = " ".join(
        value
        for value in [
            request.session.title if request.session else "",
            request.session.rawNotes if request.session else "",
            request.session.summary if request.session else "",
        ]
        if value
    )
    if request.session and request.session.rawNotes and not request.session.summary:
        return "summarize", "The active session has notes that are not summarized yet."
    if request.party and (_memory_count(request.memory, "hooks") or _memory_count(request.memory, "events") or _memory_count(request.memory, "quests") or _memory_count(request.memory, "locations")):
        return "encounter", "Party details and campaign hooks are available for a table-ready encounter."
    if _memory_count(request.memory, "npcs") == 0:
        return "npc", "No saved NPCs are available yet, so an NPC draft is useful."
    if re.search(r"\b(last session|previously|what happened|betray|escaped|mystery|unknown)\b", session_text, re.IGNORECASE):
        return "recap", "The active campaign context has story continuity worth recapping."
    return "rules", "Defaulting to a useful ruling prompt when no stronger table-prep cue is present."


def _build_prompt_suggestion(request: PromptSuggestionRequest, mode: ResolvedPromptSuggestionMode) -> str:
    campaign_name = request.campaign.name.strip() or "this campaign"
    tone = request.campaign.systemTone.strip() or "DNDMind's default practical table style"
    party = _prompt_party_summary(request.party)
    session = _prompt_session_summary(request.session)
    memory = _prompt_memory_summary(request.memory)
    current = _compact_for_prompt(request.currentInput, 220)
    current_line = f" Build from this rough draft if useful: {current}" if current else ""

    if mode == "rules":
        return (
            f"For {campaign_name}, draft a concise D&D rules/ruling question for the table. "
            f"Use the campaign tone as style only: {tone}. Ask for the likely ruling, edge cases, and a fast DM call. "
            f"Context: {session} {party}{current_line}"
        ).strip()
    if mode == "npc":
        return (
            f"Create a memorable NPC for {campaign_name} who can matter in the next scene. "
            f"Use tone: {tone}. Include name, role, motive, secret, connection to the party, and one actionable quest hook. "
            f"Campaign context: {memory} {session}{current_line}"
        ).strip()
    if mode == "character":
        return (
            f"Generate a playable or near-playable character for {campaign_name}. "
            f"Use tone: {tone}. Include name, ancestry/species, class/subclass, level, background, role, ability scores or stat summary, "
            f"personality traits, ideals/bonds/flaws, equipment, campaign tie-in, and a secret or hook. "
            f"The character can be a backup PC, rival adventurer, hireling, or table-ready ally. Context: {party} {memory} {session}{current_line}"
        ).strip()
    if mode == "encounter":
        return (
            f"Create a table-ready encounter for {campaign_name}. "
            f"Use tone: {tone}. Include difficulty, environment, monsters or opposition, tactics, scaling options, rewards, and campaign hooks. "
            f"Party/context: {party} {memory} {session}{current_line}"
        ).strip()
    if mode == "recap":
        return (
            f"Narrate what has happened so far in {campaign_name} as a table-ready recap. "
            "Use saved campaign memory first, then the active session context if relevant. "
            "Include concrete names, places, quests, and unresolved hooks, but do not invent missing facts. "
            f"Use tone as style only: {tone}. Campaign context: {memory} {session}{current_line}"
        ).strip()
    return (
        f"Summarize the active session for {campaign_name}. "
        "Extract important events, NPC updates, locations, quests, encounters, items, and unresolved hooks without inventing facts. "
        f"Use tone as style only: {tone}. Session context: {session}{current_line}"
    ).strip()


def _prompt_party_summary(party: list[PartyCharacter]) -> str:
    if not party:
        return "No party details are registered."
    return "Party: " + "; ".join(_format_party_member(member) for member in party[:6]) + "."


def _prompt_session_summary(session: PromptSuggestionSession | None) -> str:
    if session is None:
        return "No active session is selected."
    notes = _compact_for_prompt(session.summary or session.rawNotes, 180)
    detail = f" Notes: {notes}" if notes else ""
    return f"Session {session.sessionNumber}, {session.title}.{detail}"


def _prompt_memory_summary(memory: PromptSuggestionMemory) -> str:
    parts = []
    for label, key in [("NPCs", "npcs"), ("quests", "quests"), ("locations", "locations"), ("encounters", "encounters"), ("hooks", "hooks"), ("events", "events")]:
        names = [_memory_label(item) for item in getattr(memory, key)[:3]]
        if names:
            parts.append(f"{label}: {', '.join(names)}")
    return "; ".join(parts) + "." if parts else "No saved campaign memory yet."


def _memory_label(item: dict[str, Any]) -> str:
    return str(item.get("name") or item.get("title") or item.get("summary") or item.get("eventType") or "memory item")


def _memory_count(memory: PromptSuggestionMemory, key: str) -> int:
    return len(getattr(memory, key, []))


def _compact_for_prompt(value: str | None, max_length: int) -> str:
    if not value:
        return ""
    compact = re.sub(r"\s+", " ", value).strip()
    return compact if len(compact) <= max_length else compact[:max_length].rstrip() + "..."


def _format_campaign_tone_section(request: ChatRequest) -> str:
    tone = str(getattr(request.campaign, "systemTone", "") or "").strip()
    if not tone:
        return "Campaign response tone: default DNDMind style.\n"
    return (
        f"Campaign response tone: {tone}. "
        "Use this as style only; scope, safety, facts, citations, tools, selected mode, and structured output requirements still take priority.\n"
    )


def _format_party_member(pc: PartyCharacter) -> str:
    ancestry = f" {pc.race}" if pc.race else ""
    class_name = f" {pc.className}" if pc.className else ""
    hp = ""
    if pc.hpCurrent is not None and pc.hpMax is not None:
        hp = f", HP {pc.hpCurrent}/{pc.hpMax}"
        if pc.tempHp:
            hp += f" +{pc.tempHp} temp"
    ac = f", AC {pc.armorClass}" if pc.armorClass is not None else ""
    notes = f", notes: {pc.notes}" if pc.notes else ""
    return f"{pc.name} level {pc.level}{ancestry}{class_name}{hp}{ac}{notes}"


def _format_tool_section(tool_calls: list[dict[str, Any]]) -> str:
    if not tool_calls:
        return "\n\nNo tool was needed. I can answer directly or use rules, memory, dice, initiative, and encounter tools when useful."

    sections = ["\n\nTool results:"]
    for call in tool_calls:
        if not call.get("success"):
            sections.append(f"- {call['toolName']} failed: {call.get('error')}")
            continue
        result = call.get("result") or {}
        name = call["toolName"]
        if name == "rollDice":
            modifier = result.get("modifier", 0)
            sections.append(
                f"- Rolled {result.get('expression')}: rolls {result.get('rolls')} "
                f"{modifier:+d} = {result.get('total')}."
            )
        elif name == "generateInitiativeOrder":
            order = ", ".join(f"{entry['name']} ({entry['total']})" for entry in result.get("order", []))
            sections.append(f"- Initiative order: {order}.")
        elif name == "calculateEncounterDifficulty":
            sections.append(
                f"- Encounter difficulty: {result.get('difficulty')} "
                f"({result.get('adjustedXp')} adjusted XP). {result.get('explanation')}"
            )
        elif name in {"searchRules", "searchHomebrew", "searchCampaignMemory"}:
            labels = {
                "searchRules": "rules",
                "searchHomebrew": "homebrew",
                "searchCampaignMemory": "campaign memory",
            }
            label = labels[name]
            rows = result.get("results") or []
            if rows:
                context = "\n\n".join(
                    f"[{index}] {row.get('title')} - {row.get('heading')}\n{row.get('content')}"
                    for index, row in enumerate(rows, start=1)
                )
                sections.append(f"- Retrieved {label}:\n{context}")
            else:
                sections.append(f"- Retrieved {label}: no matching chunks found.")
        else:
            sections.append(f"- {name}: {json.dumps(result, default=str)}")

    sections.append("\nCreative suggestions: ask one follow-up if context is ambiguous, then offer a table-ready next beat.")
    return "\n".join(sections)


def _format_structured_section(structured_output: dict[str, Any] | None) -> str:
    if not structured_output:
        return ""
    output_type = structured_output.get("type", "card").replace("_", " ")
    data = structured_output.get("data") or {}
    title = data.get("name") or data.get("title") or data.get("expression") or "Structured result"
    return f"\n\nStructured card: {output_type.title()} - {title}."


def friendly_provider_error(message: str) -> str:
    lower = message.lower()
    if "high demand" in lower or "503" in lower or "service unavailable" in lower:
        return (
            "The AI is busy right now and could not finish. Please try again in a moment."
        )
    if "api_key" in lower or "api key" in lower:
        return "The AI service is not connected correctly. Ask the app admin to check the setup."
    if "429" in lower or "quota" in lower or "rate limit" in lower:
        return "The AI is getting too many requests right now. Please wait a moment, then try again."
    if "adc" in lower or "application default credentials" in lower or "google-auth" in lower:
        return "Vertex AI is not connected correctly. Ask the app admin to check the ADC setup."
    if "embedding dimensions" in lower or "database expects" in lower or "pgvector schema" in lower:
        return (
            "Campaign knowledge is not set up correctly. Ask the app admin to check the knowledge setup."
        )
    return "DNDMind could not get an AI response just now. Please try again in a moment."


def mock_session_summary(request: SummarizeSessionRequest) -> SummarizeSessionResponse:
    notes = " ".join(request.rawNotes.split())
    sentences = [sentence.strip() for sentence in re.split(r"(?<=[.!?])\s+", notes) if sentence.strip()]
    important = [sentence for sentence in sentences if _is_important(sentence)]
    betrayal = [sentence for sentence in sentences if re.search(r"\bbetray\w*\b", sentence, re.IGNORECASE)]
    important = _unique(betrayal + important)[:8]

    npcs = _extract_npcs(notes)
    locations = _extract_locations(notes)
    quests = _extract_quests(notes)
    encounters = _extract_encounters(sentences)
    items = _extract_items(notes)
    hooks = _extract_hooks(sentences)

    if betrayal:
        hooks.insert(0, "Resolve the fallout from the betrayal and decide who still trusts the party.")

    summary_basis = important[:3] if important else sentences[:3]
    summary = (
        f"Session {request.sessionNumber}: {request.title}. "
        + (" ".join(summary_basis) if summary_basis else "No substantial notes were provided.")
    )

    return SummarizeSessionResponse(
        summary=summary,
        importantEvents=important,
        npcs=npcs,
        locations=locations,
        quests=quests,
        encounters=encounters,
        items=items,
        unresolvedHooks=_unique(hooks)[:8],
    )


def mock_campaign_recap(request: CampaignRecapRequest, context_text: str, citations: list[dict[str, Any]]) -> CampaignRecapResponse:
    memory_lines = _memory_lines_from_context(context_text)
    active_notes = " ".join(
        value.strip()
        for value in [request.activeSessionSummary or "", request.activeSessionRawNotes or ""]
        if value and value.strip()
    )
    active_sentences = [
        sentence.strip()
        for sentence in re.split(r"(?<=[.!?])\s+", active_notes)
        if sentence.strip()
    ][:3]

    if not memory_lines and not active_sentences:
        recap = (
            f"Previously in {request.campaignName}, there is not enough saved campaign memory yet "
            "to narrate a reliable recap. Summarize a session or save campaign memory first."
        )
    else:
        beats = _unique(memory_lines[:5] + active_sentences)
        recap = f"Previously in {request.campaignName}: " + " ".join(beats)
        if not recap.endswith((".", "!", "?")):
            recap += "."

    return CampaignRecapResponse(recap=recap, citations=citations)


def _campaign_recap_query(request: CampaignRecapRequest) -> str:
    parts = [
        "campaign recap what happened so far important events unresolved hooks quests NPC locations betray last session previous session",
        request.activeSessionTitle or "",
        request.activeSessionSummary or "",
        request.activeSessionRawNotes or "",
    ]
    return " ".join(part for part in parts if part).strip()


def _memory_lines_from_context(context_text: str) -> list[str]:
    lines = []
    for line in context_text.splitlines():
        cleaned = line.strip()
        if not cleaned or cleaned.startswith("[") or cleaned.startswith("#"):
            continue
        if cleaned.startswith("##"):
            continue
        lines.append(cleaned.removeprefix("- ").strip())
    return _unique(lines)


def _is_important(sentence: str) -> bool:
    return bool(
        re.search(
            r"\b(betray\w*|revealed|discovered|accepted|completed|failed|killed|escaped|promised|stole|ambushed|defeated)\b",
            sentence,
            re.IGNORECASE,
        )
    )


def _extract_npcs(notes: str) -> list[ExtractedNpc]:
    names = re.findall(
        r"\b(?:NPC|Captain|Mayor|Lord|Lady|Baron|Baroness|Priest|Keeper|Agent|Scout|Mage|Wizard|Rogue|Guard|Innkeeper)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)",
        notes,
    )
    for betrayed_name in re.findall(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+betray\w*\b", notes):
        names.append(betrayed_name)

    npcs = []
    for name in _unique_names(names)[:10]:
        nearby = _sentence_with(notes, name)
        disposition = "hostile" if re.search(r"\bbetray\w*|enemy|hostile\b", nearby, re.IGNORECASE) else "unknown"
        npcs.append(ExtractedNpc(name=name, role="NPC", description=nearby or None, disposition=disposition))
    return npcs


def _extract_locations(notes: str) -> list[ExtractedLocation]:
    matches = re.findall(
        r"\b(?:at|in|inside|near|under|from)\s+(?:the\s+)?([A-Z][A-Za-z]*(?:\s+(?:of|[A-Z][A-Za-z]*))*)",
        notes,
    )
    locations = []
    for name in _unique(match.strip(".,") for match in matches if len(match) > 2)[:10]:
        locations.append(ExtractedLocation(name=name, locationType="site", description=_sentence_with(notes, name) or None))
    return locations


def _extract_quests(notes: str) -> list[ExtractedQuest]:
    quests = []
    patterns = [
        r"\bquest(?:\s+to)?\s+([^.;]+)",
        r"\bpromised to\s+([^.;]+)",
        r"\bmust\s+([^.;]+)",
        r"\bneed to\s+([^.;]+)",
    ]
    for pattern in patterns:
        for match in re.findall(pattern, notes, re.IGNORECASE):
            title = match.strip().rstrip(".")
            if title:
                quests.append(ExtractedQuest(title=title[:80].capitalize(), status="open", description=title))
    return quests[:8]


def _extract_encounters(sentences: list[str]) -> list[ExtractedEncounter]:
    encounters = []
    for sentence in sentences:
        if re.search(r"\b(fought|ambushed|defeated|escaped|combat|battle)\b", sentence, re.IGNORECASE):
            encounters.append(ExtractedEncounter(title=sentence[:60], summary=sentence, outcome="resolved"))
    return encounters[:6]


def _extract_items(notes: str) -> list[str]:
    items = re.findall(r"\b(?:found|took|stole|recovered|received)\s+(?:the\s+)?([^.;]+)", notes, re.IGNORECASE)
    return _unique(item.strip()[:80] for item in items)[:8]


def _extract_hooks(sentences: list[str]) -> list[str]:
    return [
        sentence
        for sentence in sentences
        if re.search(r"\b(unresolved|mystery|unknown|escaped|missing|owed|debt|next|hook)\b", sentence, re.IGNORECASE)
    ]


def _sentence_with(text: str, needle: str) -> str:
    for sentence in re.split(r"(?<=[.!?])\s+", text):
        if needle in sentence:
            return sentence.strip()
    return ""


def _unique(values: list[str] | Any) -> list[Any]:
    seen = set()
    result = []
    for value in values:
        key = value if isinstance(value, str) else repr(value)
        if key and key not in seen:
            seen.add(key)
            result.append(value)
    return result


def _unique_names(names: list[str]) -> list[str]:
    cleaned = _unique([name.strip() for name in names if name.strip()])
    result = []
    for name in cleaned:
        if any(other != name and other.endswith(f" {name}") for other in cleaned):
            continue
        result.append(name)
    return result
