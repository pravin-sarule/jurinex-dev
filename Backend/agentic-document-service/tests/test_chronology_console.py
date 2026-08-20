from __future__ import annotations

import unittest

from app.schemas.chronology import ChronologyDateNode, ChronologyEvent, ChronologyPhaseNode, ChronologyTree
from app.services.chronology.console import grid_table, kv_table, progress_bar, tree_diagram


class ConsoleTableTests(unittest.TestCase):
    def test_progress_bar_shows_step_and_percent(self) -> None:
        line = progress_bar(2, 4, "LLM extract")
        self.assertIn("2/4", line)
        self.assertIn("50%", line)
        self.assertIn("LLM extract", line)

    def test_kv_table_is_boxed(self) -> None:
        table = kv_table("TOKEN USAGE", [("model", "gemini-3.7-flash"), ("input_tokens", "12,345")])
        self.assertIn("gemini-3.7-flash", table)
        self.assertIn("input_tokens", table)
        self.assertIn("┌", table)
        self.assertIn("└", table)

    def test_grid_and_tree(self) -> None:
        grid = grid_table("UNIQUE DATES", ["date", "phase"], [["15 Jan 2019", "pre_litigation"]])
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
        diagram = tree_diagram(tree)
        self.assertIn("Pre-litigation", diagram)
        self.assertIn("15 Jan 2019", diagram)
        self.assertIn("Agreement executed", diagram)


if __name__ == "__main__":
    unittest.main()
