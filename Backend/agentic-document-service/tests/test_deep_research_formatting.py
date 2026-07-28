from __future__ import annotations

import unittest
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path


_MODULE_PATH = (
    Path(__file__).resolve().parents[1]
    / "app"
    / "services"
    / "deep_research"
    / "formatting.py"
)
_SPEC = spec_from_file_location("deep_research_formatting_under_test", _MODULE_PATH)
assert _SPEC is not None and _SPEC.loader is not None
formatting = module_from_spec(_SPEC)
_SPEC.loader.exec_module(formatting)

normalize = formatting.normalize_ascii_layout


class AsciiLayoutNormalizationTests(unittest.TestCase):
    def test_character_drawn_table_becomes_a_gfm_table(self) -> None:
        answer = "\n".join(
            [
                "## Risks",
                "",
                "```",
                "+-------------------+--------------------------+",
                "| Risk Area         | Primary Legal Exposure   |",
                "+-------------------+--------------------------+",
                "| Non-Registration  | Criminal fine u/s 55(2)  |",
                "| Inadequate Stamp  | Impounding u/s 33        |",
                "+-------------------+--------------------------+",
                "```",
            ]
        )

        out = normalize(answer)

        self.assertNotIn("```", out)
        self.assertNotIn("+---", out)
        self.assertIn("| Risk Area | Primary Legal Exposure |", out)
        self.assertIn("| --- | --- |", out)
        self.assertIn("| Non-Registration | Criminal fine u/s 55(2) |", out)
        self.assertIn("| Inadequate Stamp | Impounding u/s 33 |", out)

    def test_exactly_one_separator_row_is_emitted(self) -> None:
        out = normalize("```\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n```")
        rows = [line for line in out.splitlines() if line.startswith("|")]
        separators = [line for line in rows if set(line) <= set("| -:")]
        self.assertEqual(len(separators), 1)
        self.assertEqual(len(rows), 4)

    def test_banner_row_becomes_a_caption_not_the_header(self) -> None:
        answer = "\n".join(
            [
                "```",
                "+--------------------------------------------+",
                "|        RISK ASSESSMENT & MITIGATION        |",
                "+-------------------+------------------+-----+",
                "| Risk Area         | Exposure         | Fix |",
                "+-------------------+------------------+-----+",
                "| Non-Registration  | Fine u/s 55(2)   | Reg |",
                "+-------------------+------------------+-----+",
                "```",
            ]
        )

        out = normalize(answer)

        self.assertIn("**RISK ASSESSMENT & MITIGATION**", out)
        self.assertIn("| Risk Area | Exposure | Fix |", out)
        self.assertIn("| Non-Registration | Fine u/s 55(2) | Reg |", out)

    def test_unicode_box_table_is_converted(self) -> None:
        answer = "\n".join(
            [
                "```",
                "┌────────────┬───────────┐",
                "│ Court      │ Binding?  │",
                "├────────────┼───────────┤",
                "│ Supreme    │ Yes       │",
                "└────────────┴───────────┘",
                "```",
            ]
        )

        out = normalize(answer)

        self.assertIn("| Court | Binding? |", out)
        self.assertIn("| Supreme | Yes |", out)
        for char in "│┌└├":
            self.assertNotIn(char, out)

    def test_ascii_flow_diagram_becomes_an_arrow_chain(self) -> None:
        answer = "\n".join(
            [
                "```",
                "Demand notice served",
                "   | (payment not made within 15 days)",
                "   v",
                "Cause of action arises --> Complaint before Magistrate",
                "```",
            ]
        )

        self.assertEqual(
            normalize(answer),
            "Demand notice served → (payment not made within 15 days) → "
            "Cause of action arises → Complaint before Magistrate",
        )

    def test_long_flow_becomes_a_step_list(self) -> None:
        body = "\n   v\n".join(f"Stage {i}" for i in range(1, 11))
        out = normalize(f"```\n{body}\n```")
        self.assertIn("- Stage 1", out)
        self.assertIn("- Stage 10", out)
        self.assertNotIn("→", out)

    def test_real_code_fences_are_left_alone(self) -> None:
        python = "```python\ndef add(a, b):\n    return a + b\n```"
        self.assertEqual(normalize(python), python)

        untagged_code = '```\n{\n  "section": "55(2)"\n}\n```'
        self.assertEqual(normalize(untagged_code), untagged_code)

    def test_fenced_prose_is_unwrapped_with_its_line_structure(self) -> None:
        answer = "\n".join(
            [
                "```",
                "LEAVE AND LICENSE AGREEMENT",
                "BY AND BETWEEN",
                "MR. RAMESH KRISHNARAO DESAI",
                "```",
            ]
        )

        out = normalize(answer)

        self.assertNotIn("```", out)
        self.assertIn("LEAVE AND LICENSE AGREEMENT\\", out)
        self.assertIn("MR. RAMESH KRISHNARAO DESAI", out)

    def test_loose_borders_are_dropped_but_markdown_rules_survive(self) -> None:
        answer = "\n".join(
            [
                "## Findings",
                "",
                "+----------+--------+",
                "| Case | Year |",
                "| --- | --- |",
                "| Ramesh | 2024 |",
                "+----------+--------+",
                "",
                "---",
                "",
                "Next section.",
            ]
        )

        out = normalize(answer)

        self.assertNotIn("+----------+", out)
        self.assertIn("| --- | --- |", out)
        self.assertIn("\n---\n", out)
        self.assertIn("| Ramesh | 2024 |", out)

    def test_unterminated_fence_from_a_truncated_stream_is_still_rewritten(self) -> None:
        out = normalize("Report:\n\n```\n| Case | Year |\n| Ramesh | 2024 |")
        self.assertNotIn("```", out)
        self.assertIn("| Case | Year |", out)
        self.assertIn("| --- | --- |", out)

    def test_clean_markdown_is_untouched(self) -> None:
        answer = (
            "## Heading\n\nSome **bold** prose with [S1].\n\n"
            "| A | B |\n| --- | --- |\n| 1 | 2 |"
        )
        self.assertEqual(normalize(answer), answer)

    def test_empty_and_none_input(self) -> None:
        self.assertEqual(normalize(""), "")
        self.assertEqual(normalize(None), "")

    def test_is_idempotent(self) -> None:
        answer = "```\n+----+----+\n| A  | B  |\n+----+----+\n| 1  | 2  |\n+----+----+\n```"
        once = normalize(answer)
        self.assertEqual(normalize(once), once)


class ColumnSeparationTests(unittest.TestCase):
    def test_space_aligned_columns_are_separated_not_run_together(self) -> None:
        answer = "\n".join(
            [
                "```",
                "01 July 2025            30 Sept 2025          01 May 2026",
                "v                       v                     v",
                "| Stage | Event |",
                "| Start | Handover |",
                "```",
            ]
        )

        out = normalize(answer)

        self.assertIn("01 July 2025 · 30 Sept 2025 · 01 May 2026", out)
        self.assertNotIn("202530", out)
        self.assertIn("| Stage | Event |", out)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
