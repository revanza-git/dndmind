# Evaluation Design

DNDMind uses deterministic evaluation as the first quality layer. The goal is not to prove model quality in the abstract; the goal is to catch regressions in the product behaviors that make the assistant useful to a Dungeon Master.

## Strategy

Each eval case should define:

- prompt
- mode and context toggles
- setup data required
- expected answer facts
- required citations, if retrieval is expected
- required tool calls, if tool use is expected
- expected structured output type, if a card is expected

Sample cases live in `db/seed/eval_cases.json`.

## What Current Evals Test

- Rules RAG can retrieve an ingested rules document and cite it.
- Campaign memory can answer continuity questions from summarized notes.
- Dice and initiative prompts call deterministic tools.
- Encounter prompts produce encounter difficulty/tool behavior.
- NPC prompts produce structured output that can be saved.

## Why Deterministic First

Mock mode gives stable responses, stable tool results, and stable embeddings. That makes it useful for CI and portfolio review because failures are easier to interpret:

- a missing citation means retrieval or rendering changed
- a missing tool call means orchestration changed
- a missing structured card means output shaping changed
- a missing expected fact means context assembly changed

## Limitations

- Mock embeddings are not a substitute for semantic embedding quality.
- String checks can miss subtle answer quality issues.
- The current sample cases are data fixtures, not a full dashboard history.
- Real LLM mode needs separate eval tolerances because model outputs vary.

## Future LLM-as-Judge Roadmap

The next evaluation layer should add LLM-as-judge scoring for:

- faithfulness to cited context
- table usefulness
- rules correctness
- memory continuity
- structured output completeness
- refusal to invent unsupported facts

Those judge scores should complement deterministic checks, not replace them. Deterministic checks remain the fastest way to catch contract regressions.
