import unittest
from unittest.mock import patch
from uuid import uuid4

from app.orchestration.tool_loop import _plan_mock_tools, detect_prompt_intent
from main import Campaign, ChatContext, ChatRequest, PartyCharacter, mock_chat_response
from rag import retriever


def party_member(name: str = "Aria") -> PartyCharacter:
    return PartyCharacter(
        id=uuid4(),
        campaignId=uuid4(),
        name=name,
        className="Wizard",
        race="Elf",
        level=4,
        hpCurrent=22,
        hpMax=28,
        armorClass=13,
        initiativeModifier=3,
        notes="Carries the Moon Key.",
    )


def chat_request(
    message: str,
    context: ChatContext,
    party: list[PartyCharacter] | None = None,
    mode: str = "Auto",
    system_tone: str = "Heroic",
) -> ChatRequest:
    campaign_id = uuid4()
    members = party if party is not None else [party_member()]
    return ChatRequest(
        campaignId=campaign_id,
        conversationId=uuid4(),
        message=message,
        mode=mode,
        clientOwnerId="test-client",
        context=context,
        campaign=Campaign(id=campaign_id, name="Test Campaign", description=None, systemTone=system_tone),
        party=[member.model_copy(update={"campaignId": campaign_id}) for member in members],
    )


class ContextToggleTests(unittest.TestCase):
    def test_party_info_disabled_omits_saved_party_snapshot(self):
        request = chat_request("How should I open tonight's session?", ChatContext(usePartyInfo=False))

        response = mock_chat_response(request)

        self.assertNotIn("Party snapshot", response.answer)
        self.assertNotIn("Aria", response.answer)
        self.assertNotIn("Moon Key", response.answer)

    def test_party_info_enabled_preserves_saved_party_snapshot(self):
        request = chat_request("How should I open tonight's session?", ChatContext(usePartyInfo=True))

        response = mock_chat_response(request)

        self.assertIn("Party snapshot", response.answer)
        self.assertIn("Aria level 4", response.answer)
        self.assertIn("Moon Key", response.answer)

    def test_mock_response_reflects_campaign_tone_deterministically(self):
        request = chat_request(
            "How should I open tonight's session?",
            ChatContext(usePartyInfo=False),
            system_tone="Wry gothic suspense",
        )

        response = mock_chat_response(request)

        self.assertIn("Campaign response tone: Wry gothic suspense.", response.answer)
        self.assertIn("Use this as style only", response.answer)
        self.assertIn("scope, safety, facts, citations, tools, selected mode, and structured output requirements", response.answer)

    def test_mock_response_uses_default_style_when_campaign_tone_is_blank(self):
        request = chat_request(
            "How should I open tonight's session?",
            ChatContext(usePartyInfo=False),
            system_tone=" ",
        )

        response = mock_chat_response(request)

        self.assertIn("Campaign response tone: default DNDMind style.", response.answer)

    def test_mock_response_uses_default_style_when_campaign_tone_is_missing(self):
        campaign_id = uuid4()
        request = ChatRequest(
            campaignId=campaign_id,
            conversationId=uuid4(),
            message="How should I open tonight's session?",
            mode="Auto",
            clientOwnerId="test-client",
            context=ChatContext(usePartyInfo=False),
            campaign=Campaign(id=campaign_id, name="Test Campaign"),
            party=[],
        )

        response = mock_chat_response(request)

        self.assertIn("Campaign response tone: default DNDMind style.", response.answer)

    def test_party_info_disabled_prevents_saved_party_tool_planning(self):
        request = chat_request("Roll initiative for the party and create an encounter.", ChatContext(usePartyInfo=False))

        planned = _plan_mock_tools(request)

        initiative = next(args for name, args in planned if name == "generateInitiativeOrder")
        self.assertNotIn("Aria", {character["name"] for character in initiative["characters"]})
        self.assertFalse(any(name == "calculateEncounterDifficulty" for name, _ in planned))

    def test_party_info_enabled_preserves_party_tool_planning(self):
        request = chat_request("Roll initiative for the party and create an encounter.", ChatContext(usePartyInfo=True))

        planned = _plan_mock_tools(request)

        initiative = next(args for name, args in planned if name == "generateInitiativeOrder")
        encounter = next(args for name, args in planned if name == "calculateEncounterDifficulty")
        self.assertIn("Aria", {character["name"] for character in initiative["characters"]})
        self.assertIn("Aria", {member["name"] for member in encounter["party"]})

    def test_rules_retrieval_excludes_homebrew(self):
        with patch.object(retriever, "_search_chunks", return_value=[]) as search_chunks:
            retriever.search_rules(uuid4(), "advantage", 4)

        self.assertEqual(search_chunks.call_args.args[3], ["rules", "srd"])

    def test_homebrew_retrieval_uses_homebrew_source(self):
        with patch.object(retriever, "_search_chunks", return_value=[]) as search_chunks:
            retriever.search_homebrew(uuid4(), "custom feat", 4)

        self.assertEqual(search_chunks.call_args.args[3], ["homebrew"])

    def test_homebrew_disabled_excludes_homebrew_tool_planning(self):
        request = chat_request("Look up the homebrew rule for moon blades.", ChatContext(useHomebrew=False), party=[])

        planned = _plan_mock_tools(request)

        self.assertFalse(any(name == "searchHomebrew" for name, _ in planned))

    def test_homebrew_enabled_includes_homebrew_tool_planning(self):
        request = chat_request("Look up the homebrew rule for moon blades.", ChatContext(useHomebrew=True), party=[])

        planned = _plan_mock_tools(request)

        self.assertTrue(any(name == "searchHomebrew" for name, _ in planned))

    def test_intent_detection_identifies_story_over_rules_hint(self):
        intent = detect_prompt_intent("Describe the ruined temple entrance with read-aloud details.")

        self.assertIn(intent.primary, {"story", "location"})
        self.assertTrue(intent.is_strong)
        self.assertNotIn("rules", intent.detected)

    def test_rules_mode_story_prompt_does_not_force_rules_search(self):
        request = chat_request(
            "Describe the ruined temple entrance with read-aloud details.",
            ChatContext(useRules=True),
            party=[],
            mode="Rules",
        )

        planned = _plan_mock_tools(request)

        self.assertFalse(any(name == "searchRules" for name, _ in planned))

    def test_story_mode_rules_prompt_searches_rules_when_enabled(self):
        request = chat_request("How does advantage work?", ChatContext(useRules=True), party=[], mode="Story")

        planned = _plan_mock_tools(request)

        self.assertTrue(any(name == "searchRules" for name, _ in planned))

    def test_encounter_mode_encounter_prompt_calculates_with_party_info(self):
        request = chat_request(
            "Create a hard ambush for tonight's combat encounter.",
            ChatContext(usePartyInfo=True),
            mode="Encounter",
        )

        planned = _plan_mock_tools(request)

        self.assertTrue(any(name == "calculateEncounterDifficulty" for name, _ in planned))


if __name__ == "__main__":
    unittest.main()
