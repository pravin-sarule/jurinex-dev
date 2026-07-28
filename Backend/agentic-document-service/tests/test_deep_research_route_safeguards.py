from __future__ import annotations

import json
import unittest
from unittest.mock import MagicMock, patch

from app.api.routes.files import (
    _deep_research_persistence_citations,
    _estimate_deep_research_token_request,
)
from app.services import folder_service
from app.services.token_usage import estimate_streaming_token_request


class DeepResearchTokenAdmissionTests(unittest.TestCase):
    def test_deep_estimate_reserves_for_all_configured_stages(self) -> None:
        normal = estimate_streaming_token_request("What is the current law?")
        deep = _estimate_deep_research_token_request(
            "What is the current law?",
            llm_config={"max_output_tokens": 32_768},
            max_rounds=4,
        )

        self.assertEqual(deep["max_rounds"], 4)
        self.assertGreater(deep["estimated_input_tokens"], 0)
        self.assertGreater(deep["estimated_output_tokens"], 0)
        self.assertGreaterEqual(deep["safety_reserve_tokens"], 2_048)
        self.assertEqual(
            deep["estimated_total_tokens"],
            deep["estimated_input_tokens"]
            + deep["estimated_output_tokens"]
            + deep["safety_reserve_tokens"],
        )
        self.assertGreater(
            deep["estimated_total_tokens"],
            normal["estimated_total_tokens"],
        )

    def test_deep_estimate_clamps_untrusted_configuration(self) -> None:
        one_round = _estimate_deep_research_token_request(
            "question",
            llm_config={"max_output_tokens": 1},
            max_rounds=-100,
        )
        eight_rounds = _estimate_deep_research_token_request(
            "question",
            llm_config={"max_output_tokens": 999_999_999},
            max_rounds=999,
        )

        self.assertEqual(one_round["max_rounds"], 1)
        self.assertEqual(eight_rounds["max_rounds"], 8)
        self.assertGreater(
            eight_rounds["estimated_total_tokens"],
            one_round["estimated_total_tokens"],
        )


class DeepResearchPersistenceMarkerTests(unittest.TestCase):
    def test_zero_sources_still_gets_one_durable_deep_marker(self) -> None:
        persisted = _deep_research_persistence_citations([])

        self.assertEqual(len(persisted), 1)
        self.assertEqual(persisted[0]["source_type"], "deep_research_meta")
        self.assertIs(persisted[0]["deep_research"], True)

    def test_marker_helper_does_not_mutate_or_duplicate(self) -> None:
        source = {
            "source_type": "deep_research_web",
            "canonical_url": "https://www.sci.gov.in/",
            "validation_status": "valid",
        }
        original = [source]
        first = _deep_research_persistence_citations(original)
        second = _deep_research_persistence_citations(first)

        self.assertEqual(original, [source])
        self.assertEqual(first[0], source)
        self.assertEqual(
            sum(item.get("source_type") == "deep_research_meta" for item in second),
            1,
        )


class FolderChatPersistenceResultTests(unittest.TestCase):
    def setUp(self) -> None:
        self.service = folder_service.FolderWorkflowService.__new__(
            folder_service.FolderWorkflowService
        )
        self.kwargs = {
            "user_id": "42",
            "folder_name": "case-folder",
            "question": "question",
            "answer": "answer",
            "session_id": "1c8bf947-bb87-4df4-b035-d2e322c5c15f",
            "citations": _deep_research_persistence_citations([]),
        }

    @patch.object(folder_service, "is_db_available", return_value=False)
    def test_database_unavailable_is_opt_in_fail_closed(self, _available: MagicMock) -> None:
        self.assertIs(
            self.service._save_folder_chat_to_db(**self.kwargs),
            None,
        )
        with self.assertRaisesRegex(RuntimeError, "database is unavailable"):
            self.service._save_folder_chat_to_db(
                **self.kwargs,
                raise_on_error=True,
            )

    @patch.object(folder_service.logger, "exception")
    @patch.object(folder_service, "get_db_connection", side_effect=OSError("db down"))
    @patch.object(folder_service, "is_db_available", return_value=True)
    def test_database_error_preserves_none_or_reraises_when_requested(
        self,
        _available: MagicMock,
        _connection: MagicMock,
        _logged: MagicMock,
    ) -> None:
        self.assertIs(
            self.service._save_folder_chat_to_db(**self.kwargs),
            None,
        )
        with self.assertRaisesRegex(OSError, "db down"):
            self.service._save_folder_chat_to_db(
                **self.kwargs,
                raise_on_error=True,
            )

    @patch.object(folder_service, "is_db_available", return_value=True)
    def test_success_returns_true_and_serializes_deep_marker(
        self,
        _available: MagicMock,
    ) -> None:
        connection_manager = MagicMock()
        connection = connection_manager.__enter__.return_value
        cursor = connection.cursor.return_value.__enter__.return_value

        with patch.object(
            folder_service,
            "get_db_connection",
            return_value=connection_manager,
        ):
            saved = self.service._save_folder_chat_to_db(
                **self.kwargs,
                raise_on_error=True,
            )

        self.assertIs(saved, True)
        connection.commit.assert_called_once_with()
        params = cursor.execute.call_args.args[1]
        persisted_citations = json.loads(params[-1])
        self.assertEqual(persisted_citations[0]["source_type"], "deep_research_meta")
        self.assertIs(persisted_citations[0]["deep_research"], True)


if __name__ == "__main__":
    unittest.main()
