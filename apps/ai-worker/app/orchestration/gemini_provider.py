import json
import os
import re
from typing import Any
from urllib.parse import quote

import httpx
from pydantic import ValidationError

from app.orchestration.structured_output import build_suggested_actions
from app.orchestration.tool_loop import detect_prompt_intent, prompt_conflicts_with_mode, run_provider_tool_loop, selected_mode_intent
from app.schemas.structured_outputs import (
    DiceRollOutput,
    CharacterOutput,
    EncounterOutput,
    InitiativeOrderOutput,
    LocationOutput,
    NpcOutput,
    QuestOutput,
    SessionSummaryOutput,
    StructuredOutput,
    SuggestedAction,
)
from app.tools.encounters import calculate_encounter_difficulty
from rag.retriever import search_homebrew, search_memory, search_rules


STRUCTURED_MODELS = {
    "npc": NpcOutput,
    "character": CharacterOutput,
    "quest": QuestOutput,
    "location": LocationOutput,
    "encounter": EncounterOutput,
    "session_summary": SessionSummaryOutput,
    "initiative_order": InitiativeOrderOutput,
    "dice_roll": DiceRollOutput,
}

_KNOWN_MONSTERS: tuple[tuple[str, str, int], ...] = (
    ("Cult Fanatic", "spellcasting leader", 450),
    ("Bandit Captain", "battlefield leader", 450),
    ("Bugbear", "ambush bruiser", 200),
    ("Hobgoblin", "disciplined soldier", 100),
    ("Gnoll", "feral striker", 100),
    ("Orc", "bruiser", 100),
    ("Thug", "melee enforcer", 100),
    ("Scout", "ranged skirmisher", 100),
    ("Goblin", "mobile skirmisher", 50),
    ("Skeleton", "front-line minion", 50),
    ("Zombie", "durable minion", 50),
    ("Wolf", "pack harrier", 50),
    ("Kobold", "trap skirmisher", 25),
    ("Cultist", "fanatic striker", 25),
    ("Bandit", "mobile skirmisher", 25),
    ("Guard", "trained defender", 25),
    ("Ogre", "heavy brute", 450),
    ("Dragon", "solo boss", 1800),
)

_COUNT_WORDS = {
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
}


def real_chat_response(request: Any) -> dict[str, Any]:
    _ensure_gemini_provider()

    retrieved_context, retrieved_citations = _retrieve_context(request)
    tool_calls, tool_citations = run_provider_tool_loop(request)
    model_payload = _call_gemini(request, retrieved_context, tool_calls)

    structured_output = _normalize_structured_output(model_payload.get("structuredOutput"))
    structured_output = _filter_structured_output_for_mode(request, structured_output)
    suggested_actions = _normalize_suggested_actions(model_payload.get("suggestedActions"))
    answer = str(model_payload.get("answer") or "").strip()
    if not answer:
        answer = "Gemini returned an empty answer. Try rephrasing the request or checking the model configuration."
    used_structured_fallback = False
    if structured_output is None:
        structured_output = _fallback_structured_output(request, answer, model_payload.get("structuredOutput"), tool_calls)
        structured_output = _filter_structured_output_for_mode(request, structured_output)
        used_structured_fallback = structured_output is not None
    if structured_output and (used_structured_fallback or not suggested_actions):
        suggested_actions = build_suggested_actions(structured_output)

    return {
        "answer": answer,
        "citations": _dedupe_citations(retrieved_citations + tool_citations),
        "toolCalls": tool_calls,
        "structuredOutput": structured_output,
        "suggestedActions": suggested_actions,
    }


def _filter_structured_output_for_mode(request: Any, structured_output: dict[str, Any] | None) -> dict[str, Any] | None:
    if not structured_output:
        return None
    output_type = str(structured_output.get("type") or "").strip()
    mode = str(getattr(request, "mode", "") or "").strip().lower()
    intent = detect_prompt_intent(str(getattr(request, "message", "") or ""))
    if mode == "summarize" or "summarize" in intent.detected:
        return structured_output if output_type == "session_summary" else None
    if mode == "recap" or "recap" in intent.detected:
        return None
    requested_type = _requested_structured_type(request)
    if requested_type in {"npc", "character", "encounter"} and output_type != requested_type:
        return None
    if prompt_conflicts_with_mode(intent, mode) and output_type in {"npc", "character", "encounter"}:
        return None
    return structured_output


def real_session_summary(request: Any) -> dict[str, Any]:
    _ensure_gemini_provider()

    payload = {
        "campaignId": str(request.campaignId),
        "sessionId": str(request.sessionId),
        "sessionNumber": request.sessionNumber,
        "title": request.title,
        "rawNotes": request.rawNotes,
    }
    model_payload = _generate_json(
        _summary_system_instruction(),
        (
            "Extract a durable campaign session summary from these notes. "
            "Return only one JSON object matching the requested keys.\n\n"
            f"{json.dumps(payload, default=str)}"
        ),
    )
    if not model_payload:
        model_payload = {"summary": "Gemini returned an empty summary.", "unresolvedHooks": []}

    return _normalize_session_summary(model_payload)


def real_campaign_recap(request: Any, context_text: str, citations: list[dict[str, Any]]) -> dict[str, Any]:
    _ensure_gemini_provider()

    payload = {
        "campaignId": str(request.campaignId),
        "campaignName": request.campaignName,
        "activeSession": {
            "title": request.activeSessionTitle,
            "rawNotes": request.activeSessionRawNotes,
            "summary": request.activeSessionSummary,
        },
        "retrievedCampaignMemory": context_text,
    }
    model_payload = _generate_json(
        _campaign_recap_system_instruction(),
        (
            "Narrate what has happened so far in this campaign from the supplied memory. "
            "Return only one JSON object matching the requested keys.\n\n"
            f"{json.dumps(payload, default=str)}"
        ),
    )
    recap = str((model_payload or {}).get("recap") or (model_payload or {}).get("answer") or "").strip()
    if not recap:
        recap = (
            f"Previously in {request.campaignName}, there is not enough saved campaign memory yet "
            "to narrate a reliable recap."
        )
    return {"recap": recap, "citations": _dedupe_citations(citations)}


def real_prompt_suggestion(request: Any) -> dict[str, Any]:
    _ensure_gemini_provider()

    model_payload = _generate_json(_prompt_suggestion_system_instruction(), _prompt_suggestion_user_prompt(request)) or {}
    prompt = str(model_payload.get("prompt") or "").strip()
    if not prompt:
        prompt = "Draft a concise D&D table prompt using the selected campaign context."

    requested_mode = _normalize_prompt_suggestion_mode(getattr(request, "mode", "auto")) or "auto"
    resolved_mode = model_payload.get("resolvedMode")
    resolved_mode = _normalize_prompt_suggestion_mode(resolved_mode) if resolved_mode is not None else None
    if resolved_mode == "auto":
        resolved_mode = None
    if requested_mode != "auto":
        resolved_mode = None

    reason = model_payload.get("reason")
    return {
        "prompt": prompt,
        "mode": requested_mode,
        "resolvedMode": resolved_mode,
        "reason": str(reason).strip() if reason else None,
    }


def _ensure_gemini_provider() -> None:
    provider = os.getenv("LLM_PROVIDER", "gemini").lower()
    if provider not in {"gemini", "vertex"}:
        raise RuntimeError(
            f"Unsupported LLM_PROVIDER '{provider}'. Set LLM_PROVIDER=gemini for Gemini API-key mode "
            "or LLM_PROVIDER=vertex for Vertex AI ADC mode."
        )


def _call_gemini(request: Any, retrieved_context: str, tool_calls: list[dict[str, Any]]) -> dict[str, Any]:
    parsed = _generate_json(_system_instruction(), _user_prompt(request, retrieved_context, tool_calls))
    return parsed or {}


def _generate_json(system_instruction: str, user_prompt: str) -> dict[str, Any] | None:
    provider = os.getenv("LLM_PROVIDER", "gemini").lower()
    if provider == "vertex":
        return _generate_json_vertex(system_instruction, user_prompt)
    if provider == "gemini":
        return _generate_json_gemini_api_key(system_instruction, user_prompt)
    raise RuntimeError(
        f"Unsupported LLM_PROVIDER '{provider}'. Set LLM_PROVIDER=gemini for Gemini API-key mode "
        "or LLM_PROVIDER=vertex for Vertex AI ADC mode."
    )


