import unittest

from rag.sanitizer import MAX_UPLOAD_CHARACTERS, sanitize_uploaded_text


class IngestSanitizerTests(unittest.TestCase):
    def test_removes_control_characters_but_keeps_normal_whitespace(self):
        sanitized = sanitize_uploaded_text("NPC\x00 name:\tMira\nQuest:\x1f Find the shard")

        self.assertEqual(sanitized, "NPC name:\tMira\nQuest: Find the shard")

    def test_strips_script_blocks_and_html_tags(self):
        sanitized = sanitize_uploaded_text(
            "# Lore\n<script>alert('nope')</script><p>The old keep hides a gate.</p>"
        )

        self.assertNotIn("script", sanitized.lower())
        self.assertNotIn("alert", sanitized.lower())
        self.assertIn("The old keep hides a gate.", sanitized)

    def test_caps_total_characters_before_indexing(self):
        sanitized = sanitize_uploaded_text("a" * (MAX_UPLOAD_CHARACTERS + 50))

        self.assertEqual(len(sanitized), MAX_UPLOAD_CHARACTERS)


if __name__ == "__main__":
    unittest.main()
