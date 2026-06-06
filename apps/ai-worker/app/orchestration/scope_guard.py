import re
from typing import Any


IN_SCOPE_TERMS = {
    "ability check",
    "ac",
    "adventure",
    "advantage",
    "armor class",
    "bard",
    "barbarian",
    "battle",
    "campaign",
    "castle",
    "character",
    "cleric",
    "combat",
    "cult",
    "d20",
    "dc",
    "d&d",
    "difficulty class",
    "disadvantage",
    "dice",
    "dm",
    "dragon",
    "druid",
    "dungeon",
    "encounter",
    "faction",
    "fighter",
    "game master",
    "gm",
    "goblin",
    "homebrew",
    "hp",
    "initiative",
    "kobold",
    "lore",
    "magic item",
    "memory",
    "monster",
    "npc",
    "paladin",
    "party",
    "pathfinder",
    "player character",
    "quest",
    "ranger",
    "recap",
    "rogue",
    "roll",
    "rules",
    "session",
    "skill check",
    "spell",
    "summary",
    "tabletop",
    "tavern",
    "temple",
    "village",
    "villain",
    "wizard",
}

IN_SCOPE_PATTERNS = [
    r"\b5e\b",
    r"\bdnd\b",
    r"\bdm['’]?s?\b",
    r"\b(?:str|dex|con|int|wis|cha)\b",
    r"\b(?:ability|skill|death)\s+checks?\b",
    r"\b(?:attack|damage)\s+rolls?\b",
    r"\b(?:save|saving throw)s?\b",
    r"\b(?:town|city|location|region|ruins?|forest|swamp)\b",
    r"\b(?:orc|undead|vampire|bandit|beholder|lich|dragon)s?\b",
    r"\b(?:warlock|sorcerer|monk|artificer)\b",
    r"\b(?:race|ancestry|class|background)\b",
    r"\b(?:last|previous|next)\s+session\b",
    r"\b(?:session|campaign)\s+(?:notes|prep|planning|summary|recap|memory)\b",
]

FOLLOW_UP_PATTERNS = [
    r"^(?:make|tone|rewrite|revise)\s+it\s+\w+(?:\s+\w+){0,4}$",
    r"^(?:expand|continue|shorten|summarize|tighten)\s+(?:that|this|it)(?:\s+\w+){0,4}$",
    r"^(?:give|show|make|create)\s+me\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+more$",
    r"^(?:save|use|keep)\s+(?:this|that|it)$",
    r"^(?:more|darker|lighter|scarier|funnier|weirder|shorter|longer|expand that|continue)$",
]

HARD_OUT_OF_SCOPE_PATTERNS = [
    r"\b(?:code|coding|programming|python|javascript|typescript|react|next\.?js|html|css|sql|leetcode|algorithm)\b",
    r"\b(?:recipe|cooking|bake|sourdough|pasta|dinner)\b",
    r"\b(?:stock|stocks|crypto|bitcoin|mortgage|loan|finance|invest|investment|taxes)\b",
    r"\b(?:news|headline|current events|election|president|weather|sports score)\b",
    r"\b(?:homework|essay|math problem|physics|chemistry)\b",
    r"\b(?:dating|relationship advice|career advice|medical advice|therapy)\b",
]

GENERIC_FACTUAL_PATTERNS = [
    r"\b(?:capital of|population of|who is the|what is the)\b",
]

INJECTION_PATTERNS = [
    r"\bignore\s+(?:all\s+)?(?:previous|above|your)\s+instructions\b",
    r"\bignore\s+(?:dndmind|d&d|tabletop|campaign)\s+scope\b",
    r"\bforget\s+(?:your|the)\s+(?:role|scope|instructions)\b",
    r"\byou\s+are\s+now\b",
    r"\bact\s+as\s+(?:a|an)\b",
]


def is_in_scope_prompt(message: str) -> bool:
    normalized = _normalize(message)
    if not normalized:
        return False

    if _matches_any(normalized, FOLLOW_UP_PATTERNS) and len(normalized.split()) <= 8:
        return True

    has_in_scope_signal = _has_in_scope_signal(normalized)
    has_hard_out_of_scope_signal = _matches_any(normalized, HARD_OUT_OF_SCOPE_PATTERNS)
    has_generic_factual_signal = _matches_any(normalized, GENERIC_FACTUAL_PATTERNS)
    has_injection_signal = _matches_any(normalized, INJECTION_PATTERNS)

    if has_injection_signal and (has_hard_out_of_scope_signal or has_generic_factual_signal or not has_in_scope_signal):
        return False

    if has_hard_out_of_scope_signal:
        return False

    if has_generic_factual_signal and not has_in_scope_signal:
        return False

    return has_in_scope_signal


def out_of_scope_answer() -> str:
    return (
        "I can help with tabletop RPG campaign work, but that prompt looks outside DNDMind's focus. "
        "Try asking for NPCs, quests, encounters, locations, lore, rules-adjacent help, dice or initiative tools, "
        "campaign memory, or a session summary."
    )


def out_of_scope_suggested_actions() -> list[dict[str, Any]]:
    return [
        {
            "label": "Generate NPC",
            "action": "prompt",
            "payload": {"message": "Generate a suspicious tavern keeper NPC with a useful quest hook."},
        },
        {
            "label": "Plan Encounter",
            "action": "prompt",
            "payload": {"message": "Plan a medium encounter for the party's next session."},
        },
        {
            "label": "Summarize Session",
            "action": "prompt",
            "payload": {"message": "Summarize these session notes into durable campaign memory."},
        },
    ]


def _has_in_scope_signal(normalized: str) -> bool:
    return any(re.search(_term_pattern(term), normalized, flags=re.IGNORECASE) for term in IN_SCOPE_TERMS) or _matches_any(
        normalized, IN_SCOPE_PATTERNS
    )


def _matches_any(value: str, patterns: list[str]) -> bool:
    return any(re.search(pattern, value, flags=re.IGNORECASE) for pattern in patterns)


def _normalize(message: str) -> str:
    return re.sub(r"\s+", " ", message.strip().lower())


def _term_pattern(term: str) -> str:
    escaped = re.escape(term).replace(r"\ ", r"\s+")
    if re.fullmatch(r"[a-z0-9 ]+", term):
        return rf"\b{escaped}\b"
    return escaped
