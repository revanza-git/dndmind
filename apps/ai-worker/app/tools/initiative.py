from typing import Any

from .dice import roll_dice


def generate_initiative_order(arguments: dict[str, Any], context: dict[str, Any] | None = None) -> dict[str, Any]:
    characters = arguments.get("characters")
    if not isinstance(characters, list) or not characters:
        raise ValueError("characters must be a non-empty list.")

    entries = []
    for character in characters:
        if not isinstance(character, dict) or not character.get("name"):
            raise ValueError("Each character needs a name.")
        modifier = int(character.get("initiativeModifier", 0))
        roll = roll_dice({"expression": f"1d20{modifier:+d}"})
        entries.append(
            {
                "name": str(character["name"]),
                "initiativeModifier": modifier,
                "roll": roll["rolls"][0],
                "total": roll["total"],
            }
        )

    entries.sort(key=lambda item: (item["total"], item["initiativeModifier"], item["name"]), reverse=True)
    return {"order": entries}

