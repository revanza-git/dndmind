from typing import Any

from app.schemas.structured_outputs import (
    DiceRollOutput,
    EncounterMonsterOutput,
    EncounterOutput,
    EncounterScalingOutput,
    InitiativeEntryOutput,
    InitiativeOrderOutput,
    LocationOutput,
    NpcOutput,
    QuestOutput,
    SessionSummaryOutput,
    StructuredOutput,
    SuggestedAction,
)


def build_mock_structured_output(request: Any, tool_calls: list[dict[str, Any]]) -> dict[str, Any] | None:
    tool_output = _structured_from_tools(tool_calls)
    if tool_output:
        return tool_output

    lower = request.message.lower()
    mode = request.mode.lower()

    if mode == "npc" or "npc" in lower:
        return _as_output("npc", _mock_npc(request))
    if mode == "encounter" or "encounter" in lower or "ambush" in lower:
        return _as_output("encounter", _mock_encounter(request, tool_calls))
    if mode == "summarize" or "summarize" in lower:
        return _as_output("session_summary", _mock_session_summary_card(request))
    if "quest" in lower:
        return _as_output("quest", _mock_quest(request))
    if any(term in lower for term in ["location", "town", "city", "dungeon", "temple"]):
        return _as_output("location", _mock_location(request))

    return None


