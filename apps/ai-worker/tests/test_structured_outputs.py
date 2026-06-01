import unittest
from types import SimpleNamespace
from uuid import uuid4

from app.orchestration.structured_output import build_mock_structured_output, build_suggested_actions
from app.orchestration.gemini_provider import _fallback_structured_output
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


if __name__ == "__main__":
    unittest.main()
