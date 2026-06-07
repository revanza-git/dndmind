from typing import Any, Literal

from pydantic import BaseModel, Field


StructuredOutputType = Literal[
    "npc",
    "character",
    "quest",
    "location",
    "encounter",
    "session_summary",
    "initiative_order",
    "dice_roll",
]


class NpcOutput(BaseModel):
    name: str
    role: str
    raceOrSpecies: str
    description: str
    personality: str
    motivation: str
    secret: str
    relationshipToParty: str
    questHook: str


class CharacterOutput(BaseModel):
    name: str
    ancestryOrSpecies: str
    classAndSubclass: str
    level: int = 1
    background: str
    role: str
    abilityScores: dict[str, int] = Field(default_factory=dict)
    statSummary: str = ""
    hpCurrent: int | None = None
    hpMax: int | None = None
    tempHp: int | None = None
    armorClass: int | None = None
    initiativeModifier: int | None = None
    passivePerception: int | None = None
    personalityTraits: list[str] = Field(default_factory=list)
    idealsBondsFlaws: dict[str, str] = Field(default_factory=dict)
    equipment: list[str] = Field(default_factory=list)
    campaignTieIn: str
    secretOrHook: str


class QuestOutput(BaseModel):
    title: str
    description: str
    status: str = "open"
    relatedNpcs: list[str] = Field(default_factory=list)
    objectives: list[str] = Field(default_factory=list)
    reward: str
    unresolvedHooks: list[str] = Field(default_factory=list)


class LocationOutput(BaseModel):
    name: str
    type: str
    description: str
    dangerLevel: Literal["low", "medium", "high"] = "medium"
    secrets: list[str] = Field(default_factory=list)
    notableNpcs: list[str] = Field(default_factory=list)
    questHooks: list[str] = Field(default_factory=list)


class EncounterMonsterOutput(BaseModel):
    name: str
    count: int = 1
    role: str
    xp: int = 0


class EncounterScalingOutput(BaseModel):
    easier: str
    harder: str


class EncounterOutput(BaseModel):
    title: str
    difficulty: Literal["Easy", "Medium", "Hard", "Deadly", "Unknown"] = "Unknown"
    environment: str
    monsters: list[EncounterMonsterOutput] = Field(default_factory=list)
    tactics: str
    scalingOptions: EncounterScalingOutput
    rewards: list[str] = Field(default_factory=list)
    campaignHooks: list[str] = Field(default_factory=list)


class SessionSummaryOutput(BaseModel):
    summary: str
    importantEvents: list[str] = Field(default_factory=list)
    npcs: list[str] = Field(default_factory=list)
    locations: list[str] = Field(default_factory=list)
    quests: list[str] = Field(default_factory=list)
    items: list[str] = Field(default_factory=list)
    unresolvedHooks: list[str] = Field(default_factory=list)
    nextSessionSetup: str


class InitiativeEntryOutput(BaseModel):
    name: str
    roll: int
    modifier: int
    total: int


class InitiativeOrderOutput(BaseModel):
    round: int = 1
    order: list[InitiativeEntryOutput] = Field(default_factory=list)


class DiceRollOutput(BaseModel):
    expression: str
    rolls: list[int] = Field(default_factory=list)
    modifier: int = 0
    total: int = 0


class StructuredOutput(BaseModel):
    type: StructuredOutputType
    data: dict[str, Any]


class SuggestedAction(BaseModel):
    label: str
    action: str
    payload: dict[str, Any] = Field(default_factory=dict)
