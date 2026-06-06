import sys
import types
import unittest
from unittest.mock import Mock, patch

import httpx

from app.orchestration import gemini_provider


class FakeCredentials:
    def __init__(self, token: str | None = None, valid: bool = False):
        self.token = token
        self.valid = valid
        self.refresh_request = None

    def refresh(self, request):
        self.refresh_request = request
        self.token = "vertex-token"
        self.valid = True


class FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code
        self.text = str(payload)

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("request failed", request=Mock(), response=self)


class VertexProviderTests(unittest.TestCase):
    def test_provider_selection_accepts_gemini_and_vertex(self):
        for provider in ("gemini", "vertex"):
            with patch.dict("os.environ", {"LLM_PROVIDER": provider}, clear=True):
                gemini_provider._ensure_gemini_provider()

        with patch.dict("os.environ", {"LLM_PROVIDER": "openai"}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "LLM_PROVIDER=gemini.*LLM_PROVIDER=vertex"):
                gemini_provider._ensure_gemini_provider()

    def test_vertex_endpoint_uses_global_aiplatform_host(self):
        with patch.dict(
            "os.environ",
            {
                "VERTEX_PROJECT_ID": "project-de842900-cb0b-4155-b9c",
                "VERTEX_LOCATION": "global",
                "VERTEX_MODEL": "gemini-2.5-flash",
            },
            clear=True,
        ):
            self.assertEqual(
                gemini_provider._vertex_endpoint(),
                "https://aiplatform.googleapis.com/v1/projects/project-de842900-cb0b-4155-b9c/"
                "locations/global/publishers/google/models/gemini-2.5-flash:generateContent",
            )

    def test_vertex_endpoint_uses_regional_aiplatform_host(self):
        with patch.dict(
            "os.environ",
            {
                "VERTEX_PROJECT_ID": "dndmind-prod",
                "VERTEX_LOCATION": "us-central1",
                "VERTEX_MODEL": "models/gemini-2.5-flash",
            },
            clear=True,
        ):
            self.assertEqual(
                gemini_provider._vertex_endpoint(),
                "https://us-central1-aiplatform.googleapis.com/v1/projects/dndmind-prod/"
                "locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent",
            )

    def test_vertex_requires_project_id(self):
        with patch.dict("os.environ", {"LLM_PROVIDER": "vertex"}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "VERTEX_PROJECT_ID is required"):
                gemini_provider._generate_json("system", "user")

    def test_gemini_api_key_mode_still_requires_api_key(self):
        with patch.dict("os.environ", {"LLM_PROVIDER": "gemini"}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "GEMINI_API_KEY is required"):
                gemini_provider._generate_json("system", "user")

    def test_vertex_auth_and_request_behavior(self):
        credentials = FakeCredentials()
        google_modules = self._fake_google_auth_modules(credentials)
        response = FakeResponse(
            {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "text": '{"answer":"Ready","structuredOutput":null,"suggestedActions":[]}',
                                }
                            ]
                        }
                    }
                ]
            }
        )

        with (
            patch.dict(
                "os.environ",
                {
                    "LLM_PROVIDER": "vertex",
                    "VERTEX_PROJECT_ID": "project-de842900-cb0b-4155-b9c",
                    "VERTEX_LOCATION": "global",
                    "VERTEX_MODEL": "gemini-2.5-flash",
                    "VERTEX_TEMPERATURE": "0.4",
                    "VERTEX_TIMEOUT_SECONDS": "12",
                },
                clear=True,
            ),
            patch.dict(sys.modules, google_modules),
            patch("app.orchestration.gemini_provider.httpx.post", return_value=response) as post,
        ):
            parsed = gemini_provider._generate_json("system instruction", "user prompt")

        self.assertEqual(parsed["answer"], "Ready")
        self.assertIsNotNone(credentials.refresh_request)
        post.assert_called_once()
        _, kwargs = post.call_args
        self.assertEqual(
            post.call_args.args[0],
            "https://aiplatform.googleapis.com/v1/projects/project-de842900-cb0b-4155-b9c/"
            "locations/global/publishers/google/models/gemini-2.5-flash:generateContent",
        )
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer vertex-token")
        self.assertEqual(kwargs["headers"]["Content-Type"], "application/json")
        self.assertEqual(kwargs["json"]["systemInstruction"]["parts"][0]["text"], "system instruction")
        self.assertEqual(kwargs["json"]["contents"][0]["parts"][0]["text"], "user prompt")
        self.assertEqual(kwargs["json"]["generationConfig"]["temperature"], 0.4)
        self.assertEqual(kwargs["json"]["generationConfig"]["responseMimeType"], "application/json")
        self.assertEqual(kwargs["timeout"], 12.0)

    def _fake_google_auth_modules(self, credentials: FakeCredentials) -> dict[str, types.ModuleType]:
        google = types.ModuleType("google")
        auth = types.ModuleType("google.auth")
        transport = types.ModuleType("google.auth.transport")
        requests = types.ModuleType("google.auth.transport.requests")

        class FakeRequest:
            pass

        auth.default = Mock(return_value=(credentials, "default-project"))
        requests.Request = FakeRequest
        google.auth = auth
        auth.transport = transport
        transport.requests = requests

        return {
            "google": google,
            "google.auth": auth,
            "google.auth.transport": transport,
            "google.auth.transport.requests": requests,
        }


if __name__ == "__main__":
    unittest.main()
