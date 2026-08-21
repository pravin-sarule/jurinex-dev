from __future__ import annotations

import unittest

from app.services.chronology.corroborate import corroborate_event, majority_date, index_numeric_dates
from app.services.chronology.dates import parse_date
from app.services.chronology.extract import extract_grounded_events
from app.services.chronology.models import GroundedEvent
from app.services.chronology.pack import pack_for_extraction
from app.services.chronology.pages import pages_for_quote, text_with_page_markers


def _event(**kwargs: object) -> GroundedEvent:
    defaults: dict[str, object] = {
        "date_key": "2012-12-07",
        "display_date": "07 Dec 2012",
        "precision": "day",
        "title": "Expiry of second insurance cover",
        "particulars": "The additional policy expired.",
        "event_type": "other",
        "phase": "pre_litigation",
        "source_document": "writ.pdf",
        "source_quote": "08.12.2009 to 07.12.2012",
        "forum": "",
        "case_number": "",
        "source_page": "",
        "exhibit": "",
        "source_role": "",
        "disputed": False,
    }
    defaults.update(kwargs)
    return GroundedEvent(**defaults)  # type: ignore[arg-type]


class PageMarkerTests(unittest.TestCase):
    def test_stamps_document_ai_pages(self) -> None:
        structured = {
            "pages": [
                {"pageNumber": 1, "text": "Writ petition"},
                {"pageNumber": 100, "text": "Policy 8.12.2009 to 7.12.2010 hypothecated goods."},
            ]
        }
        text = text_with_page_markers(structured)
        self.assertIn("[PAGE 1]", text)
        self.assertIn("[PAGE 100]", text)
        self.assertEqual(
            pages_for_quote("Policy 8.12.2009 to 7.12.2010 hypothecated goods.", text),
            "100",
        )

    def test_extract_fills_page_from_stamp_not_model(self) -> None:
        source = (
            "[PAGE 54]\n"
            "The dispute was received and registered on 20.02.2012 before the Co-op Court.\n"
        )
        payload = {
            "events": [
                {
                    "date": "20/02/2012",
                    "title": "Dispute registered",
                    "particulars": "The dispute was received and registered.",
                    "eventType": "filing",
                    "phase": "institution",
                    "sourcePage": "999",
                    "sourceQuote": "received and registered on 20.02.2012 before the Co-op Court",
                }
            ]
        }
        events = extract_grounded_events(payload, source_text=source, document_name="writ.pdf")
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].source_page, "54")


class PackTests(unittest.TestCase):
    def test_late_dated_page_survives_small_budget(self) -> None:
        pages = []
        for index in range(1, 21):
            body = ("lorem ipsum dolor sit amet " * 80) + f" filler page {index}"
            if index == 19:
                body = (
                    "Appeal No. 9 of 2016 was received and registered on 01.02.2016 "
                    "before the Maharashtra State Co-op Appellate Court."
                )
            pages.append(f"[PAGE {index}]\n{body}")
        source = "\n\n".join(pages)
        packed, meta = pack_for_extraction(source, budget=8_000)
        self.assertTrue(meta["packed"])
        self.assertIn("01.02.2016", packed)
        self.assertIn("[PAGE 19]", packed)

    def test_flat_text_keeps_tail_date_window(self) -> None:
        head = ("alpha beta gamma delta " * 400) + " start of paper book "
        tail = " Crime No. 4/2011 was registered on 23.04.2011 at Beed Rural Police Station."
        source = head + ("padding text without dates " * 200) + tail
        packed, meta = pack_for_extraction(source, budget=6_000)
        self.assertTrue(meta["packed"])
        self.assertIn("23.04.2011", packed)


