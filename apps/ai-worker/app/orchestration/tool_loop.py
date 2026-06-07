import re
from dataclasses import dataclass
from typing import Any

from app.tools.dice import extract_dice_expression
from app.tools.registry import execute_tool, tool_schemas


@dataclass(frozen=True)
class PromptIntent:
    primary: str | None
    detected: tuple[str, ...]
    is_strong: bool

    def as_payload(self) -> dict[str, Any]:
        return {
            "primary": self.primary,
            "detected": list(self.detected),
            "isStrong": self.is_strong,
        }


_MODE_TO_INTENT = {
    "rules": "rules",
    "encounter": "encounter",
    "npc": "npc",
    "character": "character",
    "combat": "combat",
    "recap": "recap",
    "summarize": "summarize",
}

_INTENT_PATTERNS: dict[str, tuple[str, ...]] = {
    "rules": (
        r"\brules?\b",
        r"\bruling\b",
        r"\bmechanic(?:s|al)?\b",
        r"\badvantage\b",
        r"\bdisadvantage\b",
        r"\bability checks?\b",
        r"\bsaving throws?\b",
        r"\battack rolls?\b",
        r"\bspell slots?\b",
        r"\bconcentration\b",
        r"\bbonus action\b",
        r"\breactions?\b",
        r"\bconditions?\b",
        r"\bgrappl(?:e|ing)\b",
        r"\bcover\b",
        r"\bdifficult terrain\b",
        r"\bproficiency\b",
        r"\bhow (?:do|does|would|should)\b.+\bwork\b",
    ),
    "story": (
        r"\bdescribe\b",
        r"\bnarrat(?:e|ion)\b",
        r"\bscene\b",
        r"\bread[- ]aloud\b",
        r"\bboxed text\b",
        r"\batmosphere\b",
        r"\bflavor\b",
        r"\bopening\b",
        r"\bentrance\b",
    ),
    "encounter": (
        r"\bencounters?\b",
        r"\bambush(?:es)?\b",
        r"\bboss fight\b",
        r"\bmonster(?:s)?\b",
        r"\bcombat encounter\b",
        r"\bdeadly\b",
        r"\bhard ambush\b",
        r"\bbalanc(?:e|ed|ing)\b",
    ),
    "npc": (
        r"\bnpcs?\b",
        r"\bnon[- ]player character\b",
        r"\btavern keeper\b",
        r"\binnkeeper\b",
        r"\binformant\b",
        r"\bmerchant\b",
        r"\bvillain\b",
        r"\bguard captain\b",
        r"\bquest giver\b",
    ),
    "character": (
        r"\bplayable character\b",
        r"\bplayer character\b",
        r"\bbackup character\b",
        r"\bbackup pc\b",
        r"\brival adventurer\b",
        r"\badventuring rival\b",
        r"\bhireling\b",
        r"\bretainer\b",
        r"\badventurer\b",
        r"\bgenerate\s+a\s+level\s+\d+\b",
        r"\b(?:create|generate|make)\b.{0,60}\b(?:ranger|cleric|fighter|wizard|rogue|bard|paladin|druid|barbarian|monk|warlock|sorcerer|artificer)\b",
    ),
    "combat": (
        r"\bcombat\b",
        r"\binitiative\b",
        r"\bturn order\b",
        r"\brounds?\b",
        r"\baction economy\b",
    ),
    "summarize": (
        r"\bsummar(?:y|ize|ise|izing)\b",
        r"\bsession notes?\b",
        r"\bextract unresolved hooks?\b",
        r"\bimportant events?\b",
    ),
    "recap": (
        r"\brecap\b",
        r"\bpreviously\b",
        r"\bwhat happened so far\b",
        r"\bcampaign so far\b",
        r"\bstory so far\b",
        r"\blast session\b",
    ),
    "memory": (
        r"\bcampaign memory\b",
        r"\bremember\b",
        r"\blast session\b",
        r"\bprevious(?:ly)?\b",
        r"\bwhat happened\b",
        r"\bbetray(?:al|ed|s)?\b",
    ),
    "quest": (
        r"\bquests?\b",
        r"\bhooks?\b",
        r"\bobjectives?\b",
        r"\bmissions?\b",
        r"\bunresolved hooks?\b",
    ),
    "location": (
        r"\blocations?\b",
        r"\btowns?\b",
        r"\bcit(?:y|ies)\b",
        r"\bvillages?\b",
        r"\bdungeons?\b",
        r"\btemples?\b",
        r"\bruins?\b",
        r"\bshrines?\b",
        r"\bcastles?\b",
    ),
}

_INTENT_PRIORITY = ("rules", "recap", "summarize", "encounter", "combat", "character", "npc", "quest", "location", "memory", "story")


def execute_manual_tool(tool_name: str, arguments: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    return _tool_call_response(tool_name, arguments, context)


def run_mock_tool_loop(request: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any] | None]:
    tool_calls, citations = run_provider_tool_loop(request)

    structured_output = None
    for call in tool_calls:
        result = call.get("result") or {}
        if isinstance(result, dict) and call["toolName"] in {"saveNPC", "saveQuest"}:
            structured_output = result

    return tool_calls, citations, structured_output


