import json
import unittest
from unittest import mock

from captioning.ollama_caption_client import OllamaCaptionClient, _normalize_ollama_endpoint, _tags_endpoint


class OllamaEndpointTests(unittest.TestCase):
    def test_scheme_less_base_url_is_supported(self):
        self.assertEqual(_normalize_ollama_endpoint("127.0.0.1:11434"), "http://127.0.0.1:11434/api/chat")
        self.assertEqual(_tags_endpoint("127.0.0.1:11434"), "http://127.0.0.1:11434/api/tags")

    def test_existing_api_paths_are_preserved(self):
        self.assertEqual(_normalize_ollama_endpoint("http://127.0.0.1:11434/api"), "http://127.0.0.1:11434/api/chat")
        self.assertEqual(_tags_endpoint("http://127.0.0.1:11434/api/chat"), "http://127.0.0.1:11434/api/tags")

    def test_list_models_prefers_smaller_models_first(self):
        payload = {
            "models": [
                {"name": "qwen3.5:122b", "size": 81_000},
                {"name": "qwen3.5:35b-a3b", "size": 23_000},
            ]
        }

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return json.dumps(payload).encode("utf-8")

        with mock.patch("urllib.request.urlopen", return_value=FakeResponse()):
            self.assertEqual(
                OllamaCaptionClient().list_models("http://127.0.0.1:11434"),
                ["qwen3.5:35b-a3b", "qwen3.5:122b"],
            )


if __name__ == "__main__":
    unittest.main()