def _generate_json_gemini_api_key(system_instruction: str, user_prompt: str) -> dict[str, Any] | None:
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is required when MOCK_LLM=false and LLM_PROVIDER=gemini.")

    model = os.getenv("GEMINI_MODEL") or os.getenv("CHAT_MODEL") or "gemini-2.5-flash"
    model_path = model if model.startswith("models/") else f"models/{model}"
    url = f"https://generativelanguage.googleapis.com/v1beta/{model_path}:generateContent"
    payload = _generate_content_payload(system_instruction, user_prompt, float(os.getenv("GEMINI_TEMPERATURE", "0.7")))

    try:
        response = httpx.post(
            url,
            headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
            json=payload,
            timeout=float(os.getenv("GEMINI_TIMEOUT_SECONDS", "45")),
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        detail = _safe_error_detail(exc.response, "Gemini")
        raise RuntimeError(f"Gemini API-key request failed with HTTP {exc.response.status_code}: {detail}") from exc
    except httpx.HTTPError as exc:
        raise RuntimeError(f"Gemini API-key request failed: {exc}") from exc

    text = _extract_text(response.json())
    if not text:
        return None
    return _parse_json_object(text) or {"answer": text}


def _generate_json_vertex(system_instruction: str, user_prompt: str) -> dict[str, Any] | None:
    url = _vertex_endpoint()
    token = _vertex_access_token()
    payload = _generate_content_payload(system_instruction, user_prompt, float(os.getenv("VERTEX_TEMPERATURE", "0.7")))

    try:
        response = httpx.post(
            url,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
            json=payload,
            timeout=float(os.getenv("VERTEX_TIMEOUT_SECONDS", "45")),
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        detail = _safe_error_detail(exc.response, "Vertex")
        raise RuntimeError(f"Vertex AI request failed with HTTP {exc.response.status_code}: {detail}") from exc
    except httpx.HTTPError as exc:
        raise RuntimeError(f"Vertex AI request failed: {exc}") from exc

    text = _extract_text(response.json())
    if not text:
        return None
    return _parse_json_object(text) or {"answer": text}


def _generate_content_payload(system_instruction: str, user_prompt: str, temperature: float) -> dict[str, Any]:
    return {
        "systemInstruction": {
            "parts": [{"text": system_instruction}],
        },
        "contents": [
            {
                "role": "user",
                "parts": [{"text": user_prompt}],
            }
        ],
        "generationConfig": {
            "temperature": temperature,
            "responseMimeType": "application/json",
        },
    }


def _vertex_endpoint() -> str:
    project_id = str(os.getenv("VERTEX_PROJECT_ID") or "").strip()
    if not project_id:
        raise RuntimeError("VERTEX_PROJECT_ID is required when MOCK_LLM=false and LLM_PROVIDER=vertex.")

    location = str(os.getenv("VERTEX_LOCATION") or "global").strip()
    if not location:
        raise RuntimeError("VERTEX_LOCATION is required when MOCK_LLM=false and LLM_PROVIDER=vertex.")

    model = _vertex_model_id()
    base_url = "https://aiplatform.googleapis.com/v1" if location == "global" else f"https://{location}-aiplatform.googleapis.com/v1"
    return (
        f"{base_url}/projects/{quote(project_id, safe='')}/locations/{quote(location, safe='')}/"
        f"publishers/google/models/{quote(model, safe='')}:generateContent"
    )


def _vertex_model_id() -> str:
    model = str(os.getenv("VERTEX_MODEL") or os.getenv("CHAT_MODEL") or "gemini-2.5-flash").strip()
    if not model:
        raise RuntimeError("VERTEX_MODEL is required when MOCK_LLM=false and LLM_PROVIDER=vertex.")
    for prefix in ("publishers/google/models/", "models/"):
        if model.startswith(prefix):
            return model[len(prefix) :]
    return model


def _vertex_access_token() -> str:
    try:
        import google.auth
        from google.auth.transport.requests import Request
    except ImportError as exc:
        raise RuntimeError("google-auth is required when MOCK_LLM=false and LLM_PROVIDER=vertex.") from exc

    try:
        credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        if not getattr(credentials, "valid", False) or not getattr(credentials, "token", None):
            credentials.refresh(Request())
        token = getattr(credentials, "token", None)
        if not token:
            raise RuntimeError("Application Default Credentials did not return an access token.")
        return str(token)
    except Exception as exc:
        raise RuntimeError(f"Vertex ADC authentication failed: {exc}") from exc


def _retrieve_context(request: Any) -> tuple[str, list[dict[str, Any]]]:
    sections: list[str] = []
    citations: list[dict[str, Any]] = []
    lower = str(request.message or "").lower()
    intent = detect_prompt_intent(request.message)
    rules_like = "rules" in intent.detected or (
        selected_mode_intent(request.mode) == "rules" and not prompt_conflicts_with_mode(intent, request.mode)
    )
    memory_like = (
        selected_mode_intent(request.mode) == "recap" and not prompt_conflicts_with_mode(intent, request.mode)
    ) or any(item in intent.detected for item in ("memory", "recap", "npc", "quest")) or any(
        term in lower for term in ["last session", "previous", "betray", "betrayed"]
    )
    session = getattr(request, "session", None)
    session_notes = str(getattr(session, "rawNotes", "") or "").strip()
    if session and session_notes and selected_mode_intent(request.mode) == "summarize":
        title = str(getattr(session, "title", "") or "Active session").strip()
        number = getattr(session, "sessionNumber", None)
        heading = f"Active session notes: Session {number}, {title}" if number else f"Active session notes: {title}"
        sections.append(f"{heading}\n{session_notes}")

    if request.context.useRules and rules_like:
        try:
            rows = search_rules(request.campaignId, request.message, 4)
            if rows:
                sections.append(_format_rows("Rules context", rows))
                citations.extend(row["citation"] for row in rows if row.get("citation"))
        except Exception as exc:
            sections.append(f"Rules context unavailable: {exc}")

    if request.context.useHomebrew and (rules_like or "homebrew" in lower):
        try:
            rows = search_homebrew(request.campaignId, request.message, 4)
            if rows:
                sections.append(_format_rows("Homebrew context", rows))
                citations.extend(row["citation"] for row in rows if row.get("citation"))
        except Exception as exc:
            sections.append(f"Homebrew context unavailable: {exc}")

    if request.context.useCampaignMemory and memory_like:
        try:
            rows = search_memory(request.campaignId, request.message, 4, request.clientOwnerId)
            if rows:
                sections.append(_format_rows("Campaign memory context", rows))
                citations.extend(row["citation"] for row in rows if row.get("citation"))
        except Exception as exc:
            sections.append(f"Campaign memory context unavailable: {exc}")

    return "\n\n".join(sections), citations


def _system_instruction() -> str:
    return (
        "You are DNDMind, an AI Dungeon Master co-pilot. Answer as a practical table assistant: "
        "clear, imaginative, rules-aware, and grounded in supplied campaign context. "
        "Use retrieved rules and memory as established context. If context is missing, say what assumption you are making. "
        "Write the answer for a busy DM: start with the useful result, use short paragraphs or bullets, "
        "and keep debug details out of the answer. "
        "The selectedMode field is a UI hint, not a command; when selectedMode conflicts with detected intent or the message, "
        "follow the message and detected intent. "
        "If the user explicitly says a generated character is not an NPC, do not return an npc structuredOutput. "
        "For recap requests, narrate a table-ready 'previously in this campaign' recap from supplied campaign memory without inventing missing facts. "
        "For summarize requests, summarize the supplied active session notes directly; do not claim the notes are missing when activeSession is present. "
        "Return only one JSON object with keys: answer, structuredOutput, suggestedActions. "
        "structuredOutput must be null or an object with type and data. Valid types are "
        "npc, character, quest, location, encounter, session_summary, initiative_order, dice_roll. "
        "For character data, include hpCurrent, hpMax, tempHp, armorClass, initiativeModifier, and passivePerception when they can be reasonably assigned. "
        "For generated NPC or character cards, derive role, background, stats, equipment, motives, secrets, and hooks from the user's concept instead of using generic placeholders. "
        "suggestedActions must use these case-sensitive action names when applicable: "
        "saveNPC, saveCharacter, saveQuest, saveLocation, saveEncounter, saveHook, saveSessionSummary, prompt."
    )


def _summary_system_instruction() -> str:
    return (
        "You are DNDMind, an AI Dungeon Master archivist. Extract accurate, durable campaign memory "
        "from raw session notes without inventing events. Return only one JSON object with keys: "
        "summary, importantEvents, npcs, locations, quests, encounters, items, unresolvedHooks. "
        "npcs must contain objects with name, role, description, disposition. "
        "locations must contain objects with name, locationType, description. "
        "quests must contain objects with title, status, description. "
        "encounters must contain objects with title, summary, outcome."
    )


def _campaign_recap_system_instruction() -> str:
    return (
        "You are DNDMind, an AI Dungeon Master narrator. Write a coherent 'previously in this campaign' recap "
        "using only supplied campaign memory and active session notes. Do not invent facts. Keep secrets and DM-only "
        "inferences out unless they are explicit in the supplied context. Make it useful to read aloud at the table, "
        "with 2 to 4 short paragraphs and concrete names, places, quests, and unresolved hooks when available. "
        "Return only one JSON object with keys: recap."
    )


def _prompt_suggestion_system_instruction() -> str:
    return (
        "You are DNDMind, an AI Dungeon Master co-pilot. Generate only a concise editable prompt draft for the DM to send later, "
        "not the answer to that prompt. Return one JSON object with keys: prompt, mode, resolvedMode, reason. "
        "mode must echo one of auto, rules, npc, character, encounter, recap, summarize. resolvedMode must be null unless mode is auto; "
        "when mode is auto, resolvedMode must be one of rules, npc, character, encounter, recap, summarize. "
        "The prompt should be table-ready, specific to supplied campaign/session context when useful, and short enough to fit in a command console."
    )


def _user_prompt(request: Any, retrieved_context: str, tool_calls: list[dict[str, Any]]) -> str:
    party = [_party_member(member) for member in request.party] if request.context.usePartyInfo else []
    intent = detect_prompt_intent(request.message)
    campaign_style_hint = _campaign_style_hint(request)
    context_flags = {
        "useRules": request.context.useRules,
        "useCampaignMemory": request.context.useCampaignMemory,
        "usePartyInfo": request.context.usePartyInfo,
        "useHomebrew": request.context.useHomebrew,
    }
    payload = {
        "campaign": request.campaign.model_dump(mode="json"),
        "activeSession": request.session.model_dump(mode="json") if getattr(request, "session", None) else None,
        "selectedMode": request.mode,
        "intent": intent.as_payload(),
        "mode": request.mode,
        "campaignStyleHint": campaign_style_hint,
        "contextFlags": context_flags,
        "party": party,
        "message": request.message,
        "retrievedContext": retrieved_context or "No retrieved context was available.",
        "toolCalls": tool_calls,
    }
    return (
        "Create the response for this D&D assistant request. "
        "Treat selectedMode as a quick focus hint only; detected intent and the user's message take precedence when they conflict. "
        f"{campaign_style_hint} "
        "Use the tool call results as facts when present. "
        "When you return a structuredOutput, make its data complete enough for the UI save action. "
        "For NPC and character outputs, make the saved-card fields specific to the user's requested archetype, role, and campaign context; avoid reusable default stats or filler text.\n\n"
        f"{json.dumps(payload, default=str)}"
    )


def _prompt_suggestion_user_prompt(request: Any) -> str:
    payload = {
        "campaignId": str(getattr(request, "campaignId", "")),
        "sessionId": str(getattr(request, "sessionId", "") or ""),
        "mode": getattr(request, "mode", "auto"),
        "currentInput": getattr(request, "currentInput", None),
        "campaign": request.campaign.model_dump(mode="json") if getattr(request, "campaign", None) else None,
        "party": [member.model_dump(mode="json") for member in getattr(request, "party", [])],
        "session": request.session.model_dump(mode="json") if getattr(request, "session", None) else None,
        "memory": request.memory.model_dump(mode="json") if getattr(request, "memory", None) else {},
    }
    return (
        "Draft a D&D command prompt for this request. "
        "For rules, ask for a ruling question. For npc, ask for an NPC generation prompt. "
        "For character, ask for a playable or near-playable character generation prompt. "
        "For encounter, ask for an encounter creation prompt. For recap, ask for a table-ready campaign recap from saved memory. "
        "For summarize, ask for a session note extraction prompt. For auto, choose the most useful of those options from the available context.\n\n"
        f"{json.dumps(payload, default=str)}"
    )


def _campaign_style_hint(request: Any) -> str:
    campaign = getattr(request, "campaign", None)
    tone = str(getattr(campaign, "systemTone", "") or "").strip()
    if not tone:
        return "No campaign response tone was supplied; use the default DNDMind style."
    return (
        "Campaign response tone style hint: "
        f"{tone}. Apply this only to voice, pacing, flavor, formatting, descriptive style, and overall DM response feel. "
        "Do not let it override DNDMind scope, safety, factual grounding, citation behavior, tool results, detected intent, "
        "selected mode handling, or structured output requirements."
    )


def _normalize_prompt_suggestion_mode(value: Any) -> str | None:
    normalized = str(value or "").strip().lower()
    return normalized if normalized in {"auto", "rules", "npc", "character", "encounter", "recap", "summarize"} else None


def _party_member(member: Any) -> dict[str, Any]:
    return member.model_dump(mode="json")


def _format_rows(title: str, rows: list[dict[str, Any]]) -> str:
    formatted = []
    for index, row in enumerate(rows, start=1):
        heading = row.get("heading") or "Untitled section"
        source = row.get("title") or row.get("document_id") or "Unknown source"
        formatted.append(f"[{index}] {source} - {heading}\n{row.get('content', '')}")
    return f"{title}:\n" + "\n\n".join(formatted)


def _extract_text(payload: dict[str, Any]) -> str:
    candidates = payload.get("candidates") or []
    parts = []
    for candidate in candidates:
        content = candidate.get("content") or {}
        for part in content.get("parts") or []:
            text = part.get("text")
            if text:
                parts.append(text)
    return "\n".join(parts).strip()


def _parse_json_object(text: str) -> dict[str, Any] | None:
    if not text:
        return None
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.IGNORECASE | re.DOTALL)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _normalize_structured_output(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None

    output_type = value.get("type")
    data = value.get("data")
    if output_type not in STRUCTURED_MODELS or not isinstance(data, dict):
        return None

    try:
        normalized_data = STRUCTURED_MODELS[output_type](**data).model_dump()
        return StructuredOutput(type=output_type, data=normalized_data).model_dump()
    except (TypeError, ValueError, ValidationError):
        return None


def _fallback_structured_output(
    request: Any,
    answer: str,
    raw_output: Any,
    tool_calls: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    requested_type = _requested_structured_type(request)
    if requested_type not in {"npc", "character", "encounter"}:
        return None

    data = raw_output.get("data") if isinstance(raw_output, dict) and isinstance(raw_output.get("data"), dict) else {}
    if requested_type == "npc":
        candidate = _npc_fallback_data(request, answer, data)
        model = NpcOutput
    elif requested_type == "character":
        candidate = _character_fallback_data(request, answer, data)
        model = CharacterOutput
    else:
        candidate = _encounter_fallback_data(request, answer, data, tool_calls or [])
        model = EncounterOutput

    try:
        normalized = model(**candidate).model_dump()
    except (TypeError, ValueError, ValidationError):
        return None
    return StructuredOutput(type=requested_type, data=normalized).model_dump()


def _requested_structured_type(request: Any) -> str | None:
    message = str(getattr(request, "message", "") or "").strip()
    intent = detect_prompt_intent(message)
    mode = str(getattr(request, "mode", "") or "").strip().lower()
    if mode in {"summarize", "recap"} or any(item in intent.detected for item in ("summarize", "recap")):
        return None
    if "character" in intent.detected:
        return "character"
    if "npc" in intent.detected:
        return "npc"
    if "encounter" in intent.detected:
        return "encounter"

    if mode in {"npc", "character", "encounter"} and not prompt_conflicts_with_mode(intent, mode):
        return mode
    return None


def _encounter_fallback_data(request: Any, answer: str, data: dict[str, Any], tool_calls: list[dict[str, Any]]) -> dict[str, Any]:
    monsters = _encounter_monsters(data, answer)
    return {
        "title": (
            _text_field(data, "title")
            or _extract_labeled(answer, "Title")
            or _extract_encounter_title(answer)
            or _title_from_request(request, "Generated Encounter")
        ),
        "difficulty": _encounter_difficulty(request, answer, data, tool_calls, monsters),
        "environment": (
            _text_field(data, "environment")
            or _extract_labeled(answer, "Environment")
            or _extract_labeled(answer, "Terrain")
            or _extract_environment_sentence(answer)
            or "A flexible battlefield with useful cover, a clear objective, and one terrain complication the DM can emphasize."
        ),
        "monsters": monsters,
        "tactics": (
            _text_field(data, "tactics")
            or _extract_labeled(answer, "Tactics")
            or _extract_labeled(answer, "Enemy Tactics")
            or _extract_tactics_sentence(answer)
            or "The enemies pressure exposed characters, use terrain intelligently, and shift focus when the party changes plans."
        ),
        "scalingOptions": _encounter_scaling_options(data, answer),
        "rewards": (
            _text_list(data.get("rewards"))
            or _extract_labeled_list(answer, "Rewards")
            or ["A useful clue, modest treasure, or leverage tied to the next scene."]
        ),
        "campaignHooks": (
            _text_list(data.get("campaignHooks"))
            or _text_list(data.get("campaign_hooks"))
            or _extract_labeled_list(answer, "Campaign Hooks")
            or _extract_labeled_list(answer, "Hooks")
            or ["Tie one enemy, clue, or battlefield detail to an unresolved campaign question."]
        ),
    }


def _normalize_difficulty(value: str) -> str:
    match = re.search(r"\b(easy|medium|hard|deadly|trivial|unknown)\b", str(value or ""), flags=re.IGNORECASE)
    if not match:
        return "Unknown"
    normalized = match.group(1).capitalize()
    return "Easy" if normalized == "Trivial" else normalized


def _encounter_difficulty(
    request: Any,
    answer: str,
    data: dict[str, Any],
    tool_calls: list[dict[str, Any]],
    monsters: list[dict[str, Any]],
) -> str:
    for value in (
        _text_field(data, "difficulty"),
        _extract_difficulty(answer),
        _extract_difficulty(str(getattr(request, "message", "") or "")),
    ):
        if not value:
            continue
        normalized = _normalize_difficulty(value)
        if normalized in {"Easy", "Medium", "Hard", "Deadly"}:
            return normalized

    tool_difficulty = _tool_call_encounter_difficulty(tool_calls)
    if tool_difficulty:
        return tool_difficulty

    calculated = _calculate_fallback_difficulty(request, monsters)
    if calculated:
        return calculated
    return "Unknown"


def _extract_difficulty(text: str) -> str:
    match = re.search(r"\b(easy|medium|hard|deadly|unknown)\b", str(text or ""), flags=re.IGNORECASE)
    return match.group(1) if match else ""


def _tool_call_encounter_difficulty(tool_calls: list[dict[str, Any]]) -> str:
    for call in tool_calls:
        if not call.get("success") or call.get("toolName") != "calculateEncounterDifficulty":
            continue
        normalized = _normalize_difficulty(str((call.get("result") or {}).get("difficulty") or ""))
        if normalized in {"Easy", "Medium", "Hard", "Deadly"}:
            return normalized
    return ""


def _calculate_fallback_difficulty(request: Any, monsters: list[dict[str, Any]]) -> str:
    if selected_mode_intent(str(getattr(request, "mode", "") or "")) != "encounter":
        return ""
    context = getattr(request, "context", None)
    if context is not None and not getattr(context, "usePartyInfo", False):
        return ""

    party = _party_for_difficulty(request)
    if not party:
        return ""

    difficulty_monsters = [
        {
            "name": monster.get("name"),
            "count": _positive_int(monster.get("count"), 1),
            "xp": _known_monster_xp(str(monster.get("name") or "")) or _nonnegative_int(monster.get("xp"), 0),
        }
        for monster in monsters
    ]
    if not difficulty_monsters or not any(monster["xp"] > 0 for monster in difficulty_monsters):
        return ""

    try:
        result = calculate_encounter_difficulty({"party": party, "monsters": difficulty_monsters})
    except (TypeError, ValueError):
        return ""

    normalized = _normalize_difficulty(str(result.get("difficulty") or ""))
    return normalized if normalized in {"Easy", "Medium", "Hard", "Deadly"} else ""


def _party_for_difficulty(request: Any) -> list[dict[str, Any]]:
    party: list[dict[str, Any]] = []
    for member in getattr(request, "party", []) or []:
        if isinstance(member, dict):
            level = member.get("level")
            name = member.get("name")
        else:
            level = getattr(member, "level", None)
            name = getattr(member, "name", None)
        try:
            parsed_level = int(level)
        except (TypeError, ValueError):
            continue
        if parsed_level <= 0:
            continue
        party.append({"name": str(name or "Party Member"), "level": parsed_level})
    return party


def _extract_encounter_title(answer: str) -> str:
    bold = re.search(r"\*\*([^*\n]{3,60}?)\*\*", answer)
    if bold:
        title = bold.group(1).strip(" :-")
        if not re.search(r"\b(?:environment|terrain|tactics|rewards?|hooks?|scaling)\b", title, flags=re.IGNORECASE):
            return title

    heading = re.search(r"(?:^|\n)\s*#{1,3}\s*([^#\n]{3,60})", answer)
    if heading:
        return heading.group(1).strip(" :-")

    named = re.search(
        r"\b(?:encounter|ambush|fight|battle)\s+(?:called|named|titled)\s+['\"]?([^'\".\n]{3,60})",
        answer,
        flags=re.IGNORECASE,
    )
    return named.group(1).strip(" :-") if named else ""


def _title_from_request(request: Any, default: str) -> str:
    message = str(getattr(request, "message", "") or "")
    if re.search(r"\bambush\b", message, flags=re.IGNORECASE):
        return "Ambush Encounter"
    if re.search(r"\bboss\b", message, flags=re.IGNORECASE):
        return "Boss Encounter"
    if re.search(r"\bcombat\b", message, flags=re.IGNORECASE):
        return "Combat Encounter"
    return default


def _encounter_monsters(data: dict[str, Any], answer: str) -> list[dict[str, Any]]:
    monsters = _normalize_monster_list(data.get("monsters"))
    if monsters:
        return monsters

    labeled = (
        _extract_labeled(answer, "Monsters")
        or _extract_labeled(answer, "Enemies")
        or _extract_labeled(answer, "Creatures")
    )
    monsters = _normalize_monster_list(_split_text_items(labeled))
    if monsters:
        return monsters

    monsters = _monsters_from_answer(answer)
    if monsters:
        return monsters

    return [{"name": "Encounter Foe", "count": 1, "role": "primary threat", "xp": 0}]


def _normalize_monster_list(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    monsters: list[dict[str, Any]] = []
    for item in value:
        if isinstance(item, dict):
            name = _text_field(item, "name") or _text_field(item, "type")
            if not name:
                continue
            monsters.append(
                {
                    "name": name,
                    "count": _positive_int(item.get("count"), 1),
                    "role": _text_field(item, "role") or "combatant",
                    "xp": _known_monster_xp(name) or _nonnegative_int(item.get("xp"), 0),
                }
            )
        elif str(item).strip():
            monsters.append(_monster_from_text(str(item)))
    return monsters


def _monster_from_answer(answer: str) -> dict[str, Any] | None:
    monsters = _monsters_from_answer(answer)
    return monsters[0] if monsters else None


def _monsters_from_answer(answer: str) -> list[dict[str, Any]]:
    text = str(answer or "")
    found: list[tuple[int, dict[str, Any]]] = []
    for name, role, xp in _KNOWN_MONSTERS:
        match = re.search(rf"\b{re.escape(name)}s?\b", text, flags=re.IGNORECASE)
        if match:
            found.append((match.start(), {"name": name, "count": _count_near_monster(text, name), "role": role, "xp": xp}))

    monsters: list[dict[str, Any]] = []
    seen_names: set[str] = set()
    for _, monster in sorted(found, key=lambda item: item[0]):
        key = str(monster["name"]).lower()
        if key in seen_names:
            continue
        seen_names.add(key)
        monsters.append(monster)
    return monsters


def _monster_from_text(text: str) -> dict[str, Any]:
    count = _count_from_text(text)
    cleaned = re.sub(r"\b\d+\b", "", text)
    cleaned = re.sub(r"\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\b", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\([^)]*\)", "", cleaned)
    name = _clean_markdown_text(cleaned).strip(" ,:-") or "Encounter Foe"
    xp = _known_monster_xp(name)
    return {"name": name, "count": count, "role": _known_monster_role(name) or "combatant", "xp": xp}


def _known_monster_xp(name: str) -> int:
    lower = str(name or "").lower()
    for monster_name, _, xp in _KNOWN_MONSTERS:
        if re.search(rf"\b{re.escape(monster_name.lower())}s?\b", lower):
            return xp
    return 0


def _known_monster_role(name: str) -> str:
    lower = str(name or "").lower()
    for monster_name, role, _ in _KNOWN_MONSTERS:
        if re.search(rf"\b{re.escape(monster_name.lower())}s?\b", lower):
            return role
    return ""


def _count_near_monster(text: str, monster_name: str) -> int:
    pattern = rf"\b(?P<count>\d+|{'|'.join(_COUNT_WORDS)})\s+{re.escape(monster_name)}s?\b"
    match = re.search(pattern, str(text or ""), flags=re.IGNORECASE)
    if match:
        return _count_from_text(match.group("count"))
    return 1


def _count_from_text(text: str) -> int:
    digit = re.search(r"\b(\d+)\b", str(text or ""))
    if digit:
        return _positive_int(digit.group(1), 1)

    word = re.search(r"\b(one|two|three|four|five|six|seven|eight|nine|ten)\b", str(text or ""), flags=re.IGNORECASE)
    if word:
        return _COUNT_WORDS[word.group(1).lower()]
    return 1


def _encounter_scaling_options(data: dict[str, Any], answer: str) -> dict[str, str]:
    value = data.get("scalingOptions") or data.get("scaling_options")
    scaling = value if isinstance(value, dict) else {}
    easier = (
        _text_field(scaling, "easier")
        or _text_field(data, "easier")
        or _extract_labeled(answer, "Easier")
        or "Reduce the number of enemies, lower enemy damage, or reveal the hazard before initiative."
    )
    harder = (
        _text_field(scaling, "harder")
        or _text_field(data, "harder")
        or _extract_labeled(answer, "Harder")
        or "Add a reinforcement, tighten the objective timer, or make the terrain hazard active each round."
    )
    return {"easier": easier, "harder": harder}


def _npc_fallback_data(request: Any, answer: str, data: dict[str, Any]) -> dict[str, str]:
    source_text = f"{getattr(request, 'message', '')} {answer}"
    name = _text_field(data, "name") or _extract_npc_name(answer) or _requested_name_from_text(source_text) or "Generated NPC"
    role = _text_field(data, "role") or _extract_role(answer) or _infer_npc_role(source_text)
    description = _text_field(data, "description") or _extract_labeled(answer, "Appearance") or _fallback_npc_description(answer)
    personality = _text_field(data, "personality") or _extract_labeled(answer, "Personality") or _infer_npc_personality(source_text, role)
    motivation = _text_field(data, "motivation") or _extract_labeled(answer, "Motivation") or _infer_npc_motivation(source_text, role)
    relationship = (
        _text_field(data, "relationshipToParty")
        or _extract_labeled(answer, "Connection to Campaign")
        or _extract_labeled(answer, "Party Link")
        or _infer_npc_relationship(source_text, role)
    )
    quest_hook = (
        _text_field(data, "questHook")
        or _extract_labeled(answer, "Quest Hook")
        or _extract_mission_sentence(relationship)
        or _infer_npc_quest_hook(source_text, role)
    )

    return {
        "name": name,
        "role": role,
        "raceOrSpecies": _text_field(data, "raceOrSpecies") or _extract_labeled(answer, "Race") or _infer_ancestry_or_species(source_text),
        "description": description,
        "personality": personality,
        "motivation": motivation,
        "secret": _text_field(data, "secret") or _extract_labeled(answer, "Secret") or _infer_npc_secret(source_text, role),
        "relationshipToParty": relationship,
        "questHook": quest_hook,
    }


def _character_fallback_data(request: Any, answer: str, data: dict[str, Any]) -> dict[str, Any]:
    source_text = f"{getattr(request, 'message', '')} {answer}"
    class_and_subclass = (
        _text_field(data, "classAndSubclass")
        or _text_field(data, "class")
        or _extract_labeled(answer, "Class/Subclass")
        or _extract_labeled(answer, "Class")
        or _infer_character_class(source_text)
    )
    level = _positive_int(data.get("level"), _character_level_from_text(str(getattr(request, "message", "") or "") + " " + answer))
    ability_scores = _ability_scores(data.get("abilityScores") or data.get("ability_scores"), answer, class_and_subclass, source_text)
    equipment = (
        _text_list(data.get("equipment"))
        or _extract_labeled_list(answer, "Equipment")
        or _inferred_character_equipment(request, answer, class_and_subclass)
    )
    hp_max = _first_int(
        data.get("hpMax"),
        data.get("maxHp"),
        data.get("hitPoints"),
        _extract_labeled_number(answer, "HP"),
        fallback=_estimated_character_hp(level, class_and_subclass, ability_scores),
    )
    return {
        "name": _text_field(data, "name") or _extract_npc_name(answer) or _requested_name_from_text(source_text) or "Generated Character",
        "ancestryOrSpecies": (
            _text_field(data, "ancestryOrSpecies")
            or _text_field(data, "species")
            or _text_field(data, "raceOrSpecies")
            or _extract_labeled(answer, "Ancestry")
            or _extract_labeled(answer, "Species")
            or _extract_labeled(answer, "Race")
            or _infer_ancestry_or_species(source_text)
        ),
        "classAndSubclass": class_and_subclass,
        "level": level,
        "background": _text_field(data, "background") or _extract_labeled(answer, "Background") or _infer_character_background(source_text, class_and_subclass),
        "role": _text_field(data, "role") or _extract_labeled(answer, "Role") or _character_role_from_request(request),
        "abilityScores": ability_scores,
        "statSummary": _text_field(data, "statSummary") or _extract_labeled(answer, "Stat Summary") or _extract_labeled(answer, "Ability Scores") or _character_stat_summary(source_text, class_and_subclass),
        "hpCurrent": _first_int(data.get("hpCurrent"), data.get("currentHp"), fallback=hp_max),
        "hpMax": hp_max,
        "tempHp": _first_int(data.get("tempHp"), data.get("temporaryHp"), fallback=0),
        "armorClass": _first_int(data.get("armorClass"), data.get("ac"), _extract_labeled_number(answer, "AC"), fallback=_estimated_character_ac(class_and_subclass, equipment, ability_scores)),
        "initiativeModifier": _first_int(data.get("initiativeModifier"), data.get("initiative"), _extract_labeled_number(answer, "Initiative"), fallback=_ability_modifier(ability_scores.get("dex", 10))),
        "passivePerception": _first_int(data.get("passivePerception"), data.get("passiveWisdom"), _extract_labeled_number(answer, "Passive Perception"), fallback=10 + _ability_modifier(ability_scores.get("wis", 10))),
        "personalityTraits": _text_list(data.get("personalityTraits")) or _extract_labeled_list(answer, "Personality Traits") or _extract_labeled_list(answer, "Personality") or _character_personality_traits(source_text, class_and_subclass),
        "idealsBondsFlaws": _ideals_bonds_flaws(data.get("idealsBondsFlaws") or data.get("ideals_bonds_flaws"), answer, source_text, class_and_subclass),
        "equipment": equipment,
        "campaignTieIn": _text_field(data, "campaignTieIn") or _extract_labeled(answer, "Campaign Tie-In") or _extract_labeled(answer, "Connection to Campaign") or _character_campaign_tie(source_text, class_and_subclass),
        "secretOrHook": _text_field(data, "secretOrHook") or _extract_labeled(answer, "Secret") or _extract_labeled(answer, "Hook") or _character_secret_or_hook(source_text, class_and_subclass),
    }


def _character_level_from_text(value: str) -> int:
    match = re.search(r"\blevel\s+(\d{1,2})\b", str(value or ""), flags=re.IGNORECASE)
    if not match:
        return 3
    return _positive_int(match.group(1), 3)


def _character_role_from_request(request: Any) -> str:
    message = str(getattr(request, "message", "") or "")
    if re.search(r"\brival\b", message, flags=re.IGNORECASE):
        return "Rival adventurer"
    if re.search(r"\bhireling|retainer\b", message, flags=re.IGNORECASE):
        return "Hireling"
    if re.search(r"\bally|companion|sidekick\b", message, flags=re.IGNORECASE):
        return "Party ally"
    if re.search(r"\bbackup\b", message, flags=re.IGNORECASE):
        return "Backup PC"
    return "Table-ready adventurer"


def _requested_name_from_text(value: str) -> str:
    match = re.search(r"\bnamed\s+([A-Za-z][A-Za-z' -]{1,39})", str(value or ""), flags=re.IGNORECASE)
    if not match:
        return ""
    cleaned = re.split(
        r"\b(?:not|he|she|they|with|uses?|has|is|who|and|connected|tied|linked|for|from)\b",
        match.group(1),
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]
    cleaned = cleaned.strip(" .,:;-")
    return cleaned.title() if cleaned else ""


def _infer_ancestry_or_species(value: str) -> str:
    text = str(value or "").lower()
    ancestry_patterns = (
        ("elf", "Elf"),
        ("elven", "Elf"),
        ("dwarf", "Dwarf"),
        ("halfling", "Halfling"),
        ("gnome", "Gnome"),
        ("tiefling", "Tiefling"),
        ("dragonborn", "Dragonborn"),
        ("half-orc", "Half-orc"),
        ("orc", "Orc"),
        ("goblin", "Goblin"),
        ("kobold", "Kobold"),
        ("aasimar", "Aasimar"),
        ("firbolg", "Firbolg"),
        ("human", "Human"),
    )
    for token, label in ancestry_patterns:
        if re.search(rf"\b{re.escape(token)}s?\b", text):
            return label
    return "Humanoid"


def _infer_npc_role(value: str) -> str:
    text = str(value or "").lower()
    role_patterns = (
        (r"\btavern|innkeeper|bartender\b", "Tavern keeper"),
        (r"\bmerchant|shopkeeper|trader|vendor\b", "Merchant contact"),
        (r"\bguard|watch|soldier|captain\b", "Local guard"),
        (r"\bnoble|duke|baron|court\b", "Local noble"),
        (r"\bpriest|cleric|temple|shrine\b", "Temple keeper"),
        (r"\bspy|informant|agent|whisper\b", "Informant"),
        (r"\bblacksmith|smith|armorer\b", "Blacksmith"),
        (r"\bwitch|mage|wizard|arcanist\b", "Arcane specialist"),
        (r"\bthief|bandit|criminal|smuggler\b", "Underworld contact"),
    )
    for pattern, role in role_patterns:
        if re.search(pattern, text):
            return role
    return "Campaign contact"


def _infer_npc_personality(value: str, role: str) -> str:
    text = str(value or "").lower()
    if re.search(r"\bsuspicious|paranoid|secretive\b", text):
        return "Suspicious, precise with words, and always checking who might be listening."
    if re.search(r"\bkind|friendly|warm|helpful\b", text):
        return "Warm, generous with small comforts, and careful not to promise more than they can deliver."
    if re.search(r"\bgreedy|ambitious|ruthless\b", text):
        return "Ambitious, transactional, and quick to measure what every favor is worth."
    if "guard" in role.lower():
        return "Disciplined, tired of excuses, and quietly protective of people under their watch."
    if "merchant" in role.lower():
        return "Polished, curious, and always weighing whether a secret can become leverage."
    return "Alert, opinionated, and shaped by the trouble currently moving through the campaign."


def _infer_npc_motivation(value: str, role: str) -> str:
    text = str(value or "").lower()
    if re.search(r"\bcult|conspiracy|betrayal\b", text):
        return "Survive the conspiracy without becoming the next loose end."
    if re.search(r"\bdebt|owed|blackmail\b", text):
        return "Clear a dangerous debt before it reaches their family or livelihood."
    if "merchant" in role.lower():
        return "Keep trade flowing while quietly learning who is distorting the local market."
    if "guard" in role.lower():
        return "Protect the settlement while avoiding orders that feel increasingly compromised."
    return "Protect something local and personal while deciding whether the party can be trusted."


def _infer_npc_secret(value: str, role: str) -> str:
    text = str(value or "").lower()
    if re.search(r"\bcult|conspiracy\b", text):
        return "They have seen one sign, name, or payment trail tied to the cult's local network."
    if re.search(r"\bmerchant|trade|ledger\b", text):
        return "Their records contain a transaction that does not match the public story."
    if "guard" in role.lower():
        return "They were ordered to ignore a clue that could reopen the party's current lead."
    return "They know a concrete detail about the next lead but need leverage or trust before sharing it."


def _infer_npc_relationship(value: str, role: str) -> str:
    text = str(value or "").lower()
    if re.search(r"\brival|enemy|antagonist\b", text):
        return "An obstacle who respects competence and may bargain if cornered."
    if re.search(r"\bally|friend|helpful\b", text):
        return "A cautious ally who can offer help once the party proves the risk is worth taking."
    if "informant" in role.lower():
        return "A source who trades specific truths for protection, coin, or a favor owed."
    return "A campaign contact whose help depends on how carefully the party handles their problem."


def _infer_npc_quest_hook(value: str, role: str) -> str:
    text = str(value or "").lower()
    if re.search(r"\bcult|conspiracy\b", text):
        return "Follow the coded payment or symbol they spotted before the conspirators erase it."
    if re.search(r"\bshipment|cargo|trade|merchant\b", text) or "merchant" in role.lower():
        return "Trace an impossible shipment that arrived before anyone admits ordering it."
    if re.search(r"\bmissing|disappear\b", text):
        return "Find the missing person before the official explanation hardens into a lie."
    if "guard" in role.lower():
        return "Investigate the order they were told to ignore before it endangers the town."
    return "Turn one rumor they provide into a concrete lead for the party's next scene."


def _infer_character_class(value: str) -> str:
    text = str(value or "").lower()
    class_patterns = (
        (r"\bbarbarian|rage|berserker\b", "Barbarian, Path of the Berserker"),
        (r"\bpaladin|oath|holy knight\b", "Paladin, Oath of Devotion"),
        (r"\branger|archer|bow|hunter|gloom\b", "Ranger, Hunter"),
        (r"\bmonk|unarmed|fists?|martial artist\b", "Monk, Way of the Open Hand"),
        (r"\bgauntlets?|fighter|sword|shield|soldier\b", "Fighter, Battle Master"),
        (r"\brogue|thief|assassin|scout|sneak\b", "Rogue, Scout"),
        (r"\bcleric|healer|priest|life domain\b", "Cleric, Life Domain"),
        (r"\bdruid|wild shape|warden\b", "Druid, Circle of the Land"),
        (r"\bwizard|mage|spellbook|arcane\b", "Wizard, School of Evocation"),
        (r"\bsorcerer|bloodline|wild magic\b", "Sorcerer, Draconic Bloodline"),
        (r"\bwarlock|patron|pact\b", "Warlock, Pact of the Tome"),
        (r"\bbard|performer|minstrel\b", "Bard, College of Lore"),
        (r"\bartificer|inventor|tinkerer\b", "Artificer, Battle Smith"),
    )
    for pattern, class_name in class_patterns:
        if re.search(pattern, text):
            return class_name
    return "Adventurer"


def _infer_character_background(value: str, class_and_subclass: str) -> str:
    text = f"{value} {class_and_subclass}".lower()
    if re.search(r"\bcriminal|thief|smuggler|underworld\b", text):
        return "Criminal"
    if re.search(r"\bnoble|court|aristocrat\b", text):
        return "Noble"
    if re.search(r"\bsoldier|fighter|guard|paladin\b", text):
        return "Soldier"
    if re.search(r"\branger|druid|wild|forest|outlander\b", text):
        return "Outlander"
    if re.search(r"\bwizard|sage|scholar|arcane|book\b", text):
        return "Sage"
    if re.search(r"\bcleric|healer|temple|acolyte\b", text):
        return "Acolyte"
    if re.search(r"\bbard|performer|entertainer\b", text):
        return "Entertainer"
    return "Faction Agent"


def _fallback_ability_scores(value: str, class_and_subclass: str) -> dict[str, int]:
    text = f"{value} {class_and_subclass}".lower()
    if re.search(r"\bbarbarian|berserker\b", text):
        return {"str": 16, "dex": 13, "con": 15, "int": 8, "wis": 12, "cha": 10}
    if re.search(r"\bpaladin\b", text):
        return {"str": 16, "dex": 10, "con": 14, "int": 8, "wis": 12, "cha": 15}
    if re.search(r"\bgauntlets?|fighter|soldier|sword|shield\b", text):
        return {"str": 16, "dex": 12, "con": 15, "int": 10, "wis": 13, "cha": 11}
    if re.search(r"\branger|archer|bow|hunter\b", text):
        return {"str": 10, "dex": 16, "con": 13, "int": 11, "wis": 15, "cha": 9}
    if re.search(r"\brogue|thief|assassin|scout|sneak\b", text):
        return {"str": 8, "dex": 16, "con": 13, "int": 14, "wis": 12, "cha": 10}
    if re.search(r"\bcleric|healer|priest\b", text):
        return {"str": 10, "dex": 12, "con": 14, "int": 8, "wis": 16, "cha": 13}
    if re.search(r"\bdruid|wild shape|warden\b", text):
        return {"str": 8, "dex": 13, "con": 14, "int": 10, "wis": 16, "cha": 12}
    if re.search(r"\bmonk|unarmed|fists?|martial artist\b", text):
        return {"str": 10, "dex": 16, "con": 13, "int": 8, "wis": 15, "cha": 12}
    if re.search(r"\bwizard|mage|spellbook|arcane\b", text):
        return {"str": 8, "dex": 13, "con": 14, "int": 16, "wis": 12, "cha": 10}
    if re.search(r"\bsorcerer|warlock|bard|performer|patron|pact\b", text):
        return {"str": 8, "dex": 14, "con": 13, "int": 10, "wis": 12, "cha": 16}
    if re.search(r"\bartificer|inventor|tinkerer\b", text):
        return {"str": 10, "dex": 14, "con": 13, "int": 16, "wis": 12, "cha": 8}
    return {"str": 10, "dex": 14, "con": 13, "int": 12, "wis": 15, "cha": 8}


def _character_stat_summary(value: str, class_and_subclass: str) -> str:
    text = f"{value} {class_and_subclass}".lower()
    if re.search(r"\bgauntlets?|fighter|barbarian|paladin\b", text):
        return "Strength-forward front liner with enough Constitution to stay in the dangerous part of the fight."
    if re.search(r"\branger|rogue|archer|scout\b", text):
        return "Dexterity-forward skirmisher with strong scouting instincts and reliable survival reads."
    if re.search(r"\bcleric|druid|healer\b", text):
        return "Wisdom-forward support build with steady concentration and practical battlefield awareness."
    if re.search(r"\bwizard|artificer|arcane\b", text):
        return "Intelligence-forward problem solver who trades raw toughness for preparation and control."
    if re.search(r"\bbard|sorcerer|warlock\b", text):
        return "Charisma-forward face and spellcaster with enough Dexterity to stay mobile."
    return "Balanced adventurer stats adjusted toward the strongest cue in the requested concept."


def _character_personality_traits(value: str, class_and_subclass: str) -> list[str]:
    text = f"{value} {class_and_subclass}".lower()
    if re.search(r"\brival\b", text):
        return ["Competitive when plans get risky", "Respects competence more than rank"]
    if re.search(r"\bhireling|retainer\b", text):
        return ["Asks clear terms before danger starts", "Keeps a calm voice when others panic"]
    if re.search(r"\bwizard|sage|scholar\b", text):
        return ["Collects small facts other people discard", "Explains danger like a puzzle already half-solved"]
    if re.search(r"\brogue|spy|informant\b", text):
        return ["Notices exits before introductions", "Answers personal questions with useful questions"]
    return ["Steady under pressure", "Curious about the party's current trouble"]


def _character_campaign_tie(value: str, class_and_subclass: str) -> str:
    text = f"{value} {class_and_subclass}".lower()
    if re.search(r"\bcult|conspiracy\b", text):
        return "Their trail crosses the same cult or conspiracy pressure currently troubling the campaign."
    if re.search(r"\brival\b", text):
        return "They are chasing the same lead as the party and may turn cooperation into a contest."
    if re.search(r"\bhireling|retainer|ally|sidekick\b", text):
        return "They can join the party for the next leg because their own problem points in the same direction."
    return "They are tied to a current faction, lead, or unresolved hook the party can actually follow."


def _character_secret_or_hook(value: str, class_and_subclass: str) -> str:
    text = f"{value} {class_and_subclass}".lower()
    if re.search(r"\bcult|conspiracy\b", text):
        return "They recognize one symbol, courier, or safehouse connected to the campaign's current threat."
    if re.search(r"\bdebt|owed|blackmail\b", text):
        return "Their help comes with an old debt that may surface at the worst possible time."
    if re.search(r"\brival\b", text):
        return "They know part of the same lead but will only share it if the party earns or forces their respect."
    return "They carry one actionable clue that points toward the next campaign lead."


def _inferred_character_equipment(request: Any, answer: str, class_and_subclass: str = "") -> list[str]:
    text = f"{getattr(request, 'message', '')} {answer}".lower()
    if re.search(r"\bgauntlets?\b|\bunarmed\b|\bfists?\b|\bhand[- ]to[- ]hand\b", text):
        return ["reinforced gauntlets", "travel kit", "one campaign clue"]
    class_text = f"{text} {class_and_subclass}".lower()
    if re.search(r"\branger|archer|bow\b", class_text):
        return ["longbow", "shortswords", "explorer's pack", "weathered map"]
    if re.search(r"\bcleric|healer|priest\b", class_text):
        return ["mace", "shield", "holy symbol", "healer's kit"]
    if re.search(r"\brogue|thief|assassin|scout\b", class_text):
        return ["rapier", "shortbow", "thieves' tools", "coded note"]
    if re.search(r"\bwizard|mage|spellbook\b", class_text):
        return ["spellbook", "component pouch", "dagger", "annotated clue"]
    if re.search(r"\bbard|performer\b", class_text):
        return ["rapier", "lute", "disguise kit", "rumor journal"]
    if re.search(r"\bpaladin|fighter|soldier\b", class_text):
        return ["longsword", "shield", "chain mail", "campaign token"]
    return ["class gear", "travel kit", "one campaign clue"]


def _ability_scores(value: Any, answer: str, class_and_subclass: str = "", source_text: str = "") -> dict[str, int]:
    if isinstance(value, dict):
        scores = {
            key.lower(): _positive_int(raw, 0)
            for key, raw in value.items()
            if key.lower() in {"str", "dex", "con", "int", "wis", "cha"} and _positive_int(raw, 0) > 0
        }
        if scores:
            return scores

    labeled = _extract_labeled(answer, "Ability Scores") or _extract_labeled(answer, "Stats")
    scores: dict[str, int] = {}
    for key in ("str", "dex", "con", "int", "wis", "cha"):
        match = re.search(rf"\b{key}\w*\s*(?:=|:)?\s*(\d{{1,2}})\b", labeled, flags=re.IGNORECASE)
        if match:
            scores[key] = _positive_int(match.group(1), 0)
    return scores or _fallback_ability_scores(f"{source_text} {answer}", class_and_subclass)


def _estimated_character_hp(level: int, class_and_subclass: str, ability_scores: dict[str, int]) -> int:
    hit_die = _class_hit_die(class_and_subclass)
    fixed_average = hit_die // 2 + 1
    constitution_modifier = _ability_modifier(ability_scores.get("con", 10))
    return max(level, hit_die + constitution_modifier + max(0, level - 1) * (fixed_average + constitution_modifier))


def _estimated_character_ac(class_and_subclass: str, equipment: list[str], ability_scores: dict[str, int]) -> int:
    class_name = str(class_and_subclass or "").lower()
    equipment_text = " ".join(equipment).lower()
    dex_modifier = _ability_modifier(ability_scores.get("dex", 10))
    con_modifier = _ability_modifier(ability_scores.get("con", 10))
    wis_modifier = _ability_modifier(ability_scores.get("wis", 10))
    explicit_armor = _armor_class_from_equipment(equipment_text, dex_modifier)
    if explicit_armor is not None:
        return explicit_armor + (2 if re.search(r"\bshield\b", equipment_text) else 0)
    if "monk" in class_name:
        return 10 + dex_modifier + wis_modifier
    if "barbarian" in class_name:
        return 10 + dex_modifier + con_modifier
    if re.search(r"\b(paladin|fighter|cleric)\b", class_name):
        return 16 + (2 if re.search(r"\bshield\b", equipment_text) or "paladin" in class_name or "cleric" in class_name else 0)
    if re.search(r"\b(ranger|druid)\b", class_name):
        return 14 + min(2, max(0, dex_modifier))
    if re.search(r"\b(rogue|bard|warlock|artificer)\b", class_name):
        return 11 + dex_modifier
    return 10 + dex_modifier


def _armor_class_from_equipment(equipment_text: str, dex_modifier: int) -> int | None:
    if re.search(r"\bplate\b", equipment_text):
        return 18
    if re.search(r"\bchain mail\b", equipment_text):
        return 16
    if re.search(r"\bsplint\b", equipment_text):
        return 17
    if re.search(r"\bbreastplate\b", equipment_text):
        return 14 + min(2, max(0, dex_modifier))
    if re.search(r"\bhalf plate\b", equipment_text):
        return 15 + min(2, max(0, dex_modifier))
    if re.search(r"\bscale mail\b", equipment_text):
        return 14 + min(2, max(0, dex_modifier))
    if re.search(r"\bstudded leather\b", equipment_text):
        return 12 + dex_modifier
    if re.search(r"\bleather\b", equipment_text):
        return 11 + dex_modifier
    return None


def _class_hit_die(class_and_subclass: str) -> int:
    class_name = str(class_and_subclass or "").lower()
    if "barbarian" in class_name:
        return 12
    if re.search(r"\b(fighter|paladin|ranger)\b", class_name):
        return 10
    if re.search(r"\b(artificer|bard|cleric|druid|monk|rogue|warlock)\b", class_name):
        return 8
    return 6


def _ability_modifier(score: int) -> int:
    return (score - 10) // 2


def _extract_labeled_number(value: str, label: str) -> int | None:
    match = re.search(rf"\b{re.escape(label)}\b\s*(?:=|:)?\s*([+-]?\d{{1,3}})\b", str(value or ""), flags=re.IGNORECASE)
    return int(match.group(1)) if match else None


def _first_int(*values: Any, fallback: int | None = None) -> int | None:
    for value in values:
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            return int(value)
        text_value = str(value or "").strip()
        if not text_value:
            continue
        try:
            return int(text_value)
        except ValueError:
            continue
    return fallback


def _ideals_bonds_flaws(value: Any, answer: str, source_text: str = "", class_and_subclass: str = "") -> dict[str, str]:
    if isinstance(value, dict):
        normalized = {
            key: str(value.get(key) or "").strip()
            for key in ("ideal", "bond", "flaw")
            if str(value.get(key) or "").strip()
        }
        if normalized:
            return normalized

    ideal = _extract_labeled(answer, "Ideal")
    bond = _extract_labeled(answer, "Bond")
    flaw = _extract_labeled(answer, "Flaw")
    combined = _extract_labeled(answer, "Ideals/Bonds/Flaws")
    inferred = _infer_ideals_bonds_flaws(source_text, class_and_subclass)
    return {
        "ideal": ideal or _extract_prefixed_value(combined, "Ideal") or inferred["ideal"],
        "bond": bond or _extract_prefixed_value(combined, "Bond") or inferred["bond"],
        "flaw": flaw or _extract_prefixed_value(combined, "Flaw") or inferred["flaw"],
    }


def _infer_ideals_bonds_flaws(value: str, class_and_subclass: str) -> dict[str, str]:
    text = f"{value} {class_and_subclass}".lower()
    if re.search(r"\brival\b", text):
        return {
            "ideal": "Prove that skill and nerve matter more than reputation.",
            "bond": "Shares a lead, mentor, or enemy with the party.",
            "flaw": "Turns collaboration into a contest when pride is touched.",
        }
    if re.search(r"\bcleric|healer|priest|paladin\b", text):
        return {
            "ideal": "Mercy should still have teeth when innocent people are threatened.",
            "bond": "Serves a shrine, oath, or patient endangered by the current plot.",
            "flaw": "Takes responsibility for wounds they could not have prevented.",
        }
    if re.search(r"\brogue|thief|spy|informant\b", text):
        return {
            "ideal": "Information should free people from bad bargains.",
            "bond": "Protects a source who knows too much about the current lead.",
            "flaw": "Withholds the full truth until every exit is mapped.",
        }
    if re.search(r"\bwizard|sage|scholar|artificer\b", text):
        return {
            "ideal": "A dangerous truth is safer studied than buried.",
            "bond": "Needs one recovered clue to finish a theory about the campaign threat.",
            "flaw": "Treats urgent danger like a problem that can wait for one more note.",
        }
    if re.search(r"\bbarbarian|fighter|gauntlets?|soldier\b", text):
        return {
            "ideal": "Stand where the danger is thickest so someone weaker can move.",
            "bond": "Owes loyalty to a unit, mentor, or survivor tied to the next lead.",
            "flaw": "Answers pressure with force before asking who benefits.",
        }
    return {
        "ideal": "Do right by people caught in larger schemes.",
        "bond": "Owes a debt to someone tied to the campaign.",
        "flaw": "Keeps secrets until trust is undeniable.",
    }


def _extract_prefixed_value(value: str, label: str) -> str:
    match = re.search(rf"\b{re.escape(label)}\s*:\s*([^.;]+)", str(value or ""), flags=re.IGNORECASE)
    return match.group(1).strip() if match else ""


def _text_field(data: dict[str, Any], key: str) -> str:
    value = data.get(key)
    return str(value).strip() if value is not None and str(value).strip() else ""


def _text_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        return _split_text_items(value)
    return []


def _split_text_items(value: str) -> list[str]:
    cleaned = _clean_markdown_text(value)
    if not cleaned:
        return []
    parts = re.split(r"\s*(?:,|;|\n|\s+-\s+)\s*", cleaned)
    return [part.strip(" .:-") for part in parts if part.strip(" .:-")]


def _positive_int(value: Any, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def _nonnegative_int(value: Any, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed >= 0 else default


def _extract_npc_name(answer: str) -> str:
    bold = re.search(r"\*\*([A-Z][A-Za-z' -]+?)\*\*", answer)
    if bold:
        return bold.group(1).strip()

    quoted_full_name = re.search(
        r"\b(?:You encounter|Meet|Here is|Here'?s|Introducing)\s+['\"]([^'\"]{2,40})['\"]\s+([A-Z][A-Za-z']+(?:\s+[A-Z][A-Za-z']+){0,2})",
        answer,
        flags=re.IGNORECASE,
    )
    if quoted_full_name:
        return f"\"{quoted_full_name.group(1).strip()}\" {quoted_full_name.group(2).strip()}"

    named = re.search(
        r"\b(?:named|called|encounter)\s+((?:Sir|Lady|Lord|Captain|Mayor|Keeper|Agent|Scout|Mage|Wizard|Rogue|Guard|Innkeeper)\s+)?([A-Z][A-Za-z']+(?:\s+(?:\"[^\"]+\"|[A-Z][A-Za-z']+)){0,3})",
        answer,
    )
    if named:
        return f"{named.group(1) or ''}{named.group(2)}".strip()
    return ""


def _extract_role(answer: str) -> str:
    role = re.search(r"\b(?:is|as)\s+a\s+([^.,:\n]+?)(?:\s+named|\s+who|,|\.|\n)", answer, flags=re.IGNORECASE)
    if role:
        return role.group(1).strip().capitalize()
    if re.search(r"\bknight\b", answer, flags=re.IGNORECASE):
        return "Knight"
    if re.search(r"\bguard\b", answer, flags=re.IGNORECASE):
        return "Guard"
    return ""


def _extract_labeled(answer: str, label: str) -> str:
    pattern = (
        rf"(?:^|\n)\s*[*-]?\s*\*?\*?{re.escape(label)}\*?\*?\s*:\s*"
        r"(.+?)(?=\n\s*[*-]?\s*\*?\*?[A-Z][A-Za-z ]{2,32}\*?\*?\s*:|\Z)"
    )
    match = re.search(pattern, answer, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return ""
    return _clean_markdown_text(match.group(1))


def _extract_labeled_list(answer: str, label: str) -> list[str]:
    return _split_text_items(_extract_labeled(answer, label))


def _extract_environment_sentence(answer: str) -> str:
    return _matching_sentence(
        answer,
        r"\b(?:environment|terrain|battlefield|road|forest|ruins?|cavern|street|temple|swamp|cover|hazard)\b",
    )


def _extract_tactics_sentence(answer: str) -> str:
    return _matching_sentence(answer, r"\b(?:tactic|ambush|flank|focus|retreat|target|harry|pressure|control|reinforcement)\b")


def _matching_sentence(answer: str, pattern: str) -> str:
    sentences = re.split(r"(?<=[.!?])\s+", _clean_markdown_text(answer))
    for sentence in sentences:
        cleaned = sentence.strip()
        if cleaned and re.search(pattern, cleaned, flags=re.IGNORECASE):
            return cleaned
    return ""


def _first_sentence(answer: str) -> str:
    cleaned = _clean_markdown_text(answer)
    sentences = re.split(r"(?<=[.!?])\s+", cleaned)
    return sentences[0].strip() if sentences and sentences[0].strip() else "A table-ready NPC generated from the current request."


def _fallback_npc_description(answer: str) -> str:
    first = _first_sentence(answer)
    context = _campaign_context_sentence(answer, first)
    if context:
        return f"{first} {context}"
    return first


def _campaign_context_sentence(answer: str, first_sentence: str) -> str:
    sentences = re.split(r"(?<=[.!?])\s+", _clean_markdown_text(answer))
    for sentence in sentences[1:]:
        cleaned = sentence.strip()
        if cleaned and cleaned != first_sentence and re.search(
            r"\b(?:captain|quest|party|betrayal|campaign|session|hook|clue|secret|faction)\b",
            cleaned,
            flags=re.IGNORECASE,
        ):
            return cleaned
    return ""


def _extract_mission_sentence(text: str) -> str:
    sentences = re.split(r"(?<=[.!?])\s+", _clean_markdown_text(text))
    for sentence in sentences:
        if re.search(r"\b(?:mission|ask|secure|investigate|recover|find|lead)\b", sentence, flags=re.IGNORECASE):
            return sentence.strip()
    return ""


def _clean_markdown_text(value: str) -> str:
    cleaned = re.sub(r"\*\*(.*?)\*\*", r"\1", value)
    cleaned = re.sub(r"^\s*[*-]\s*", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip(" -*\n\t")


def _normalize_suggested_actions(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    actions: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        try:
            actions.append(SuggestedAction(**item).model_dump())
        except (TypeError, ValueError, ValidationError):
            continue
    return actions


def _normalize_session_summary(value: dict[str, Any]) -> dict[str, Any]:
    summary = str(value.get("summary") or value.get("answer") or "").strip()
    if not summary:
        summary = "No substantial notes were provided."

    return {
        "summary": summary,
        "importantEvents": _string_list(value.get("importantEvents")),
        "npcs": _object_list(value.get("npcs"), "name"),
        "locations": _object_list(value.get("locations"), "name"),
        "quests": _object_list(value.get("quests"), "title", {"status": "open"}),
        "encounters": _object_list(value.get("encounters"), "title"),
        "items": _string_list(value.get("items")),
        "unresolvedHooks": _string_list(value.get("unresolvedHooks")),
    }


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _object_list(value: Any, text_key: str, defaults: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    normalized = []
    for item in value:
        if isinstance(item, dict):
            if not str(item.get(text_key) or "").strip():
                continue
            normalized.append((defaults or {}) | item)
        elif str(item).strip():
            normalized.append((defaults or {}) | {text_key: str(item).strip()})
    return normalized


def _dedupe_citations(citations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen = set()
    deduped = []
    for citation in citations:
        key = (citation.get("documentId"), citation.get("chunkId"), citation.get("heading"))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(citation)
    return deduped


def _safe_error_detail(response: httpx.Response, provider_label: str = "Gemini") -> str:
    try:
        payload = response.json()
    except ValueError:
        return response.text[:500]

    error = payload.get("error") if isinstance(payload, dict) else None
    if isinstance(error, dict):
        return str(error.get("message") or error.get("status") or f"Unknown {provider_label} error")
    return str(payload)[:500]
