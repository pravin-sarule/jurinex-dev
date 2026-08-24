from __future__ import annotations

import unittest

from app.core.logging import _continuation_indent, configure_logging
from app.schemas.chronology import ChronologyDateNode, ChronologyEvent, ChronologyPhaseNode, ChronologyTree
from app.services.chronology.console import grid_table, kv_table, log_run_report, progress_bar, tree_diagram


def _line_widths(block: str) -> list[int]:
    return [len(line) for line in block.splitlines()]


class ConsoleTableTests(unittest.TestCase):
    def test_progress_bar_shows_step_and_percent(self) -> None:
        line = progress_bar(2, 4, "LLM extract")
        self.assertIn("2/4", line)
        self.assertIn("50%", line)
        self.assertIn("LLM extract", line)

    def test_kv_table_is_boxed_and_aligned(self) -> None:
        table = kv_table(
            "AUTO-FILL + CHRONOLOGY",
            [
                ("model", "gemini-3.7-flash"),
                ("document", "Ahmednagar forging _LT.pdf"),
                ("fields", "caseType, caseNumber, filingDate, caseTitle, courtLevel, courtName"),
            ],
            max_width=56,
        )
        widths = _line_widths(table)
        self.assertTrue(widths)
        self.assertEqual(len(set(widths)), 1, table)
        self.assertLessEqual(widths[0], 56, table)
        self.assertIn("gemini-3.7-flash", table)
        self.assertIn("document", table)
        self.assertTrue(table.startswith("+"))

    def test_grid_and_tree_stay_within_width(self) -> None:
        grid = grid_table(
            "UNIQUE DATES (earliest first)",
            ["date", "phase", "event"],
            [
                ["15 Jan 2019", "pre_litigation", "Agreement executed between the parties"],
                ["08 May 2014", "pleadings", "Statement of Claim Filed by Workman"],
            ],
            max_width=56,
        )
        widths = _line_widths(grid)
        self.assertEqual(len(set(widths)), 1, grid)
        self.assertLessEqual(widths[0], 56, grid)
        self.assertIn("15 Jan 2019", grid)
        node = ChronologyDateNode(
            date="2019-01-15",
            displayDate="15 Jan 2019",
            phase="pre_litigation",
            events=[ChronologyEvent(title="Agreement executed")],
        )
        tree = ChronologyTree(
            dates=[node],
            phases=[ChronologyPhaseNode(id="pre_litigation", label="Pre-litigation", dates=[node])],
        )
        diagram = tree_diagram(tree, max_width=56)
        self.assertIn("Pre-litigation", diagram)
        self.assertIn("15 Jan 2019", diagram)
        self.assertIn("Agreement executed", diagram)
        self.assertTrue(all(len(line) <= 56 for line in diagram.splitlines()), diagram)

    def test_boxed_tables_start_at_column_zero(self) -> None:
        configure_logging("INFO")
        table = kv_table("AUTO-FILL + CHRONOLOGY", [("case", "259")], max_width=48)
        self.assertEqual(_continuation_indent("model=gemini-3.7-flash\n" + table), 0)

    def test_log_run_report_fits_narrow_message_column(self) -> None:
        node = ChronologyDateNode(
            date="2011-03-28",
            displayDate="28 Mar 2011",
            phase="pre_litigation",
            events=[ChronologyEvent(title="Appointment of Respondent as Trainee")],
        )
        tree = ChronologyTree(
            dates=[node],
            phases=[ChronologyPhaseNode(id="pre_litigation", label="Pre-litigation", dates=[node])],
            eventCount=1,
        )
        logs: list[str] = []
        with self.assertLogs("agentic_document_service.chronology", level="INFO") as captured:
            log_run_report(
                stage="intake document",
                case_id="temp-445afba97dad",
                document_name="Ahmednagar forging _LT.pdf",
                chars=519072,
                elapsed_s=302.8,
                fields_filled=8,
                field_names=["caseType", "caseNumber", "filingDate", "caseTitle", "courtLevel", "courtName"],
                kept_events=0,
                dropped_events=0,
                drop_reasons=None,
                tree=tree,
                usage={"model": "-", "provider": "-", "inputTokens": 0, "outputTokens": 0, "totalTokens": 0},
            )
            logs.extend(captured.output)
        body = "\n".join(logs)
        self.assertIn("AUTO-FILL + CHRONOLOGY", body)
        self.assertIn("IN PLAIN LANGUAGE", body)
        self.assertIn("TIMELINE", body)
        self.assertIn("temp-445afba97dad", body)
        for line in body.splitlines():
            if line.startswith("+") or line.startswith("|"):
                self.assertLessEqual(len(line.split(":", 1)[-1].lstrip()), 80)

    def test_report_explains_ocr_vote_and_pin_cites(self) -> None:
        node = ChronologyDateNode(
            date="2010-12-07",
            displayDate="07 Dec 2010",
            phase="pre_litigation",
            events=[ChronologyEvent(title="Expiry of second policy", sourcePage="100")],
        )
        tree = ChronologyTree(
            dates=[node],
            phases=[ChronologyPhaseNode(id="pre_litigation", label="Pre-litigation", dates=[node])],
            eventCount=1,
        )
        with self.assertLogs("agentic_document_service.chronology", level="INFO") as captured:
            log_run_report(
                stage="intake document",
                case_id="temp-test",
                document_name="writ.pdf",
                chars=12000,
                elapsed_s=4.2,
                fields_filled=2,
                field_names=["caseTitle", "caseNumber"],
                kept_events=1,
                dropped_events=1,
                drop_reasons={"quote_not_in_document": 1},
                tree=tree,
                proposed_events=2,
                corrections=[{"from": "07 Dec 2012", "to": "07 Dec 2010", "title": "Expiry of second policy"}],
                pages_cited=1,
                pages_missing=0,
                ocr_pages=4,
                pack={"explain": "Sent every page (4 · 12,000 chars). Fits under the 900,000 character cap."},
                usage={"model": "gemini-3.7-flash", "provider": "gemini", "inputTokens": 100, "outputTokens": 50, "totalTokens": 150},
            )
        body = "\n".join(captured.output)
        self.assertIn("IN PLAIN LANGUAGE", body)
        self.assertIn("WHY EVENTS WERE DROPPED", body)
        self.assertIn("quote not found", body)
        self.assertIn("OCR MAJORITY VOTE", body)
        self.assertIn("07 Dec 2012", body)
        self.assertIn("p.", body)
        self.assertIn("100", body)


if __name__ == "__main__":
    unittest.main()
