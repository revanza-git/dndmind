import random
import re
from typing import Any


DICE_RE = re.compile(r"^\s*(?P<count>\d{1,2})d(?P<sides>\d{1,4})(?P<modifier>[+-]\d{1,4})?\s*$", re.IGNORECASE)


def roll_dice(arguments: dict[str, Any], context: dict[str, Any] | None = None) -> dict[str, Any]:
    expression = str(arguments.get("expression", "")).strip()
    match = DICE_RE.match(expression)
    if not match:
        raise ValueError("Invalid dice expression. Use notation like 1d20, 1d20+5, 2d6+3, or 4d8-1.")

    count = int(match.group("count"))
    sides = int(match.group("sides"))
    modifier = int(match.group("modifier") or 0)

    if count < 1 or count > 50:
        raise ValueError("Dice count must be between 1 and 50.")
    if sides < 2 or sides > 1000:
        raise ValueError("Dice sides must be between 2 and 1000.")

    rolls = [random.randint(1, sides) for _ in range(count)]
    return {
        "expression": expression,
        "dice": f"{count}d{sides}",
        "rolls": rolls,
        "modifier": modifier,
        "total": sum(rolls) + modifier,
    }


def extract_dice_expression(text: str) -> str | None:
    match = re.search(r"\b\d{1,2}d\d{1,4}(?:[+-]\d{1,4})?\b", text, re.IGNORECASE)
    return match.group(0) if match else None