def build_suggested_actions(structured_output: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not structured_output:
        return [
            SuggestedAction(label="Generate NPC", action="prompt", payload={"message": "Generate a suspicious tavern keeper NPC."}).model_dump(),
            SuggestedAction(label="Create Quest", action="prompt", payload={"message": "Create a quest hook based on the cult from last session."}).model_dump(),
        ]

    output_type = structured_output["type"]
    data = structured_output["data"]
    mapping = {
        "npc": ("Save NPC", "saveNPC"),
        "quest": ("Save Quest", "saveQuest"),
        "location": ("Save Location", "saveLocation"),
        "encounter": ("Save Encounter", "saveEncounter"),
        "session_summary": ("Save Session Summary", "saveSessionSummary"),
    }
    if output_type not in mapping:
        return []

    label, action = mapping[output_type]
    return [SuggestedAction(label=label, action=action, payload=data).model_dump()]


def _structured_from_tools(tool_calls: list[dict[str, Any]]) -> dict[str, Any] | None:
    for call in tool_calls:
        if not call.get("success"):
            continue
        result = call.get("result") or {}
        if call["toolName"] == "rollDice":
            data = DiceRollOutput(
                expression=str(result.get("expression", "1d20")),
                rolls=list(result.get("rolls") or []),
                modifier=int(result.get("modifier") or 0),
                total=int(result.get("total") or 0),
            )
            return _as_output("dice_roll", data)
        if call["toolName"] == "generateInitiativeOrder":
            order = [
                InitiativeEntryOutput(
                    name=str(entry.get("name", "Unknown")),
                    roll=int(entry.get("roll") or 0),
                    modifier=int(entry.get("initiativeModifier") or entry.get("modifier") or 0),
                    total=int(entry.get("total") or 0),
                )
                for entry in result.get("order", [])
            ]
            return _as_output("initiative_order", InitiativeOrderOutput(order=order))
    return None


def _mock_npc(request: Any) -> NpcOutput:
    lower = request.message.lower()
    role = "Tavern keeper" if "tavern" in lower else "Local informant"
    name = "Vessa Cinderglass" if "tavern" in lower else "Marra Vale"
    return NpcOutput(
        name=name,
        role=role,
        raceOrSpecies="Human",
        description="A careful observer with soot-dark sleeves, polished manners, and a habit of pausing before every answer.",
        personality="Warm in public, guarded in private, and quietly excellent at reading desperation.",
        motivation="Keep the town stable while protecting a secret ledger of cult payments.",
        secret="They know which Blackwater merchant has been moving supplies for the cult.",
        relationshipToParty="Useful but cautious; they will trade truth for proof the party can keep them safe.",
        questHook="Recover the missing ledger page before the Ashen Knives burn the inn's cellar records.",
    )


def _mock_quest(request: Any) -> QuestOutput:
    return QuestOutput(
        title="Ashes in the Ledger",
        description="A coded payment trail points from last session's cult activity to a respected Blackwater patron.",
        relatedNpcs=["Vessa Cinderglass", "Captain Vey"],
        objectives=[
            "Decode the cult payment marks.",
            "Question the courier seen near the old mill.",
            "Recover the missing ledger page before dawn.",
        ],
        reward="A favor from the Dawn Bell and access to the sealed town archive.",
        unresolvedHooks=["Who paid Captain Vey?", "Why is the cult buying mining lanterns?"],
    )


def _mock_location(request: Any) -> LocationOutput:
    lower = request.message.lower()
    name = "The Rootglass Temple" if "temple" in lower else "Miregate Outpost"
    location_type = "temple" if "temple" in lower else "frontier site"
    return LocationOutput(
        name=name,
        type=location_type,
        description="A damp stone landmark where old warding marks have been scratched away and replaced with ash-black sigils.",
        dangerLevel="medium",
        secrets=["A hidden stair drops into pre-town ruins.", "The newest sigils were carved by someone wearing a town guard ring."],
        notableNpcs=["Orren Vale", "An unnamed Ashen Knives scout"],
        questHooks=["Find who broke the wards.", "Recover the bell-clapper buried under the east arch."],
    )


def _mock_encounter(request: Any, tool_calls: list[dict[str, Any]]) -> EncounterOutput:
    difficulty = "Unknown"
    for call in tool_calls:
        if call.get("success") and call["toolName"] == "calculateEncounterDifficulty":
            difficulty = str((call.get("result") or {}).get("difficulty") or "Unknown")
            break

    hard_requested = "hard" in request.message.lower()
    if hard_requested:
        difficulty = "Hard"

    return EncounterOutput(
        title="Blackpine Ambush",
        difficulty=difficulty,
        environment="A rain-slick forest road split by fallen pines, shallow ditches, and lantern light through fog.",
        monsters=[
            EncounterMonsterOutput(name="Goblin Thorn-Skirmisher", count=4, role="mobile harrier", xp=50),
            EncounterMonsterOutput(name="Ashen Knife Lookout", count=1, role="ranged controller", xp=100),
        ],
        tactics="The skirmishers draw the front line into difficult terrain while the lookout targets healers and anyone carrying a map.",
        scalingOptions=EncounterScalingOutput(
            easier="Remove the lookout or let the party notice the tripwire before initiative.",
            harder="Add a second wave from the ditch on round 3 or give the lookout a smoke bomb escape.",
        ),
        rewards=["Cult-marked lantern", "Map scrap showing a mine spur", "15 gp in mixed coin"],
        campaignHooks=["The ambushers recognize Captain Vey's name.", "One goblin carries a token from Blackwater's old shrine."],
    )


def _mock_session_summary_card(request: Any) -> SessionSummaryOutput:
    return SessionSummaryOutput(
        summary="The party pushed deeper into Blackwater's conspiracy, confirming that betrayal and cult money are now tangled together.",
        importantEvents=[
            "Captain Vey's betrayal remains the central fracture in the party's trust.",
            "The Dawn Shard changed hands and drew attention from the Ashen Knives.",
        ],
        npcs=["Captain Vey", "Mira Thorn"],
        locations=["Blackwater Mine", "old smuggler tunnel"],
        quests=["Find who paid Vey", "Protect the Dawn Shard"],
        items=["Dawn Shard", "sold map"],
        unresolvedHooks=["Who financed the betrayal?", "Where does the smuggler tunnel surface?"],
        nextSessionSetup="Open with the party finding Vey's abandoned signet near a fresh set of cart tracks.",
    )


def _as_output(output_type: str, model: Any) -> dict[str, Any]:
    return StructuredOutput(type=output_type, data=model.model_dump()).model_dump()

