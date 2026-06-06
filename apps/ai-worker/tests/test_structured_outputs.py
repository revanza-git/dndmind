import unittest
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from app.orchestration.structured_output import build_mock_structured_output, build_suggested_actions
from app.orchestration.gemini_provider import _fallback_structured_output, real_chat_response
from app.schemas.structured_outputs import EncounterOutput, NpcOutput


def request(message: str, mode: str = "Auto"):
    return SimpleNamespace(
        message=message,
        mode=mode,
        campaignId=uuid4(),
        conversationId=uuid4(),
        party=[],
    )


class StructuredOutputTests(unittest.TestCase):
    def test_npc_detection_and_schema(self):
        output = build_mock_structured_output(request("Generate a suspicious tavern keeper NPC", "NPC"), [])
        self.assertEqual(output["type"], "npc")
        npc = NpcOutput(**output["data"])
        self.assertTrue(npc.name)
        self.assertTrue(npc.questHook)

    def test_encounter_detection_and_schema(self):
        output = build_mock_structured_output(request("Generate a hard forest ambush encounter", "Encounter"), [])
        self.assertEqual(output["type"], "encounter")
        encounter = EncounterOutput(**output["data"])
        self.assertEqual(encounter.difficulty, "Hard")
        self.assertGreater(len(encounter.monsters), 0)

    def test_rules_mode_npc_prompt_produces_npc_card(self):
        output = build_mock_structured_output(request("Generate a suspicious tavern keeper NPC", "Rules"), [])

        self.assertEqual(output["type"], "npc")

    def test_npc_mode_summarize_prompt_produces_summary_card(self):
        output = build_mock_structured_output(request("Summarize these session notes and extract unresolved hooks.", "NPC"), [])

        self.assertEqual(output["type"], "session_summary")

    def test_dice_tool_becomes_structured_output(self):
        output = build_mock_structured_output(
            request("Roll 1d20+5"),
            [
                {
                    "toolName": "rollDice",
                    "success": True,
                    "result": {"expression": "1d20+5", "rolls": [12], "modifier": 5, "total": 17},
                }
            ],
        )
        self.assertEqual(output["type"], "dice_roll")
        self.assertEqual(output["data"]["total"], 17)

    def test_initiative_tool_becomes_structured_output(self):
        output = build_mock_structured_output(
            request("Roll initiative for the party", "Combat"),
            [
                {
                    "toolName": "generateInitiativeOrder",
                    "success": True,
                    "result": {"order": [{"name": "Mira", "roll": 14, "initiativeModifier": 2, "total": 16}]},
                }
            ],
        )
        self.assertEqual(output["type"], "initiative_order")
        self.assertEqual(output["data"]["order"][0]["modifier"], 2)

    def test_suggested_action_generation(self):
        output = build_mock_structured_output(request("Create a quest hook based on the cult"), [])
        actions = build_suggested_actions(output)
        self.assertEqual(actions[0]["action"], "saveQuest")
        self.assertIn("payload", actions[0])

    def test_real_provider_plain_npc_answer_becomes_save_ready(self):
        answer = """
Here is a knight NPC named Sir Kaelen Vance.

**Sir Kaelen Vance**
* **Appearance:** Sir Kaelen is a weathered veteran with a faded crest.
* **Personality:** Stoic, pragmatic, and loyal to Eldermire.
* **Motivation:** Protect Eldermire from internal and external threats.
* **Connection to Campaign:** He can ask the party to investigate a strange disappearance near Blackwater Mine.
"""
        output = _fallback_structured_output(request("create some knight npc", "NPC"), answer, None)
        self.assertIsNotNone(output)
        self.assertEqual(output["type"], "npc")
        npc = NpcOutput(**output["data"])
        self.assertEqual(npc.name, "Sir Kaelen Vance")
        self.assertIn("Blackwater Mine", npc.questHook)

    def test_real_provider_quoted_nickname_npc_answer_becomes_save_ready(self):
        answer = """
You encounter "Whisper" Wren, a skittish halfling informant known for collecting and selling secrets at the Silver Lantern Inn.

Wren knows a few crucial details related to Captain Vey and his betrayal:

Vey's Escape
Wren saw Captain Vey slip into the Serpent's Coil smuggler tunnels shortly after the betrayal.
"""
        output = _fallback_structured_output(request("Generate a memorable tavern informant tied to the party's current quest.", "NPC"), answer, None)
        self.assertIsNotNone(output)
        self.assertEqual(output["type"], "npc")
        npc = NpcOutput(**output["data"])
        self.assertEqual(npc.name, '"Whisper" Wren')
        self.assertIn("Captain Vey", npc.description)

    def test_real_provider_encounter_mode_plain_answer_becomes_save_ready(self):
        answer = """
A hard fight erupts on a rain-slick bridge while bandits fire from overturned wagons.
The enemies use cover, focus isolated heroes, and retreat once their leader falls.
"""
        with (
            patch("app.orchestration.gemini_provider._ensure_gemini_provider"),
            patch("app.orchestration.gemini_provider._retrieve_context", return_value=("", [])),
            patch("app.orchestration.gemini_provider.run_provider_tool_loop", return_value=([], [])),
            patch(
                "app.orchestration.gemini_provider._call_gemini",
                return_value={"answer": answer, "structuredOutput": None, "suggestedActions": []},
            ),
        ):
            response = real_chat_response(request("Make something for tonight.", "Encounter"))

        self.assertEqual(response["structuredOutput"]["type"], "encounter")
        encounter = EncounterOutput(**response["structuredOutput"]["data"])
        self.assertEqual(encounter.difficulty, "Hard")
        self.assertGreater(len(encounter.monsters), 0)
        self.assertEqual(response["suggestedActions"][0]["action"], "saveEncounter")

    def test_real_provider_partial_encounter_output_becomes_valid_fallback(self):
        answer = """
This is a Hard encounter.
Environment: A moonlit toll gate with broken barricades, wagon cover, and a flooded ditch.
Tactics: Cultists pin the party near the gate while a lookout pressures anyone carrying a torch.
Rewards: Toll ledger, black iron key.
Campaign Hooks: The ledger names Captain Vey.
"""
        output = _fallback_structured_output(
            request("Create a hard ambush at the toll gate.", "Auto"),
            answer,
            {
                "type": "encounter",
                "data": {
                    "title": "Moonlit Toll Gate",
                    "difficulty": "Brutal",
                    "monsters": [{"name": "Gate Cultist", "count": "2"}],
                },
            },
        )

        self.assertIsNotNone(output)
        self.assertEqual(output["type"], "encounter")
        encounter = EncounterOutput(**output["data"])
        self.assertEqual(encounter.title, "Moonlit Toll Gate")
        self.assertEqual(encounter.difficulty, "Hard")
        self.assertEqual(encounter.monsters[0].name, "Gate Cultist")
        self.assertEqual(encounter.monsters[0].count, 2)
        self.assertTrue(encounter.scalingOptions.easier)
        self.assertIn("Captain Vey", encounter.campaignHooks[0])

    def test_real_provider_conflicting_prompt_does_not_force_encounter_mode(self):
        output = _fallback_structured_output(
            request("Explain the rules for grappling and concentration.", "Encounter"),
            "Grappling and concentration use separate rules.",
            None,
        )

        self.assertIsNone(output)


if __name__ == "__main__":
    unittest.main()
