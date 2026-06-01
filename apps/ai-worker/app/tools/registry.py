from dataclasses import dataclass
from typing import Any, Callable

from .dice import roll_dice
from .encounters import calculate_encounter_difficulty
from .initiative import generate_initiative_order
from .rag_tools import search_campaign_memory_tool, search_rules_tool
from .save_tools import save_npc, save_quest, save_session_summary


ToolHandler = Callable[[dict[str, Any], dict[str, Any] | None], dict[str, Any]]


@dataclass(frozen=True)
class ToolDefinition:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: ToolHandler


TOOLS: dict[str, ToolDefinition] = {
    "rollDice": ToolDefinition(
        name="rollDice",
        description="Roll dice using tabletop dice notation.",
        parameters={
            "type": "object",
            "properties": {"expression": {"type": "string"}},
            "required": ["expression"],
        },
        handler=roll_dice,
    ),
    "generateInitiativeOrder": ToolDefinition(
        name="generateInitiativeOrder",
        description="Generate initiative order from characters and initiative modifiers.",
        parameters={
            "type": "object",
            "properties": {
                "characters": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {"name": {"type": "string"}, "initiativeModifier": {"type": "integer"}},
                        "required": ["name"],
                    },
                }
            },
            "required": ["characters"],
        },
        handler=generate_initiative_order,
    ),
    "calculateEncounterDifficulty": ToolDefinition(
        name="calculateEncounterDifficulty",
        description="Calculate approximate D&D encounter difficulty.",
        parameters={
            "type": "object",
            "properties": {"party": {"type": "array"}, "monsters": {"type": "array"}},
            "required": ["party", "monsters"],
        },
        handler=calculate_encounter_difficulty,
    ),
    "searchRules": ToolDefinition(
        name="searchRules",
        description="Search ingested rules chunks.",
        parameters={"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]},
        handler=search_rules_tool,
    ),
    "searchCampaignMemory": ToolDefinition(
        name="searchCampaignMemory",
        description="Search campaign memory chunks for the active campaign.",
        parameters={"type": "object", "properties": {"query": {"type": "string"}, "campaignId": {"type": "string"}}, "required": ["query"]},
        handler=search_campaign_memory_tool,
    ),
    "saveNPC": ToolDefinition(
        name="saveNPC",
        description="Save a generated NPC into campaign memory.",
        parameters={"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]},
        handler=save_npc,
    ),
    "saveQuest": ToolDefinition(
        name="saveQuest",
        description="Save a generated quest into campaign memory.",
        parameters={"type": "object", "properties": {"title": {"type": "string"}}, "required": ["title"]},
        handler=save_quest,
    ),
    "saveSessionSummary": ToolDefinition(
        name="saveSessionSummary",
        description="Save a session summary and embed it as campaign memory.",
        parameters={"type": "object", "properties": {"sessionId": {"type": "string"}, "summary": {"type": "string"}}, "required": ["sessionId", "summary"]},
        handler=save_session_summary,
    ),
}


def get_tool(name: str) -> ToolDefinition:
    if name not in TOOLS:
        raise KeyError(f"Unknown tool: {name}")
    return TOOLS[name]


def tool_schemas() -> list[dict[str, Any]]:
    return [
        {
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.parameters,
        }
        for tool in TOOLS.values()
    ]


def execute_tool(name: str, arguments: dict[str, Any], context: dict[str, Any] | None = None) -> dict[str, Any]:
    tool = get_tool(name)
    return tool.handler(arguments, context or {})

