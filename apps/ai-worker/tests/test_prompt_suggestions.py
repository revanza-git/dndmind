import unittest
from unittest.mock import patch
from uuid import uuid4

import main as worker_main
from app.orchestration import gemini_provider


def party_member(campaign_id):
    return worker_main.PartyCharacter(
        id=uuid4(),
        campaignId=campaign_id,
        name="Aria",
        className="Wizard",
        race="Elf",
        level=4,
        hpCurrent=22,
        hpMax=28,
        armorClass=13,
        initiativeModifier=3,
        notes="Carries the Moon Key.",
    )


def prompt_request(mode="auto", current_input=None, *, with_session=False, with_memory=False):
    campaign_id = uuid4()
    session = None
    if with_session:
        session = worker_main.PromptSuggestionSession(
            id=uuid4(),
            campaignId=campaign_id,
            sessionNumber=3,
            title="Blackwater Mine",
            rawNotes="Captain Vey escaped with the map. Mira swore revenge.",
            summary=None,
            status="active",
        )

    memory = worker_main.PromptSuggestionMemory()
    if with_memory:
        memory = worker_main.PromptSuggestionMemory(
            quests=[{"title": "Recover the Dawn Shard", "status": "open"}],
            locations=[{"name": "Blackwater Mine"}],
            events=[{"eventType": "unresolved_hook", "title": "Who paid Captain Vey?"}],
        )

    return worker_main.PromptSuggestionRequest(
        campaignId=campaign_id,
        sessionId=session.id if session else None,
        mode=mode,
        currentInput=current_input,
        clientOwnerId="test-owner",
        campaign=worker_main.Campaign(
            id=campaign_id,
            name="Blackwater",
            description="A haunted delta campaign.",
            systemTone="Wry gothic suspense",
        ),
        party=[party_member(campaign_id)],
        session=session,
        memory=memory,
    )


class PromptSuggestionTests(unittest.TestCase):
    def test_selected_npc_mode_returns_editable_npc_prompt(self):
        response = worker_main.mock_prompt_suggestion(prompt_request(mode="npc", with_memory=True))

        self.assertEqual(response.mode, "npc")
        self.assertIsNone(response.resolvedMode)
        self.assertIn("Create a memorable NPC", response.prompt)
        self.assertIn("Blackwater", response.prompt)
        self.assertIn("Wry gothic suspense", response.prompt)
        self.assertIn("Recover the Dawn Shard", response.prompt)

    def test_selected_character_mode_returns_editable_character_prompt(self):
        response = worker_main.mock_prompt_suggestion(prompt_request(mode="character", with_memory=True))

        self.assertEqual(response.mode, "character")
        self.assertIsNone(response.resolvedMode)
        self.assertIn("Generate a playable or near-playable character", response.prompt)
        self.assertIn("backup PC", response.prompt)
        self.assertIn("Recover the Dawn Shard", response.prompt)

    def test_auto_mode_uses_current_character_draft(self):
        response = worker_main.mock_prompt_suggestion(
            prompt_request(mode="auto", current_input="Generate a hireling healer with a secret.", with_memory=True)
        )

        self.assertEqual(response.resolvedMode, "character")
        self.assertIn("playable or near-playable character", response.reason)
        self.assertIn("Generate a playable or near-playable character", response.prompt)

    def test_auto_mode_uses_current_rules_draft(self):
        response = worker_main.mock_prompt_suggestion(
            prompt_request(mode="auto", current_input="How does advantage work with help actions?", with_session=True)
        )

        self.assertEqual(response.mode, "auto")
        self.assertEqual(response.resolvedMode, "rules")
        self.assertIn("rules or ruling question", response.reason)
        self.assertIn("D&D rules/ruling question", response.prompt)

    def test_auto_mode_prefers_unsummarized_session_notes(self):
        response = worker_main.mock_prompt_suggestion(prompt_request(mode="auto", with_session=True))

        self.assertEqual(response.resolvedMode, "summarize")
        self.assertIn("not summarized", response.reason)
        self.assertIn("Summarize the active session", response.prompt)
        self.assertIn("Captain Vey escaped", response.prompt)

    def test_provider_prompt_suggestion_normalizes_response(self):
        request = prompt_request(mode="auto", with_memory=True)
        with patch.object(
            gemini_provider,
            "_generate_json",
            return_value={
                "prompt": "Create a medium ambush tied to the Dawn Shard.",
                "mode": "auto",
                "resolvedMode": "encounter",
                "reason": "Open quest and party context.",
            },
        ):
            response = gemini_provider.real_prompt_suggestion(request)

        self.assertEqual(response["mode"], "auto")
        self.assertEqual(response["resolvedMode"], "encounter")
        self.assertEqual(response["prompt"], "Create a medium ambush tied to the Dawn Shard.")


if __name__ == "__main__":
    unittest.main()
