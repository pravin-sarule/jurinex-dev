from __future__ import annotations

import unittest

from app.services.chronology.extract import extract_grounded_events
from app.services.chronology.merge import merge_events
from app.services.chronology.models import GroundedEvent


SOURCE = (
    "The agreement was executed on 15 January 2019 at Pune. "
    "A demand notice dated 20 June 2020 was issued to the defendant. "
    "The suit was filed on 10 January 2021."
)


def _event(**kwargs: str) -> GroundedEvent:
    defaults = {
        "date_key": "2019-01-15",
        "display_date": "15 Jan 2019",
        "precision": "day",
        "title": "Agreement executed",
        "particulars": "The agreement was executed at Pune.",
        "event_type": "agreement",
        "phase": "pre_litigation",
        "source_document": "plaint.pdf",
        "source_quote": "agreement was executed on 15 January 2019",
    }
    defaults.update(kwargs)
    return GroundedEvent(**defaults)  # type: ignore[arg-type]


class ExtractGroundingTests(unittest.TestCase):
    def test_drops_invented_date_and_keeps_quoted_event(self) -> None:
        payload = {
            "events": [
                {
                    "date": "2019-01-15",
                    "title": "Agreement executed",
                    "particulars": "The agreement was executed at Pune.",
                    "eventType": "agreement",
                    "phase": "pre_litigation",
                    "sourceQuote": "The agreement was executed on 15 January 2019 at Pune.",
                },
                {
                    "date": "2018-01-01",
                    "title": "Secret meeting in Goa",
                    "particulars": "The parties met privately in Goa.",
                    "eventType": "communication",
                    "phase": "pre_litigation",
                    "sourceQuote": "the parties secretly met in Goa",
                },
            ]
        }
        events = extract_grounded_events(payload, source_text=SOURCE, document_name="plaint.pdf")
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].date_key, "2019-01-15")
        self.assertEqual(events[0].title, "Agreement executed")

    def test_drops_event_without_quote(self) -> None:
        payload = {
            "events": [
                {
                    "date": "2019-01-15",
                    "title": "Agreement executed",
                    "particulars": "The agreement was executed at Pune.",
                    "eventType": "agreement",
                    "sourceQuote": "",
                }
            ]
        }
        events = extract_grounded_events(payload, source_text=SOURCE, document_name="plaint.pdf")
        self.assertEqual(events, [])


class MergeUniqueDateTests(unittest.TestCase):
    def test_same_date_appears_once_with_combined_summary(self) -> None:
        first = _event()
        second = _event(
            title="Possession handed over",
            particulars="Possession of the premises was handed over the same day.",
            event_type="other",
        )
        tree = merge_events(None, [first, second])
        self.assertEqual(len(tree.dates), 1)
        self.assertEqual(tree.dates[0].date, "2019-01-15")
        self.assertEqual(len(tree.dates[0].events), 2)
        self.assertIn("executed", tree.dates[0].summary.lower())
        self.assertIn("possession", tree.dates[0].summary.lower())

    def test_duplicate_title_on_same_date_is_ignored(self) -> None:
        tree = merge_events(None, [_event(), _event()])
        self.assertEqual(len(tree.dates), 1)
        self.assertEqual(len(tree.dates[0].events), 1)

    def test_phase_tree_groups_dates(self) -> None:
        filing = _event(
            date_key="2021-01-10",
            display_date="10 Jan 2021",
            title="Suit filed",
            particulars="The suit was instituted.",
            event_type="filing",
            phase="institution",
        )
        tree = merge_events(None, [_event(), filing])
        phase_ids = [node.id for node in tree.phases]
        self.assertEqual(phase_ids, ["pre_litigation", "institution"])
        self.assertEqual(tree.dates[0].date, "2019-01-15")
        self.assertEqual(tree.dates[1].date, "2021-01-10")


if __name__ == "__main__":
    unittest.main()