def run_provider_tool_loop(request: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    party = [member.model_dump() for member in request.party] if request.context.usePartyInfo else []
    context = {
        "campaignId": request.campaignId,
        "conversationId": request.conversationId,
        "clientOwnerId": request.clientOwnerId,
        "party": party,
    }
    planned = _plan_mock_tools(request)
    tool_calls = [_tool_call_response(name, args, context) for name, args in planned]

    citations: list[dict[str, Any]] = []
    for call in tool_calls:
        result = call.get("result") or {}
        if isinstance(result, dict):
            citations.extend(result.get("citations") or [])

    return tool_calls, citations


def provider_tooling_note() -> dict[str, Any]:
    return {
        "toolSchemas": tool_schemas(),
        "note": "Tool schemas are prepared; provider execution can call execute_tool for requested tool calls.",
    }


def detect_prompt_intent(message: str) -> PromptIntent:
    lower = str(message or "").lower()
    scores: dict[str, int] = {}
    for intent, patterns in _INTENT_PATTERNS.items():
        score = sum(1 for pattern in patterns if re.search(pattern, lower))
        if score:
            scores[intent] = score

    if not scores:
        return PromptIntent(primary=None, detected=(), is_strong=False)

    ordered = sorted(scores, key=lambda item: (-scores[item], _INTENT_PRIORITY.index(item)))
    primary = ordered[0]
    is_strong = scores[primary] >= 2 or primary in {"rules", "encounter", "combat", "recap", "summarize", "character", "npc"}
    return PromptIntent(primary=primary, detected=tuple(ordered), is_strong=is_strong)


def selected_mode_intent(mode: str) -> str | None:
    return _MODE_TO_INTENT.get(str(mode or "").strip().lower())


def prompt_conflicts_with_mode(intent: PromptIntent, mode: str) -> bool:
    mode_intent = selected_mode_intent(mode)
    if not mode_intent or not intent.is_strong or not intent.primary:
        return False
    return intent.primary != mode_intent


def _plan_mock_tools(request: Any) -> list[tuple[str, dict[str, Any]]]:
    message = request.message
    lower = message.lower()
    mode = request.mode.lower()
    intent = detect_prompt_intent(message)
    tools: list[tuple[str, dict[str, Any]]] = []

    expression = extract_dice_expression(message)
    if expression or ("roll" in lower and "initiative" not in lower):
        tools.append(("rollDice", {"expression": expression or "1d20"}))

    party_members = request.party if request.context.usePartyInfo else []

    if "initiative" in lower:
        characters = [
            {"name": member.name, "initiativeModifier": _initiative_modifier(member)}
            for member in party_members
        ]
        if not characters:
            characters = [{"name": "Goblin Scout", "initiativeModifier": 2}, {"name": "Bandit", "initiativeModifier": 1}]
        tools.append(("generateInitiativeOrder", {"characters": characters}))

    if _should_calculate_encounter(request, intent) and party_members:
        party = [{"name": member.name, "level": member.level} for member in party_members]
        monsters = _infer_monsters(message)
        tools.append(("calculateEncounterDifficulty", {"party": party, "monsters": monsters}))

    if _should_search_rules(request, intent):
        tools.append(("searchRules", {"query": message, "limit": 4}))

    if request.context.useHomebrew and (_should_search_rules(request, intent) or "homebrew" in lower):
        tools.append(("searchHomebrew", {"query": message, "limit": 4}))

    if request.context.useCampaignMemory and _should_search_campaign_memory(request, intent, lower):
        tools.append(("searchCampaignMemory", {"query": message, "limit": 4}))

    return tools


def _should_search_rules(request: Any, intent: PromptIntent) -> bool:
    if not getattr(request.context, "useRules", False):
        return False
    if "rules" in intent.detected:
        return True
    return selected_mode_intent(request.mode) == "rules" and not _strong_non_rules_task(intent)


def _should_calculate_encounter(request: Any, intent: PromptIntent) -> bool:
    if "encounter" in intent.detected:
        return True
    return selected_mode_intent(request.mode) == "encounter" and not _strong_unrelated_to_encounter(intent)


def _should_search_campaign_memory(request: Any, intent: PromptIntent, lower: str) -> bool:
    if selected_mode_intent(request.mode) == "recap" and not prompt_conflicts_with_mode(intent, request.mode):
        return True
    if any(item in intent.detected for item in ("memory", "recap", "npc", "character", "quest")):
        return True
    return any(term in lower for term in ["last session", "previous", "betray", "betrayed"])


def _strong_non_rules_task(intent: PromptIntent) -> bool:
    if "rules" in intent.detected:
        return False
    return bool(intent.is_strong and intent.primary in {"story", "encounter", "character", "npc", "combat", "recap", "summarize", "memory", "quest", "location"})


def _strong_unrelated_to_encounter(intent: PromptIntent) -> bool:
    if not intent.is_strong or "encounter" in intent.detected:
        return False
    return bool(intent.primary in {"rules", "story", "character", "npc", "combat", "recap", "summarize", "memory", "quest", "location"})


def _tool_call_response(tool_name: str, arguments: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    try:
        result = execute_tool(tool_name, arguments, context)
        return {
            "toolName": tool_name,
            "arguments": arguments,
            "result": result,
            "success": True,
            "error": None,
        }
    except Exception as exc:
        return {
            "toolName": tool_name,
            "arguments": arguments,
            "result": None,
            "success": False,
            "error": str(exc),
        }


def _initiative_modifier(member: Any) -> int:
    if getattr(member, "initiativeModifier", None) is not None:
        return int(member.initiativeModifier)
    # MVP heuristic: use level as a tiny proxy when character sheets do not yet store DEX.
    return max(0, min(5, int(member.level) // 2))


def _infer_monsters(message: str) -> list[dict[str, Any]]:
    lower = message.lower()
    if "goblin" in lower:
        return [{"name": "Goblin", "count": 4, "xp": 50}]
    if "orc" in lower:
        return [{"name": "Orc", "count": 3, "xp": 100}]
    return [{"name": "Goblin", "count": 4, "xp": 50}]
