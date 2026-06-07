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
- expected prompt suggestion shape, if suggestion generation is expected
- expected image prompt, provider status, or mock placeholder behavior, if image generation is expected

Sample cases live in `db/seed/eval_cases.json`.

## What Current Evals Test

- Rules RAG can retrieve a ready Campaign Knowledge rules document and cite it.
- Homebrew RAG stays separate from rules retrieval and only plans the homebrew search tool when enabled.
- Campaign memory can answer continuity questions from summarized notes.
- Saved encounters become campaign memory and can be reloaded in the memory payload.
- Campaign response tone appears in mock/provider prompts as style-only guidance.
- Provider routing accepts Gemini API-key mode and Vertex AI Gemini mode, builds the expected Vertex endpoint, and uses ADC bearer-token auth.
- Party Info gating prevents saved party details from appearing in answers or tool arguments when disabled.
- Prompt suggestions resolve the selected mode and include useful campaign context.
- Campaign recaps and active-session summaries summarize saved context without requiring a new chat answer first.
- Image generation builds safe prompts for NPC, character, and encounter cards while keeping disabled/mock behavior deterministic.
- Dice and initiative prompts call deterministic tools.
- Encounter prompts produce encounter difficulty/tool behavior and real-provider fallback cards when provider JSON is missing or partial.
- NPC and character prompts produce structured output that can be saved.
- Out-of-scope prompts short-circuit before mock or real provider generation.
- Upload sanitization strips unsafe markup/control characters and caps indexed text.

## Why Deterministic First

Mock mode gives stable responses, stable tool results, and stable embeddings. That makes it useful for CI and portfolio review because failures are easier to interpret:

- a missing citation means retrieval or rendering changed
- a homebrew result in a standard rules lookup means source-type isolation changed
- a missing tool call means orchestration changed
- a disabled context appearing in an answer means context gating changed
- a missing structured card means output shaping changed
- a missing prompt suggestion means mode resolution or context assembly changed
- an image generation status mismatch means optional media provider gating changed
- a missing expected fact means context assembly changed
- an unrelated prompt that reaches the provider means scope guarding changed
- campaign tone changing scope, citations, tools, or structured-output behavior means style guarding changed
- a saved encounter missing from memory means persistence or memory-document indexing changed
- a Vertex request missing ADC auth or using the wrong endpoint means provider routing changed

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
- refusal of clearly unrelated non-tabletop prompts

Those judge scores should complement deterministic checks, not replace them. Deterministic checks remain the fastest way to catch contract regressions.
