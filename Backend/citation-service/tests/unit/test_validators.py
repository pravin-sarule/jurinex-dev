from __future__ import annotations

import unittest

from utils.validators import normalize_case_file_context


class TestNormalizeCaseFileContext(unittest.TestCase):
    def test_manual_text_becomes_document_context(self):
        result = normalize_case_file_context("  Bail was denied without reasons.  ")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["name"], "Manual case facts")
        self.assertEqual(result[0]["content"], "Bail was denied without reasons.")
        self.assertEqual(result[0]["snippet"], result[0]["content"])

    def test_document_context_is_preserved_and_invalid_rows_are_removed(self):
        result = normalize_case_file_context([
            {"name": "petition.pdf", "snippet": "Article 14 challenge"},
            "invalid row",
        ])

        self.assertEqual(result, [{"name": "petition.pdf", "snippet": "Article 14 challenge"}])

    def test_empty_or_unknown_context_becomes_empty_list(self):
        self.assertEqual(normalize_case_file_context("  "), [])
        self.assertEqual(normalize_case_file_context(None), [])
        self.assertEqual(normalize_case_file_context({"content": "not a list"}), [])


if __name__ == "__main__":
    unittest.main()
