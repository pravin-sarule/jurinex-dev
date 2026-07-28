from __future__ import annotations

import sys
import types as python_types
import unittest
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import call, patch


_MODULE_PATH = (
    Path(__file__).resolve().parents[1]
    / "app"
    / "services"
    / "deep_research"
    / "gemini.py"
)
_SPEC = spec_from_file_location("deep_research_gemini_contracts_under_test", _MODULE_PATH)
assert _SPEC is not None and _SPEC.loader is not None
gemini = module_from_spec(_SPEC)
_SPEC.loader.exec_module(gemini)


def _fake_google_modules() -> dict[str, python_types.ModuleType]:
    fake_types = python_types.ModuleType("google.genai.types")
    fake_genai = python_types.ModuleType("google.genai")
    fake_genai.types = fake_types
    return {
        "google.genai": fake_genai,
        "google.genai.types": fake_types,
    }


class ClientAndFallbackContractTests(unittest.TestCase):
    def test_client_available_checks_all_models_and_deduplicates_names(self) -> None:
        with patch.object(gemini, "_client", return_value=object()) as get_client:
            available = gemini.client_available(
                "reasoning-model",
                "search-model",
                "reasoning-model",
            )

        self.assertTrue(available)
        self.assertEqual(
            get_client.call_args_list,
            [call("reasoning-model"), call("search-model")],
        )

    def test_client_available_fails_closed_on_invalid_or_failed_client(self) -> None:
        self.assertFalse(gemini.client_available())
        self.assertFalse(gemini.client_available(""))

        with patch.object(
            gemini,
            "_client",
            side_effect=RuntimeError("provider configuration is unavailable"),
        ):
            self.assertFalse(gemini.client_available("search-model"))

        with patch.object(gemini, "_client", return_value=None):
            self.assertFalse(gemini.client_available("search-model"))

    def test_search_without_client_keeps_five_value_return_contract(self) -> None:
        with patch.dict(sys.modules, _fake_google_modules()), patch.object(
            gemini,
            "_client",
            return_value=None,
        ):
            result = gemini.search(
                "search-model",
                "Find authority.",
                temperature=0.1,
                max_output_tokens=128,
            )

        self.assertEqual(result, ("", [], 0, 0, 0))


class GroundingContractTests(unittest.TestCase):
    @staticmethod
    def _response(*, include_supports: bool = True):
        chunks = [
            SimpleNamespace(
                web=SimpleNamespace(
                    uri="https://indiacode.nic.in/supported",
                    title="Supported source",
                )
            ),
            SimpleNamespace(
                web=SimpleNamespace(
                    uri="https://example.com/retrieved-but-unused",
                    title="Unsupported retrieval chunk",
                )
            ),
        ]
        supports = (
            [
                SimpleNamespace(
                    segment=SimpleNamespace(text="The supported proposition."),
                    grounding_chunk_indices=[0],
                )
            ]
            if include_supports
            else []
        )
        metadata = SimpleNamespace(
            grounding_chunks=chunks,
            grounding_supports=supports,
            web_search_queries=["query one"],
        )
        return SimpleNamespace(
            candidates=[SimpleNamespace(grounding_metadata=metadata)]
        )

    def test_only_chunks_tied_to_grounding_supports_are_emitted(self) -> None:
        sources, query_count = gemini._grounding_metadata(self._response())

        self.assertEqual(query_count, 1)
        self.assertEqual(len(sources), 1)
        self.assertEqual(
            sources[0]["uri"],
            "https://indiacode.nic.in/supported",
        )
        self.assertEqual(
            sources[0]["claim_texts"],
            ["The supported proposition."],
        )

    def test_retrieval_chunks_without_supports_are_not_citations(self) -> None:
        sources, query_count = gemini._grounding_metadata(
            self._response(include_supports=False)
        )

        self.assertEqual(sources, [])
        self.assertEqual(query_count, 1)


class FinishReasonContractTests(unittest.TestCase):
    def test_extracts_enum_and_string_finish_reasons(self) -> None:
        enum_chunk = SimpleNamespace(
            candidates=[
                SimpleNamespace(
                    finish_reason=SimpleNamespace(name="MAX_TOKENS")
                )
            ]
        )
        string_chunk = SimpleNamespace(
            candidates=[SimpleNamespace(finish_reason="FinishReason.STOP")]
        )

        self.assertEqual(gemini.chunk_finish_reason(enum_chunk), "MAX_TOKENS")
        self.assertEqual(gemini.chunk_finish_reason(string_chunk), "STOP")

    def test_missing_finish_reason_returns_empty_label(self) -> None:
        self.assertEqual(
            gemini.chunk_finish_reason(
                SimpleNamespace(candidates=[SimpleNamespace()])
            ),
            "",
        )


if __name__ == "__main__":
    unittest.main()
