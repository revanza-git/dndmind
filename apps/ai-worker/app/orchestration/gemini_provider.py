import json
import os
import re
from typing import Any

import httpx
from pydantic import ValidationError

from app.orchestration.structured_output import build_suggested_actions
from app.orchestration.tool_loop import detect_prompt_intent, prompt_conflicts_with_mode, run_provider_tool_loop, selected_mode_intent
from app.schemas.structured_outputs import (
    DiceRollOutput,
    EncounterOutput,
    InitiativeOrderOutput,
    LocationOutput,
    NpcOutput,
    QuestOutput,
    SessionSummaryOutput,
    StructuredOutput,
    SuggestedAction,
)
from rag.retriever import search_homebrew, search_memory, search_rules


STRUCTURED_MODELS = {
    "npc": NpcOutput,
    "quest": QuestOutput,
    "location": LocationOutput,
    "encounter": EncounterOutput,
    "session_summary": SessionSummaryOutput,
    "initiative_order": InitiativeOrderOutput,
    "dice_roll": DiceRollOutput,
}


def real_chat_response(request: Any) -> dict[str, Any]:
    _ensure_gemini_provider()

    retrieved_context, retrieved_citations = _retrieve_context(request)
    tool_calls, tool_citations = run_provider_tool_loop(request)
    model_payload = _call_gemini(request, retrieved_context, tool_calls)

    structured_output = _normalize_structured_output(model_payload.get("structuredOutput"))
    suggested_actions = _normalize_suggested_actions(model_payload.get("suggestedActions"))
    answer = str(model_payload.get("answer") or "").strip()
    if not answer:
        answer = "Gemini returned an empty answer. Try rephrasing the request or checking the model configuration."
    used_structured_fallback = False
    if structured_output is None:
        structured_output = _fallback_structured_output(request, answer, model_payload.get("structuredOutput"))
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


def _ensure_gemini_provider() -> None:
    provider = os.getenv("LLM_PROVIDER", "gemini").lower()
    if provider != "gemini":
        raise RuntimeError(f"Unsupported LLM_PROVIDER '{provider}'. Set LLM_PROVIDER=gemini for Gemini AI mode.")


def _call_gemini(request: Any, retrieved_context: str, tool_calls: list[dict[str, Any]]) -> dict[str, Any]:
    parsed = _generate_json(_system_instruction(), _user_prompt(request, retrieved_context, tool_calls))
    return parsed or {}


def _generate_json(system_instruction: str, user_prompt: str) -> dict[str, Any] | None:
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is required when MOCK_LLM=false and LLM_PROVIDER=gemini.")

    model = os.getenv("GEMINI_MODEL") or os.getenv("CHAT_MODEL") or "gemini-2.5-flash"
    model_path = model if model.startswith("models/") else f"models/{model}"
    url = f"https://generativelanguage.googleapis.com/v1beta/{model_path}:generateContent"

    payload = {
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
            "temperature": float(os.getenv("GEMINI_TEMPERATURE", "0.7")),
            "responseMimeType": "application/json",
        },
    }

    try:
        response = httpx.post(
            url,
            headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
            json=payload,
            timeout=float(os.getenv("GEMINI_TIMEOUT_SECONDS", "45")),
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        detail = _safe_error_detail(exc.response)
        raise RuntimeError(f"Gemini request failed with HTTP {exc.response.status_code}: {detail}") from exc
    except httpx.HTTPError as exc:
        raise RuntimeError(f"Gemini request failed: {exc}") from exc

    text = _extract_text(response.json())
    if not text:
        return None
    return _parse_json_object(text) or {"answer": text}


def _retrieve_context(request: Any) -> tuple[str, list[dict[str, Any]]]:
    sections: list[str] = []
    citations: list[dict[str, Any]] = []
    lower = str(request.message or "").lower()
    intent = detect_prompt_intent(request.message)
    rules_like = "rules" in intent.detected or (
        selected_mode_intent(request.mode) == "rules" and not prompt_conflicts_with_mode(intent, request.mode)
    )
    memory_like = any(item in intent.detected for item in ("memory", "npc", "quest")) or any(
        term in lower for term in ["last session", "previous", "betray", "betrayed"]
    )

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
        "Return only one JSON object with keys: answer, structuredOutput, suggestedActions. "
        "structuredOutput must be null or an object with type and data. Valid types are "
        "npc, quest, location, encounter, session_summary, initiative_order, dice_roll. "
        "suggestedActions must use these case-sensitive action names when applicable: "
        "saveNPC, saveQuest, saveLocation, saveEncounter, saveSessionSummary, prompt."
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
        "When you return a structuredOutput, make its data complete enough for the UI save action.\n\n"
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


def _fallback_structured_output(request: Any, answer: str, raw_output: Any) -> dict[str, Any] | None:
    requested_type = _requested_structured_type(request)
    if requested_type not in {"npc", "encounter"}:
        return None

    data = raw_output.get("data") if isinstance(raw_output, dict) and isinstance(raw_output.get("data"), dict) else {}
    if requested_type == "npc":
        candidate = _npc_fallback_data(request, answer, data)
        model = NpcOutput
    else:
        candidate = _encounter_fallback_data(request, answer, data)
        model = EncounterOutput

    try:
        normalized = model(**candidate).model_dump()
    except (TypeError, ValueError, ValidationError):
        return None
    return StructuredOutput(type=requested_type, data=normalized).model_dump()


def _requested_structured_type(request: Any) -> str | None:
    message = str(getattr(request, "message", "") or "").strip()
    intent = detect_prompt_intent(message)
    if "npc" in intent.detected:
        return "npc"
    if "encounter" in intent.detected:
        return "encounter"

    mode = str(getattr(request, "mode", "") or "").strip().lower()
    if mode in {"npc", "encounter"} and not prompt_conflicts_with_mode(intent, mode):
        return mode
    return None


def _encounter_fallback_data(request: Any, answer: str, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": (
            _text_field(data, "title")
            or _extract_labeled(answer, "Title")
            or _extract_encounter_title(answer)
            or _title_from_request(request, "Generated Encounter")
        ),
        "difficulty": _encounter_difficulty(request, answer, data),
        "environment": (
            _text_field(data, "environment")
            or _extract_labeled(answer, "Environment")
            or _extract_labeled(answer, "Terrain")
            or _extract_environment_sentence(answer)
            or "A flexible battlefield with useful cover, a clear objective, and one terrain complication the DM can emphasize."
        ),
        "monsters": _encounter_monsters(data, answer),
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
    match = re.search(r"\b(easy|medium|hard|deadly|unknown)\b", str(value or ""), flags=re.IGNORECASE)
    return match.group(1).capitalize() if match else "Unknown"


def _encounter_difficulty(request: Any, answer: str, data: dict[str, Any]) -> str:
    for value in (
        _text_field(data, "difficulty"),
        _extract_difficulty(answer),
        _extract_difficulty(str(getattr(request, "message", "") or "")),
    ):
        if not value:
            continue
        normalized = _normalize_difficulty(value)
        if normalized != "Unknown" or re.search(r"\bunknown\b", value, flags=re.IGNORECASE):
            return normalized
    return "Unknown"


def _extract_difficulty(text: str) -> str:
    match = re.search(r"\b(easy|medium|hard|deadly|unknown)\b", str(text or ""), flags=re.IGNORECASE)
    return match.group(1) if match else ""


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

    return [_monster_from_answer(answer) or {"name": "Encounter Foe", "count": 1, "role": "primary threat", "xp": 0}]


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
                    "xp": _nonnegative_int(item.get("xp"), 0),
                }
            )
        elif str(item).strip():
            monsters.append(_monster_from_text(str(item)))
    return monsters