class CorroborationTests(unittest.TestCase):
    SOURCE = """
[PAGE 31]
The second policy was 08.12.2009 to 07.12.2010 covering hypothecated goods.

[PAGE 55]
Additional cover 8.12.2009 to 7.12.2010 on the hypothecated goods.

[PAGE 61]
OCR defect line 08.12.2009 to 07.12.2012 covering hypothecated goods.

[PAGE 70]
A stray OCR line reads 07.12.2017 and is not repeated.

[PAGE 100]
Policy period 8.12.2009 to 7.12.2010 hypothecated goods confirmed.
"""

    def test_minority_year_loses_to_majority(self) -> None:
        parsed = parse_date("07.12.2012")
        assert parsed is not None
        voted = majority_date(parsed, index_numeric_dates(self.SOURCE))
        self.assertEqual(voted.key, "2010-12-07")

    def test_quote_replaced_with_majority_span(self) -> None:
        event = corroborate_event(_event(), self.SOURCE)
        self.assertEqual(event.date_key, "2010-12-07")
        self.assertIn("2010", event.source_quote)
        self.assertNotIn("2012", event.source_quote)

    def test_extract_applies_vote_and_page(self) -> None:
        payload = {
            "events": [
                {
                    "date": "07/12/2012",
                    "title": "Expiry of second insurance cover",
                    "particulars": "The additional Rs. 20 lakh policy expired.",
                    "eventType": "other",
                    "phase": "pre_litigation",
                    "sourceQuote": "08.12.2009 to 07.12.2012",
                }
            ]
        }
        events = extract_grounded_events(
            payload,
            source_text=self.SOURCE,
            document_name="writ.pdf",
        )
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].date_key, "2010-12-07")
        self.assertTrue(events[0].source_page)
        self.assertNotIn("61", events[0].source_page.split(", "))
        self.assertNotIn("2012", events[0].source_quote)

    def test_refresh_rewrites_stored_tree(self) -> None:
        from app.schemas.chronology import ChronologyDateNode, ChronologyEvent, ChronologyTree
        from app.services.chronology.extract import refresh_tree_against_source

        tree = ChronologyTree(
            dates=[
                ChronologyDateNode(
                    date="2012-12-07",
                    displayDate="07 Dec 2012",
                    precision="day",
                    phase="pre_litigation",
                    events=[
                        ChronologyEvent(
                            title="Expiry of second insurance cover",
                            particulars="The additional policy expired.",
                            sourceQuote="08.12.2009 to 07.12.2012",
                        )
                    ],
                )
            ],
            eventCount=1,
        )
        refreshed = refresh_tree_against_source(tree, self.SOURCE)
        self.assertEqual(refreshed.dates[0].date, "2010-12-07")
        self.assertTrue(refreshed.dates[0].events[0].sourcePage)


