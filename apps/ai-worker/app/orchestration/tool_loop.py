from typing import Any

from app.tools.dice import extract_dice_expression
from app.tools.registry import execute_tool, tool_schemas


def execute_manual_tool(tool_name: str, arguments: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    return _tool_call_response(tool_name, arguments, context)


def run_mock_tool_loop(request: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any] | None]:
    context = {
        "campaignId": request.campaignId,
        "conversationId": request.conversationId,
        "clientOwnerId": request.clientOwnerId,
        "party": [member.model_dump() for member in request.party],
    }
    planned = _plan_mock_tools(request)
    tool_calls = [_tool_call_response(name, args, context) for name, args in planned]

    citations: list[dict[str, Any]] = []
    structured_output = None
    for call in tool_calls:
        result = call.get("result") or {}
        if isinstance(result, dict):
            citations.extend(result.get("citations") or [])
            if call["toolName"] in {"saveNPC", "saveQuest"}:
                structured_output = result

    return tool_calls, citations, structured_output


def provider_tooling_note() -> dict[str, Any]:
    return {
        "toolSchemas": tool_schemas(),
        "note": "OpenAI-compatible tool schemas are prepared; provider execution can call execute_tool for requested tool calls.",
    }


def _plan_mock_tools(request: Any) -> list[tuple[str, dict[str, Any]]]:
    message = request.message
    lower = message.lower()
    mode = request.mode.lower()
    tools: list[tuple[str, dict[str, Any]]] = []

    expression = extract_dice_expression(message)
    if expression or ("roll" in lower and "initiative" not in lower):
        tools.append(("rollDice", {"expression": expression or "1d20"}))

    if "initiative" in lower:
        characters = [
            {"name": member.name, "initiativeModifier": _initiative_modifier(member)}
            for member in request.party
        ]
        if not characters:
            characters = [{"name": "Goblin Scout", "initiativeModifier": 2}, {"name": "Bandit", "initiativeModifier": 1}]
        tools.append(("generateInitiativeOrder", {"characters": characters}))

    if mode == "encounter" or "encounter" in lower:
        party = [{"name": member.name, "level": member.level} for member in request.party]
        monsters = _infer_monsters(message)
        tools.append(("calculateEncounterDifficulty", {"party": party, "monsters": monsters}))

    if mode == "rules":
        tools.append(("searchRules", {"query": message, "limit": 4}))

    if request.context.useRules and "rule" in lower and mode != "rules":
        tools.append(("searchRules", {"query": message, "limit": 4}))

    if request.context.useCampaignMemory and any(term in lower for term in ["previous", "last session", "memory", "npc", "quest", "betray", "betrayed"]):
        tools.append(("searchCampaignMemory", {"query": message, "limit": 4}))

    return tools


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
    # MVP heuristic: use level as a tiny proxy when character sheets do not yet store DEX.
    return max(0, min(5, member.level // 2))


def _infer_monsters(message: str) -> list[dict[str, Any]]:
    lower = message.lower()
    if "goblin" in lower:
        return [{"name": "Goblin", "count": 4, "xp": 50}]
    if "orc" in lower:
        return [{"name": "Orc", "count": 3, "xp": 100}]
    return [{"name": "Goblin", "count": 4, "xp": 50}]
