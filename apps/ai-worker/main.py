import os
import json
import re
from typing import Any
from uuid import UUID

from fastapi import FastAPI
from pydantic import BaseModel, Field
import psycopg

from app.orchestration.tool_loop import execute_manual_tool, provider_tooling_note, run_mock_tool_loop
from app.orchestration.structured_output import build_mock_structured_output, build_suggested_actions
from rag.chunker import chunk_text
from rag.embeddings import embed_texts, mock_embeddings_enabled, mock_llm_enabled, vector_literal
from rag.retriever import (
    database_url,
    format_memory_context,
    format_rules_context,
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
    systemTone: str
    currentSessionId: UUID | None = None


class PartyCharacter(BaseModel):
    id: UUID
    campaignId: UUID
    name: str
    className: str
    race: str
    level: int
    hpCurrent: int
    hpMax: int
    armorClass: int
    notes: str | None = None


class ChatRequest(BaseModel):
    campaignId: UUID
    conversationId: UUID
    message: str
    mode: str = "Auto"
    context: ChatContext
    campaign: Campaign
    party: list[PartyCharacter] = Field(default_factory=list)


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
    query: str
    limit: int = 5


class IngestDocumentRequest(BaseModel):
    documentId: UUID
    campaignId: UUID | None = None
    sourceType: str = "rules"
    title: str
    content: str
    metadata: dict[str, Any] = Field(default_factory=dict)


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


class ToolExecuteResponse(BaseModel):
    toolName: str
    arguments: dict[str, Any]
    result: dict[str, Any] | None = None
    success: bool
    error: str | None = None


@app.get("/health")
def health() -> dict[str, str | bool]:
    return {
        "status": "ok",
        "service": "ai-worker",
        "mockLlm": mock_llm_enabled(),
        "mockEmbeddings": mock_embeddings_enabled(),
    }


@app.post("/ai/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    if mock_llm_enabled():
        return mock_chat_response(request)

    # Real provider orchestration belongs here. The API keys stay in environment
    # variables, and this branch is intentionally disabled for the MVP demo path.
    return ChatResponse(
        conversationId=request.conversationId,
        answer=(
            "Real LLM mode is configured but no provider client has been wired yet. "
            "Set MOCK_LLM=true for local demos, or implement the provider adapter next. "
            f"Prepared tool schemas: {len(provider_tooling_note()['toolSchemas'])}."
        ),
        mode=request.mode,
        citations=[],
        toolCalls=[],
        structuredOutput=None,
        suggestedActions=[
            {"label": "Switch Mock Mode", "action": "operatorNote", "payload": {"env": "MOCK_LLM=true"}},
            {"label": "Add Provider Adapter", "action": "operatorNote", "payload": {"next": "provider_adapter"}},
        ],
    )


@app.post("/ai/tools/execute", response_model=ToolExecuteResponse)
def execute_tool_endpoint(request: ToolExecuteRequest) -> ToolExecuteResponse:
    context = {
        "campaignId": request.campaignId,
        "conversationId": request.conversationId,
    }
    response = execute_manual_tool(request.toolName, request.arguments, context)
    return ToolExecuteResponse(**response)


@app.post("/ai/ingest-document", response_model=IngestDocumentResponse)
def ingest_document(request: IngestDocumentRequest) -> IngestDocumentResponse:
    chunks = chunk_text(request.content)
    embeddings = embed_texts([chunk.content for chunk in chunks]) if chunks else []
    embedding_model = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")

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
                        json.dumps(chunk.metadata | {"embeddingModel": embedding_model}),
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

    return SummarizeSessionResponse(
        summary=(
            "Real LLM summarization is not wired yet. Set MOCK_LLM=true for local summaries "
            "or add a provider adapter for structured session extraction."
        ),
        importantEvents=[],
        unresolvedHooks=["Implement real summarization provider adapter."],
    )


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

    rows = retrieve_memory(request.campaignId, request.query, request.limit)
    return {
        "campaignId": request.campaignId,
        "query": request.query,
        "results": [
            {
                "chunkId": str(row["chunk_id"]),
                "documentId": str(row["document_id"]),
                "title": row["title"],
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

    party_line = "No party members are registered yet."
    if request.party:
        party_line = ", ".join(
            f"{pc.name} the level {pc.level} {pc.race} {pc.className}"
            for pc in request.party
        )

    tool_calls, citations, structured_output = run_mock_tool_loop(request)
    structured_output = build_mock_structured_output(request, tool_calls) or structured_output
    suggested_actions = build_suggested_actions(structured_output)
    tool_section = _format_tool_section(tool_calls)
    structured_section = _format_structured_section(structured_output)

    answer = (
        f"Mode: {request.mode}. For {request.campaign.name}, I would handle this as a DM co-pilot request: "
        f"'{request.message}'.\n\n"
        f"Available context: {', '.join(enabled_context) if enabled_context else 'none'}.\n"
        f"Party snapshot: {party_line}.\n\n"
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
        elif name in {"searchRules", "searchCampaignMemory"}:
            label = "rules" if name == "searchRules" else "campaign memory"
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
