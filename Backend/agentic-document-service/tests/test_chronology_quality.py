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
        measured = {event.date_key: event for event in events}["2018-12-26"]
        self.assertIn("69 R", measured.title)
        self.assertNotIn("0.69 R", measured.title)
        self.assertIn("69 R", measured.particulars)
        self.assertNotIn("0.69 R", measured.particulars)
        self.assertIn("69 R", measured.source_quote)

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
        measured = {event.date_key: event for event in events}["2018-12-26"]
        self.assertIn("0.69 R", measured.particulars)

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
        gazette = {node.date: node for node in refreshed.dates}["2024-02-22"]
        self.assertEqual(gazette.phase, "pending")
        self.assertIn("69 R", gazette.events[0].particulars)
        self.assertNotIn("0.69 R", gazette.events[0].particulars)

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
        measured = {event.date_key: event for event in events}["2018-12-26"]
        self.assertEqual(measured.phase, "pre_litigation")

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


class OcrSweepTests(unittest.TestCase):
    """The model's recall drifts between runs; these dates must land every time."""

    SOURCE = """
[PAGE 3]
SYNOPSIS: The Development Plan of 2001 was sanctioned under Section 31 of the MRTP
Act on 18.04.2001, showing an 18 metre road through Survey Nos. 1 and 3 admeasuring
39 R + 30 R = 69 R at Himayat Baug.

[PAGE 21]
By Resolution No. 2648 dated 08.08.2022 the Corporation decided to publish the Draft
Development Plan. The Draft Development Plan was published in the Official Gazette on
10.08.2022 under Section 26(1) of the said Act. A corrigendum dated 25.08.2022 was
thereafter issued.

[PAGE 34]
The modifications were published in the Official Gazette on 23.02.2024 inviting
objections from the public.

[PAGE 47]
The petitioners submitted representations dated 02.02.2024, 09.07.2024 and 29.08.2024
to Respondent No. 4 in respect of the road alignment.

[PAGE 58]
We have perused the order dated 16.01.2024 passed in W.P. No. 553/2024 by which
notices were issued to the respondents.

[PAGE 71]
The State Government issued the impugned notification dated 15.04.2025 under Section
31(1) of the MRTP Act granting part sanction to the Development Plan.
"""

    def _swept(self, known: set[str] | None = None):
        from app.services.chronology.sweep import sweep_events

        return sweep_events(
            self.SOURCE,
            document_name="wp.pdf",
            known_date_keys=known or set(),
        )

    def test_finds_every_statutory_date_the_model_missed(self) -> None:
        keys = {event.date_key for event in self._swept()}
        for expected in (
            "2001-04-18",
            "2022-08-10",
            "2024-01-16",
            "2024-02-02",
            "2024-02-23",
            "2024-07-09",
            "2025-04-15",
        ):
            self.assertIn(expected, keys, f"{expected} was not swept from the OCR")

    def test_swept_events_are_quoted_and_pin_cited(self) -> None:
        from app.services.chronology.grounding import date_in_source, quote_in_source
        from app.services.chronology.dates import parse_date

        for event in self._swept():
            parsed = parse_date(event.date_key)
            assert parsed is not None
            self.assertTrue(quote_in_source(event.source_quote, self.SOURCE), event.title)
            self.assertTrue(date_in_source(parsed, self.SOURCE), event.title)
            self.assertNotIn("[PAGE", event.source_quote)

    def test_impugned_notification_keeps_its_role(self) -> None:
        by_date = {event.date_key: event for event in self._swept()}
        notification = by_date["2025-04-15"]
        self.assertEqual(notification.source_role, "impugned")
        self.assertIn("31", notification.title)

    def test_dates_already_extracted_are_not_duplicated(self) -> None:
        keys = {event.date_key for event in self._swept(known={"2025-04-15", "2024-01-16"})}
        self.assertNotIn("2025-04-15", keys)
        self.assertNotIn("2024-01-16", keys)

    def test_extract_adds_missing_dates_alongside_model_events(self) -> None:
        payload = {
            "events": [
                {
                    "date": "08/08/2022",
                    "title": "Resolution No. 2648 to publish Draft DP",
                    "particulars": "The Corporation resolved to publish the Draft Development Plan.",
                    "eventType": "other",
                    "phase": "pre_litigation",
                    "sourceQuote": "Resolution No. 2648 dated 08.08.2022 the Corporation decided to publish",
                }
            ]
        }
        events = extract_grounded_events(
            payload, source_text=self.SOURCE, document_name="wp.pdf"
        )
        keys = {event.date_key for event in events}
        self.assertIn("2022-08-08", keys)
        self.assertIn("2025-04-15", keys)
        self.assertIn("2001-04-18", keys)
        self.assertIn("2024-01-16", keys)

    def test_refresh_adds_missing_dates_without_an_llm_call(self) -> None:
        from app.schemas.chronology import ChronologyDateNode, ChronologyEvent, ChronologyTree
        from app.services.chronology.extract import refresh_tree_against_source

        tree = ChronologyTree(
            dates=[
                ChronologyDateNode(
                    date="2022-08-08",
                    displayDate="08 Aug 2022",
                    precision="day",
                    phase="pre_litigation",
                    events=[
                        ChronologyEvent(
                            title="Resolution No. 2648 to publish Draft DP",
                            particulars="The Corporation resolved to publish the Draft DP.",
                            sourceQuote="Resolution No. 2648 dated 08.08.2022 the Corporation decided to publish",
                        )
                    ],
                )
            ],
            sourceDocuments=["wp.pdf"],
            eventCount=1,
        )
        refreshed = refresh_tree_against_source(tree, self.SOURCE)
        keys = {node.date for node in refreshed.dates}
        self.assertIn("2025-04-15", keys)
        self.assertIn("2022-08-10", keys)


