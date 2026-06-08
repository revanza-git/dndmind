import unittest
from unittest.mock import patch
from uuid import uuid4

import main as worker_main
from app.orchestration import image_generation


def image_request(output_type="npc", data=None, style="cinematic"):
    return worker_main.ImageGenerationRequest(
        campaignId=uuid4(),
        conversationId=uuid4(),
        structuredOutputType=output_type,
        structuredOutputData=data or {},
        stylePreset=style,
        clientOwnerId="test-owner",
    )


class ImageGenerationTests(unittest.TestCase):
    def test_disabled_image_generation_returns_deterministic_mock_metadata(self):
        request = image_request("npc", {"name": "Mira Vale", "role": "Informant"})

        with patch.dict("os.environ", {"IMAGE_GENERATION_ENABLED": "false", "IMAGE_PROVIDER": "gemini"}, clear=True):
            first = image_generation.generate_image(request)
            second = image_generation.generate_image(request)

        self.assertEqual(first["status"], "disabled")
        self.assertEqual(first["provider"], "mock")
        self.assertEqual(first["imageUrl"], second["imageUrl"])
        self.assertTrue(first["imageUrl"].startswith("data:image/svg+xml"))
        self.assertIn("Mira Vale", first["imagePrompt"])

    def test_mock_provider_does_not_call_gemini(self):
        request = image_request("encounter", {"title": "Ashen Knives Ambush"})

        with patch.dict("os.environ", {"IMAGE_GENERATION_ENABLED": "true", "IMAGE_PROVIDER": "mock"}, clear=True):
            with patch.object(image_generation, "_generate_gemini_image") as gemini:
                response = image_generation.generate_image(request)

        gemini.assert_not_called()
        self.assertEqual(response["status"], "mock")
        self.assertEqual(response["provider"], "mock")

    def test_vertex_provider_uses_vertex_image_path(self):
        request = image_request("npc", {"name": "Mira Vale"})

        with patch.dict("os.environ", {"IMAGE_GENERATION_ENABLED": "true", "IMAGE_PROVIDER": "vertex"}, clear=True):
            with patch.object(image_generation, "_generate_vertex_image", return_value="data:image/png;base64,abc") as vertex:
                response = image_generation.generate_image(request)

        vertex.assert_called_once()
        self.assertEqual(response["status"], "succeeded")
        self.assertEqual(response["provider"], "vertex")
        self.assertEqual(response["imageData"], "data:image/png;base64,abc")

    def test_vertex_endpoint_uses_image_model_and_location(self):
        with patch.dict(
            "os.environ",
            {
                "VERTEX_PROJECT_ID": "test-project",
                "VERTEX_LOCATION": "us-central1",
                "IMAGE_MODEL": "models/gemini-2.5-flash-image",
            },
            clear=True,
        ):
            endpoint = image_generation._vertex_image_endpoint()

        self.assertIn("https://us-central1-aiplatform.googleapis.com/v1/projects/test-project/locations/us-central1", endpoint)
        self.assertTrue(endpoint.endswith("/publishers/google/models/gemini-2.5-flash-image:generateContent"))

    def test_image_payload_requests_text_and_image_modalities(self):
        payload = image_generation._image_generate_content_payload("Draw the scene.")

        self.assertEqual(payload["contents"][0]["parts"][0]["text"], "Draw the scene.")
        self.assertEqual(payload["generationConfig"]["responseModalities"], ["TEXT", "IMAGE"])
        self.assertEqual(payload["generationConfig"]["imageConfig"]["aspectRatio"], "4:3")

    def test_image_payload_uses_supported_configured_aspect_ratio(self):
        with patch.dict("os.environ", {"IMAGE_ASPECT_RATIO": "16:9"}, clear=True):
            payload = image_generation._image_generate_content_payload("Draw the scene.")

        self.assertEqual(payload["generationConfig"]["imageConfig"]["aspectRatio"], "16:9")

    def test_image_payload_falls_back_for_unsupported_aspect_ratio(self):
        with patch.dict("os.environ", {"IMAGE_ASPECT_RATIO": "2:1"}, clear=True):
            payload = image_generation._image_generate_content_payload("Draw the scene.")

        self.assertEqual(payload["generationConfig"]["imageConfig"]["aspectRatio"], "4:3")

    def test_npc_prompt_omits_hidden_secret_and_sets_portrait_direction(self):
        prompt = image_generation.build_image_prompt(
            "npc",
            {
                "name": "Captain Vey",
                "role": "Traitorous captain",
                "raceOrSpecies": "Human",
                "description": "Weathered officer in a rain-dark cloak.",
                "personality": "Measured and watchful.",
                "secret": "He serves a demon prince.",
            },
            "parchment sketch",
        )

        self.assertIn("portrait-style fantasy character art", prompt)
        self.assertIn("Captain Vey", prompt)
        self.assertIn("parchment sketch", prompt)
        self.assertNotIn("demon prince", prompt)
        self.assertIn("Do not reference copyrighted characters", prompt)

    def test_encounter_prompt_includes_scene_environment_and_monsters(self):
        prompt = image_generation.build_image_prompt(
            "encounter",
            {
                "title": "Blackwater Mine Ambush",
                "difficulty": "Medium",
                "environment": "Flooded mine tunnels lit by blue fungus.",
                "monsters": [{"name": "Bandit", "count": 3, "role": "skirmisher"}],
                "tactics": "Enemies attack from mine carts and retreat through shallow water.",
                "rewards": ["A silvered map tube"],
            },
            "sepia etching",
        )

        self.assertIn("cinematic fantasy scene", prompt)
        self.assertIn("Flooded mine tunnels", prompt)
        self.assertIn("3 Bandit", prompt)
        self.assertNotIn("sepia etching", prompt)
        self.assertIn("cinematic fantasy concept art", prompt)
        self.assertIn("pulled-back, centered composition", prompt)
        self.assertIn("No readable text", prompt)

    def test_character_prompt_includes_playable_character_details_without_secret(self):
        prompt = image_generation.build_image_prompt(
            "character",
            {
                "name": "Lethariel Moonglen",
                "ancestryOrSpecies": "Elf",
                "classAndSubclass": "Ranger, Gloom Stalker",
                "level": 3,
                "role": "Backup PC and rival scout",
                "background": "Outlander",
                "personalityTraits": ["patient", "dryly funny"],
                "equipment": ["longbow", "twin shortswords"],
                "campaignTieIn": "Tracking the Ashen Knives.",
                "secretOrHook": "Knows who paid Captain Vey.",
            },
            "combat stance",
        )

        self.assertIn("playable or near-playable character", prompt)
        self.assertIn("Lethariel Moonglen", prompt)
        self.assertIn("Ranger, Gloom Stalker", prompt)
        self.assertIn("longbow", prompt)
        self.assertIn("dynamic fantasy combat character art", prompt)
        self.assertNotIn("Captain Vey", prompt)

    def test_character_prompt_with_gauntlets_rejects_extra_held_weapons(self):
        prompt = image_generation.build_image_prompt(
            "character",
            {
                "name": "Teowulf",
                "ancestryOrSpecies": "Human",
                "classAndSubclass": "Fighter, Battle Master",
                "level": 3,
                "role": "Gauntlet brawler",
                "equipment": ["reinforced gauntlets", "traveler's clothes"],
                "statSummary": "Built for armored unarmed strikes.",
                "campaignTieIn": "A mercenary tied to the next arena bout.",
            },
            "combat stance",
        )

        self.assertIn("reinforced gauntlets", prompt)
        self.assertIn("empty hands or armored fists", prompt)
        self.assertIn("do not add swords, axes, polearms, bows, or other held weapons", prompt)
        self.assertNotIn("weapon or spell prepared", prompt)

    def test_character_mock_image_uses_character_label(self):
        request = image_request("character", {"name": "Lethariel Moonglen"})

        with patch.dict("os.environ", {"IMAGE_GENERATION_ENABLED": "false", "IMAGE_PROVIDER": "gemini"}, clear=True):
            response = image_generation.generate_image(request)

        self.assertEqual(response["status"], "disabled")
        self.assertIn("CHARACTER%20PORTRAIT", response["imageUrl"])
        self.assertIn("Lethariel%20Moonglen", response["imageUrl"])

    def test_anime_style_is_supported_for_all_image_output_types(self):
        samples = {
            "npc": {"name": "Mira Vale"},
            "character": {"name": "Lethariel Moonglen"},
            "encounter": {"title": "Blackwater Mine Ambush"},
        }

        for output_type, data in samples.items():
            with self.subTest(output_type=output_type):
                prompt = image_generation.build_image_prompt(output_type, data, "anime")
                self.assertIn("anime-inspired original fantasy illustration", prompt)
                self.assertNotIn("cinematic fantasy concept art", prompt)


if __name__ == "__main__":
    unittest.main()
