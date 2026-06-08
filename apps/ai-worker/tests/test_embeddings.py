import os
import unittest
from unittest.mock import patch

from rag.embeddings import (
    EMBEDDING_DIMENSIONS,
    embed_query,
    embed_texts,
    embedding_model_name,
    embedding_provider,
    vertex_embedding_endpoint,
)


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class EmbeddingTests(unittest.TestCase):
    def test_embedding_provider_defaults_to_llm_provider(self):
        with patch.dict(os.environ, {"LLM_PROVIDER": "gemini"}, clear=True):
            self.assertEqual(embedding_provider(), "gemini")
            self.assertEqual(embedding_model_name(), "gemini-embedding-001")

    def test_gemini_embeddings_request_shape(self):
        captured = {}
        vector = [0.1] * EMBEDDING_DIMENSIONS

        def fake_post(url, headers, json, timeout):
            captured["url"] = url
            captured["headers"] = headers
            captured["json"] = json
            captured["timeout"] = timeout
            return FakeResponse({"embeddings": [{"values": vector}, {"values": vector}]})

        env = {
            "MOCK_EMBEDDINGS": "false",
            "EMBEDDING_PROVIDER": "gemini",
            "GEMINI_API_KEY": "test-key",
            "GEMINI_EMBEDDING_MODEL": "gemini-embedding-001",
        }
        with patch.dict(os.environ, env, clear=True), patch("rag.embeddings.httpx.post", side_effect=fake_post):
            embeddings = embed_texts(["one", "two"])

        self.assertEqual(len(embeddings), 2)
        self.assertIn("models/gemini-embedding-001:batchEmbedContents", captured["url"])
        self.assertEqual(captured["headers"]["x-goog-api-key"], "test-key")
        self.assertEqual(captured["json"]["requests"][0]["taskType"], "RETRIEVAL_DOCUMENT")
        self.assertEqual(captured["json"]["requests"][0]["outputDimensionality"], 1536)
        self.assertEqual(captured["json"]["requests"][0]["embedContentConfig"]["taskType"], "RETRIEVAL_DOCUMENT")
        self.assertEqual(captured["json"]["requests"][0]["embedContentConfig"]["outputDimensionality"], 1536)

    def test_gemini_query_uses_query_task_type(self):
        captured = {}
        vector = [0.2] * EMBEDDING_DIMENSIONS

        def fake_post(url, headers, json, timeout):
            captured["json"] = json
            return FakeResponse({"embeddings": [{"values": vector}]})

        env = {
            "MOCK_EMBEDDINGS": "false",
            "EMBEDDING_PROVIDER": "gemini",
            "GEMINI_API_KEY": "test-key",
        }
        with patch.dict(os.environ, env, clear=True), patch("rag.embeddings.httpx.post", side_effect=fake_post):
            embedding = embed_query("where is the cult ledger?")

        self.assertEqual(embedding, vector)
        self.assertEqual(captured["json"]["requests"][0]["embedContentConfig"]["taskType"], "RETRIEVAL_QUERY")

    def test_gemini_dimensions_must_match_schema(self):
        env = {
            "MOCK_EMBEDDINGS": "false",
            "EMBEDDING_PROVIDER": "gemini",
            "GEMINI_API_KEY": "test-key",
            "GEMINI_EMBEDDING_DIMENSIONS": "768",
        }
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaisesRegex(RuntimeError, "pgvector schema"):
                embed_texts(["dimension mismatch"])

    def test_gemini_response_dimensions_must_match_schema(self):
        vector = [0.3] * 3072

        def fake_post(url, headers, json, timeout):
            return FakeResponse({"embeddings": [{"values": vector}]})

        env = {
            "MOCK_EMBEDDINGS": "false",
            "EMBEDDING_PROVIDER": "gemini",
            "GEMINI_API_KEY": "test-key",
        }
        with patch.dict(os.environ, env, clear=True), patch("rag.embeddings.httpx.post", side_effect=fake_post):
            with self.assertRaisesRegex(RuntimeError, "database expects 1536"):
                embed_texts(["oversized response"])

    def test_vertex_embeddings_request_shape(self):
        captured = []
        vector = [0.4] * EMBEDDING_DIMENSIONS

        def fake_post(url, headers, json, timeout):
            captured.append({"url": url, "headers": headers, "json": json, "timeout": timeout})
            return FakeResponse({"predictions": [{"embeddings": {"values": vector}}]})

        env = {
            "MOCK_EMBEDDINGS": "false",
            "EMBEDDING_PROVIDER": "vertex",
            "VERTEX_PROJECT_ID": "dndmind-test",
            "VERTEX_LOCATION": "us-central1",
            "VERTEX_EMBEDDING_MODEL": "gemini-embedding-001",
            "VERTEX_EMBEDDING_DIMENSIONS": "1536",
        }
        with (
            patch.dict(os.environ, env, clear=True),
            patch("rag.embeddings.vertex_access_token", return_value="vertex-token"),
            patch("rag.embeddings.httpx.post", side_effect=fake_post),
        ):
            embeddings = embed_texts(["one", "two"])

        self.assertEqual(len(embeddings), 2)
        self.assertIn("us-central1-aiplatform.googleapis.com", captured[0]["url"])
        self.assertIn("/models/gemini-embedding-001:predict", captured[0]["url"])
        self.assertEqual(captured[0]["headers"]["Authorization"], "Bearer vertex-token")
        self.assertEqual(captured[0]["json"]["instances"][0]["content"], "one")
        self.assertEqual(captured[0]["json"]["instances"][0]["task_type"], "RETRIEVAL_DOCUMENT")
        self.assertEqual(captured[0]["json"]["parameters"]["outputDimensionality"], 1536)

    def test_vertex_query_uses_query_task_type(self):
        captured = {}
        vector = [0.5] * EMBEDDING_DIMENSIONS

        def fake_post(url, headers, json, timeout):
            captured["json"] = json
            return FakeResponse({"predictions": [{"embeddings": {"values": vector}}]})

        env = {
            "MOCK_EMBEDDINGS": "false",
            "EMBEDDING_PROVIDER": "vertex",
            "VERTEX_PROJECT_ID": "dndmind-test",
        }
        with (
            patch.dict(os.environ, env, clear=True),
            patch("rag.embeddings.vertex_access_token", return_value="vertex-token"),
            patch("rag.embeddings.httpx.post", side_effect=fake_post),
        ):
            embedding = embed_query("where is the cult ledger?")

        self.assertEqual(embedding, vector)
        self.assertEqual(captured["json"]["instances"][0]["task_type"], "RETRIEVAL_QUERY")

    def test_vertex_dimensions_must_match_schema(self):
        env = {
            "MOCK_EMBEDDINGS": "false",
            "EMBEDDING_PROVIDER": "vertex",
            "VERTEX_PROJECT_ID": "dndmind-test",
            "VERTEX_EMBEDDING_DIMENSIONS": "768",
        }
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaisesRegex(RuntimeError, "pgvector schema"):
                embed_texts(["dimension mismatch"])

    def test_vertex_response_dimensions_must_match_schema(self):
        vector = [0.6] * 3072

        def fake_post(url, headers, json, timeout):
            return FakeResponse({"predictions": [{"embeddings": {"values": vector}}]})

        env = {
            "MOCK_EMBEDDINGS": "false",
            "EMBEDDING_PROVIDER": "vertex",
            "VERTEX_PROJECT_ID": "dndmind-test",
        }
        with (
            patch.dict(os.environ, env, clear=True),
            patch("rag.embeddings.vertex_access_token", return_value="vertex-token"),
            patch("rag.embeddings.httpx.post", side_effect=fake_post),
        ):
            with self.assertRaisesRegex(RuntimeError, "database expects 1536"):
                embed_texts(["oversized response"])

    def test_vertex_endpoint_uses_global_base_url(self):
        env = {
            "EMBEDDING_PROVIDER": "vertex",
            "VERTEX_PROJECT_ID": "dndmind-test",
            "VERTEX_LOCATION": "global",
        }
        with patch.dict(os.environ, env, clear=True):
            self.assertEqual(
                vertex_embedding_endpoint(),
                "https://aiplatform.googleapis.com/v1/projects/dndmind-test/locations/global/publishers/google/models/gemini-embedding-001:predict",
            )


if __name__ == "__main__":
    unittest.main()