class WordingCorrectionTests(unittest.TestCase):
    SOURCE = (
        "The land admeasuring 69 R at Himayat Baug was affected. "
        "The matter is stood over to 11.11.2024 for further consideration. "
        "I solemnly affirm and verify that the contents of this petition are true. "
        "DATE: 26.05.2025."
    )

    def test_place_name_absent_from_ocr_is_replaced_with_the_ocr_form(self) -> None:
        from app.services.chronology.extract import correct_place_names

        fixed = correct_place_names("69 R land at Himayatnagar", self.SOURCE)
        self.assertIn("Himayat Baug", fixed)
        self.assertNotIn("Himayatnagar", fixed)

    def test_place_name_present_in_ocr_is_left_alone(self) -> None:
        from app.services.chronology.extract import correct_place_names

        source = "The property at Ahmednagar was surveyed."
        self.assertEqual(
            correct_place_names("Property at Ahmednagar", source),
            "Property at Ahmednagar",
        )

    def test_stand_over_is_not_reported_as_a_hearing(self) -> None:
        payload = {
            "events": [
                {
                    "date": "11/11/2024",
                    "title": "Hearing before the High Court",
                    "particulars": "The matter was taken up.",
                    "eventType": "hearing",
                    "phase": "hearing",
                    "sourceQuote": "The matter is stood over to 11.11.2024 for further consideration",
                }
            ]
        }
        events = extract_grounded_events(payload, source_text=self.SOURCE, document_name="wp.pdf")
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].phase, "listing")
        self.assertIn("stand-over", events[0].title.lower())

    def test_verification_is_not_institution_even_without_filed_in_title(self) -> None:
        payload = {
            "events": [
                {
                    "date": "26/05/2025",
                    "title": "Writ petition verified",
                    "particulars": "The petition was verified by the petitioner.",
                    "eventType": "filing",
                    "phase": "institution",
                    "sourceQuote": "solemnly affirm and verify that the contents of this petition are true. DATE: 26.05.2025",
                }
            ]
        }
        events = extract_grounded_events(payload, source_text=self.SOURCE, document_name="wp.pdf")
        self.assertEqual(len(events), 1)
        self.assertNotEqual(events[0].phase, "institution")


if __name__ == "__main__":
    unittest.main()
