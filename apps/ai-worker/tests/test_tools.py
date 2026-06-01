import unittest

from app.tools.dice import roll_dice
from app.tools.encounters import calculate_encounter_difficulty
from app.tools.registry import get_tool
from app.orchestration.tool_loop import execute_manual_tool


class ToolTests(unittest.TestCase):
    def test_roll_dice_parses_modifier(self):
        result = roll_dice({"expression": "1d20+5"})
        self.assertEqual(result["dice"], "1d20")
        self.assertEqual(result["modifier"], 5)
        self.assertEqual(len(result["rolls"]), 1)
        self.assertEqual(result["total"], result["rolls"][0] + 5)

    def test_invalid_dice_expression_is_safe(self):
        with self.assertRaises(ValueError):
            roll_dice({"expression": "__import__('os').system('boom')"})

    def test_encounter_difficulty(self):
        result = calculate_encounter_difficulty(
            {
                "party": [{"name": "Aria", "level": 3}, {"name": "Borin", "level": 3}],
                "monsters": [{"name": "Goblin", "count": 4, "xp": 50}],
            }
        )
        self.assertEqual(result["totalMonsterXp"], 200)
        self.assertEqual(result["adjustedXp"], 400)
        self.assertIn(result["difficulty"], {"Easy", "Medium", "Hard", "Deadly"})

    def test_registry_lookup(self):
        self.assertEqual(get_tool("rollDice").name, "rollDice")

    def test_manual_tool_response_shape(self):
        response = execute_manual_tool("rollDice", {"expression": "1d4"}, {})
        self.assertTrue(response["success"])
        self.assertEqual(response["toolName"], "rollDice")


if __name__ == "__main__":
    unittest.main()

