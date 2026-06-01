from typing import Any


THRESHOLDS_BY_LEVEL = {
    1: {"Easy": 25, "Medium": 50, "Hard": 75, "Deadly": 100},
    2: {"Easy": 50, "Medium": 100, "Hard": 150, "Deadly": 200},
    3: {"Easy": 75, "Medium": 150, "Hard": 225, "Deadly": 400},
    4: {"Easy": 125, "Medium": 250, "Hard": 375, "Deadly": 500},
    5: {"Easy": 250, "Medium": 500, "Hard": 750, "Deadly": 1100},
}


def calculate_encounter_difficulty(arguments: dict[str, Any], context: dict[str, Any] | None = None) -> dict[str, Any]:
    party = arguments.get("party") or []
    monsters = arguments.get("monsters") or []
    if not party or not monsters:
        raise ValueError("party and monsters are required.")

    monster_count = sum(max(1, int(monster.get("count", 1))) for monster in monsters)
    total_monster_xp = sum(max(1, int(monster.get("count", 1))) * max(0, int(monster.get("xp", 0))) for monster in monsters)
    multiplier = _monster_multiplier(monster_count)
    adjusted_xp = int(total_monster_xp * multiplier)

    thresholds = {"Easy": 0, "Medium": 0, "Hard": 0, "Deadly": 0}
    for character in party:
        level = int(character.get("level", 1))
        level_thresholds = THRESHOLDS_BY_LEVEL.get(level, THRESHOLDS_BY_LEVEL[5])
        for key in thresholds:
            thresholds[key] += level_thresholds[key]

    difficulty = "Trivial"
    for label in ["Easy", "Medium", "Hard", "Deadly"]:
        if adjusted_xp >= thresholds[label]:
            difficulty = label

    return {
        "totalMonsterXp": total_monster_xp,
        "monsterCount": monster_count,
        "multiplier": multiplier,
        "adjustedXp": adjusted_xp,
        "partyThresholds": thresholds,
        "difficulty": difficulty,
        "explanation": (
            f"{monster_count} monster(s) worth {total_monster_xp} XP use a x{multiplier:g} multiplier, "
            f"for {adjusted_xp} adjusted XP against party thresholds {thresholds}."
        ),
    }


def _monster_multiplier(monster_count: int) -> float:
    if monster_count <= 1:
        return 1
    if monster_count == 2:
        return 1.5
    if monster_count <= 6:
        return 2
    if monster_count <= 10:
        return 2.5
    if monster_count <= 14:
        return 3
    return 4