class LandUnitAndPendingTests(unittest.TestCase):
    SOURCE = (
        "The Development Plan of 2001 was sanctioned by order dated 18.04.2001 "
        "under section 31 of the MRTP Act. Joint measurement dated 26.12.2018 "
        "recorded 39 R + 30 R = 69 R affected by the 18 metre road. "
        "W.P. No. 553/2024. We have perused the order dated 16.01.2024. "
        "Modifications were published in the Official Gazette on 22.02.2024."
    )

    def test_rewrites_decimal_ares_when_source_has_whole_ares(self) -> None:
        payload = {
            "events": [
                {
                    "date": "26/12/2018",
                    "title": "Joint measurement of 0.69 R",
                    "particulars": "The affected area was recorded as 0.69 R.",
                    "eventType": "other",
                    "phase": "pre_litigation",
                    "sourceQuote": "recorded 39 R + 30 R = 69 R affected by the 18 metre road",
                }
            ]
        }
        events = extract_grounded_events(
            payload, source_text=self.SOURCE, document_name="wp.pdf"
        )
        self.assertEqual(len(events), 1)
        self.assertIn("69 R", events[0].title)
        self.assertNotIn("0.69 R", events[0].title)
        self.assertIn("69 R", events[0].particulars)
        self.assertNotIn("0.69 R", events[0].particulars)
        self.assertIn("69 R", events[0].source_quote)

    def test_does_not_rewrite_quote_or_true_decimal_ares(self) -> None:
        source = "Reservation of 0.69 R was recorded on 26.12.2018 in the joint measurement."
        payload = {
            "events": [
                {
                    "date": "26/12/2018",
                    "title": "Reservation of 0.69 R",
                    "particulars": "The affected area was recorded as 0.69 R.",
                    "eventType": "other",
                    "phase": "pre_litigation",
                    "sourceQuote": "Reservation of 0.69 R was recorded on 26.12.2018",
                }
            ]
        }
        events = extract_grounded_events(payload, source_text=source, document_name="wp.pdf")
        self.assertEqual(len(events), 1)
        self.assertIn("0.69 R", events[0].particulars)

    def test_pre_litigation_after_writ_order_becomes_pending(self) -> None:
        payload = {
            "events": [
                {
                    "date": "26/12/2018",
                    "title": "Joint measurement",
                    "particulars": "The affected area was recorded as 69 R.",
                    "eventType": "other",
                    "phase": "pre_litigation",
                    "sourceQuote": "Joint measurement dated 26.12.2018 recorded 39 R + 30 R = 69 R",
                },
                {
                    "date": "22/02/2024",
                    "title": "Modifications published in Official Gazette",
                    "particulars": "The modifications were published inviting objections.",
                    "eventType": "notice",
                    "phase": "pre_litigation",
                    "sourceQuote": "published in the Official Gazette on 22.02.2024",
                },
            ]
        }
        events = extract_grounded_events(
            payload, source_text=self.SOURCE, document_name="wp.pdf"
        )
        by_date = {event.date_key: event for event in events}
        self.assertEqual(by_date["2018-12-26"].phase, "pre_litigation")
        self.assertEqual(by_date["2024-02-22"].phase, "pending")

    def test_refresh_rewrites_units_and_pending_phase(self) -> None:
        from app.schemas.chronology import ChronologyDateNode, ChronologyEvent, ChronologyTree
        from app.services.chronology.extract import refresh_tree_against_source

        tree = ChronologyTree(
            dates=[
                ChronologyDateNode(
                    date="2024-02-22",
                    displayDate="22 Feb 2024",
                    precision="day",
                    phase="pre_litigation",
                    events=[
                        ChronologyEvent(
                            title="Gazette publication",
                            particulars="Modifications covering 0.69 R were published.",
                            sourceQuote="published in the Official Gazette on 22.02.2024",
                        )
                    ],
                )
            ],
            eventCount=1,
        )
        refreshed = refresh_tree_against_source(tree, self.SOURCE)
        self.assertEqual(refreshed.dates[0].phase, "pending")
        self.assertIn("69 R", refreshed.dates[0].events[0].particulars)
        self.assertNotIn("0.69 R", refreshed.dates[0].events[0].particulars)

    def test_dp_sanction_order_dated_is_not_writ_start(self) -> None:
        source = (
            "The Development Plan of 2001 was sanctioned by order dated 18.04.2001 "
            "under section 31. Joint measurement dated 26.12.2018 recorded 69 R."
        )
        payload = {
            "events": [
                {
                    "date": "26/12/2018",
                    "title": "Joint measurement",
                    "particulars": "The affected area was recorded as 69 R.",
                    "eventType": "other",
                    "phase": "pre_litigation",
                    "sourceQuote": "Joint measurement dated 26.12.2018 recorded 69 R",
                }
            ]
        }
        events = extract_grounded_events(payload, source_text=source, document_name="wp.pdf")
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].phase, "pre_litigation")

    def test_prompt_requires_split_gazette_and_listed_representations(self) -> None:
        from app.services.chronology.prompt import CHRONOLOGY_EXTRACTION_BLOCK

        text = CHRONOLOGY_EXTRACTION_BLOCK.lower()
        self.assertIn("10.08.2022", text)
        self.assertIn("corrigendum", text)
        self.assertIn("02.02.2024", text)
        self.assertIn("one event per date", text)
        self.assertIn("we have perused the order dated", text)
        self.assertIn('"pending"', CHRONOLOGY_EXTRACTION_BLOCK)
        self.assertIn("0.69 r", text)


if __name__ == "__main__":
    unittest.main()
