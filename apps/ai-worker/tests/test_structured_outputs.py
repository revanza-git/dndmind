import unittest
from types import SimpleNamespace
from uuid import uuid4

from app.orchestration.structured_output import build_mock_structured_output, build_suggested_actions
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


if __name__ == "__main__":
    unittest.main()
