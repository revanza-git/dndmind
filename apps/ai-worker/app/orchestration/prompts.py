STRUCTURED_OUTPUT_INSTRUCTIONS = """
When useful, return one structured output object with:
type: npc | character | quest | location | encounter | session_summary | initiative_order | dice_roll
data: a JSON object matching the requested type schema.
Also return suggestedActions as objects with label, action, and payload.
If structured validation fails, return normal assistant text and omit structuredOutput.
"""
