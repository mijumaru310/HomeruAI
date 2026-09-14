import unittest
import os
import tempfile
from types import SimpleNamespace
from unittest.mock import Mock, patch

os.environ.setdefault("HOMERUAI_DATA_DIR", tempfile.mkdtemp(prefix="homeruai-ai-tests-"))
os.environ.setdefault("TURSO_DATABASE_URL", "")
os.environ.setdefault("TURSO_AUTH_TOKEN", "")

from app import analyzer
from app.schemas import AIRecognition


class ProviderFailoverTests(unittest.TestCase):
    def setUp(self):
        self.types = SimpleNamespace(GenerateContentConfig=lambda **kwargs: kwargs)
        self.recognition = AIRecognition(recognized_question="3x + 5 = 20", confidence=0.8)

    def _client(self, outcome):
        client = Mock()
        if isinstance(outcome, Exception):
            client.models.generate_content.side_effect = outcome
        else:
            client.models.generate_content.return_value = SimpleNamespace(parsed=outcome)
        return client

    def test_vertex_is_first_and_api_key_is_not_called_on_success(self):
        vertex = self._client(self.recognition)
        with patch.object(analyzer, "VERTEX_PROJECT", "test-project"), \
             patch.object(analyzer, "GEMINI_API_KEY", "test-key"), \
             patch.object(analyzer, "_create_client", return_value=vertex) as create:
            result = analyzer._generate_with_failover(
                self.types, schema=AIRecognition, contents="image",
                system_instruction="read",
            )
        self.assertEqual(result.provider, "vertex_ai")
        self.assertEqual(result.model, analyzer.VERTEX_MODEL)
        self.assertIsNone(result.vertex_error_category)
        create.assert_called_once()
        self.assertEqual(create.call_args.args[0], "vertex_ai")
        vertex.close.assert_called_once()

    def test_vertex_failure_uses_api_key_and_records_reason(self):
        vertex = self._client(RuntimeError("429 resource_exhausted"))
        developer = self._client(self.recognition)
        with patch.object(analyzer, "VERTEX_PROJECT", "test-project"), \
             patch.object(analyzer, "GEMINI_API_KEY", "test-key"), \
             patch.object(analyzer, "_create_client", side_effect=[vertex, developer]) as create:
            result = analyzer._generate_with_failover(
                self.types, schema=AIRecognition, contents="image",
                system_instruction="read",
            )
        self.assertEqual(result.provider, "gemini_api")
        self.assertEqual(result.vertex_error_category, "quota")
        self.assertEqual([item.args[0] for item in create.call_args_list], ["vertex_ai", "gemini_api"])
        vertex.close.assert_called_once()
        developer.close.assert_called_once()

    def test_both_provider_failures_become_explicit_unavailable_error(self):
        vertex = self._client(RuntimeError("503 unavailable"))
        developer = self._client(RuntimeError("429 resource_exhausted"))
        with patch.object(analyzer, "VERTEX_PROJECT", "test-project"), \
             patch.object(analyzer, "GEMINI_API_KEY", "test-key"), \
             patch.object(analyzer, "_create_client", side_effect=[vertex, developer]):
            with self.assertRaises(analyzer.AIProvidersUnavailable) as caught:
                analyzer._generate_with_failover(
                    self.types, schema=AIRecognition, contents="image",
                    system_instruction="read",
                )
        self.assertEqual(caught.exception.category, "quota")

    def test_missing_vertex_project_keeps_existing_api_key_path(self):
        developer = self._client(self.recognition)
        with patch.object(analyzer, "VERTEX_PROJECT", ""), \
             patch.object(analyzer, "GEMINI_API_KEY", "test-key"), \
             patch.object(analyzer, "_create_client", return_value=developer) as create:
            result = analyzer._generate_with_failover(
                self.types, schema=AIRecognition, contents="image",
                system_instruction="read",
            )
        self.assertEqual(result.provider, "gemini_api")
        create.assert_called_once()
        self.assertEqual(create.call_args.args[0], "gemini_api")

    def test_vertex_client_uses_project_location_and_server_credentials(self):
        fake_genai = SimpleNamespace(Client=Mock())
        fake_types = SimpleNamespace(HttpOptions=lambda **kwargs: kwargs)
        credential = object()
        with patch.object(analyzer, "VERTEX_PROJECT", "research-project"), \
             patch.object(analyzer, "VERTEX_LOCATION", "global"), \
             patch.object(analyzer, "VERTEX_SERVICE_ACCOUNT_JSON", '{"type":"service_account"}'), \
             patch("google.oauth2.service_account.Credentials.from_service_account_info", return_value=credential) as auth:
            analyzer._create_client("vertex_ai", fake_genai, fake_types)
        auth.assert_called_once()
        kwargs = fake_genai.Client.call_args.kwargs
        self.assertTrue(kwargs["enterprise"])
        self.assertEqual(kwargs["project"], "research-project")
        self.assertEqual(kwargs["location"], "global")
        self.assertIs(kwargs["credentials"], credential)
        self.assertNotIn("api_key", kwargs)

    def test_vertex_client_without_json_uses_application_default_credentials(self):
        fake_genai = SimpleNamespace(Client=Mock())
        fake_types = SimpleNamespace(HttpOptions=lambda **kwargs: kwargs)
        with patch.object(analyzer, "VERTEX_PROJECT", "research-project"), \
             patch.object(analyzer, "VERTEX_SERVICE_ACCOUNT_JSON", ""):
            analyzer._create_client("vertex_ai", fake_genai, fake_types)
        self.assertIsNone(fake_genai.Client.call_args.kwargs["credentials"])

    def test_api_key_client_explicitly_disables_enterprise_routing(self):
        fake_genai = SimpleNamespace(Client=Mock())
        fake_types = SimpleNamespace(HttpOptions=lambda **kwargs: kwargs)
        with patch.object(analyzer, "GEMINI_API_KEY", "test-key"):
            analyzer._create_client("gemini_api", fake_genai, fake_types)
        kwargs = fake_genai.Client.call_args.kwargs
        self.assertFalse(kwargs["enterprise"])
        self.assertEqual(kwargs["api_key"], "test-key")


if __name__ == "__main__":
    unittest.main()