def _monster_from_answer(answer: str) -> dict[str, Any] | None:
    lower = str(answer or "").lower()
    for name, role in (
        ("Cultist", "fanatic striker"),
        ("Bandit", "mobile skirmisher"),
        ("Orc", "bruiser"),
        ("Skeleton", "front-line minion"),
        ("Goblin", "mobile skirmisher"),
        ("Dragon", "solo boss"),
    ):
        if name.lower() in lower:
            return {"name": name, "count": 1, "role": role, "xp": 0}
    return None


def _monster_from_text(text: str) -> dict[str, Any]:
    count_match = re.search(r"\b(\d+)\b", text)
    count = _positive_int(count_match.group(1) if count_match else None, 1)
    cleaned = re.sub(r"\b\d+\b", "", text)
    cleaned = re.sub(r"\([^)]*\)", "", cleaned)
    name = _clean_markdown_text(cleaned).strip(" ,:-") or "Encounter Foe"
    return {"name": name, "count": count, "role": "combatant", "xp": 0}


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
    name = _text_field(data, "name") or _extract_npc_name(answer) or "Generated NPC"
    role = _text_field(data, "role") or _extract_role(answer) or "Campaign NPC"
    description = _text_field(data, "description") or _extract_labeled(answer, "Appearance") or _fallback_npc_description(answer)
    personality = _text_field(data, "personality") or _extract_labeled(answer, "Personality") or "Practical, watchful, and shaped by recent trouble."
    motivation = _text_field(data, "motivation") or _extract_labeled(answer, "Motivation") or "Protect their own interests while responding to the campaign's current pressure."
    relationship = (
        _text_field(data, "relationshipToParty")
        or _extract_labeled(answer, "Connection to Campaign")
        or _extract_labeled(answer, "Party Link")
        or "A useful contact who can become an ally, obstacle, or source depending on how the party approaches them."
    )
    quest_hook = (
        _text_field(data, "questHook")
        or _extract_labeled(answer, "Quest Hook")
        or _extract_mission_sentence(relationship)
        or "Have this NPC ask the party to investigate one concrete lead tied to the current campaign memory."
    )

    return {
        "name": name,
        "role": role,
        "raceOrSpecies": _text_field(data, "raceOrSpecies") or _extract_labeled(answer, "Race") or "Humanoid",
        "description": description,
        "personality": personality,
        "motivation": motivation,
        "secret": _text_field(data, "secret") or _extract_labeled(answer, "Secret") or "They know more about the current threat than they are ready to admit.",
        "relationshipToParty": relationship,
        "questHook": quest_hook,
    }


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


def _safe_error_detail(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return response.text[:500]

    error = payload.get("error") if isinstance(payload, dict) else None
    if isinstance(error, dict):
        return str(error.get("message") or error.get("status") or "Unknown Gemini error")
    return str(payload)[:500]
