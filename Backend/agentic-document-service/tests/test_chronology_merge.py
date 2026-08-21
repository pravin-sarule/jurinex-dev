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


def _event(**kwargs: object) -> GroundedEvent:
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
        "forum": "",
        "case_number": "",
        "source_page": "",
        "exhibit": "",
        "source_role": "",
        "disputed": False,
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

    def test_keeps_year_only_procedural_event(self) -> None:
        source = (
            "In 2014 the dispute was transferred from Co-op Court Aurangabad "
            "to Co-op Court Latur and numbered CCB 230/2014."
        )
        payload = {
            "events": [
                {
                    "date": "2014",
                    "title": "Dispute transferred to Latur",
                    "particulars": "Dispute 88/2012 was transferred to Co-op Court Latur and numbered CCB 230/2014. Exact day is not on record.",
                    "eventType": "transfer",
                    "phase": "institution",
                    "forum": "Co-op Court Latur",
                    "caseNumber": "CCB 230/2014",
                    "sourcePage": "11",
                    "exhibit": "",
                    "sourceRole": "court",
                    "disputed": False,
                    "sourceQuote": "the dispute was transferred from Co-op Court Aurangabad to Co-op Court Latur and numbered CCB 230/2014",
                }
            ]
        }
        events = extract_grounded_events(payload, source_text=source, document_name="writ.pdf")
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].date_key, "2014")
        self.assertEqual(events[0].precision, "year")
        self.assertEqual(events[0].forum, "Co-op Court Latur")
        self.assertEqual(events[0].case_number, "CCB 230/2014")
        self.assertEqual(events[0].source_page, "11")
        self.assertEqual(events[0].source_role, "court")

    def test_letter_maps_to_correspondence_phase(self) -> None:
        source = "The bank's reply letter dated 01 March 2012 denied liability for the insurance."
        payload = {
            "events": [
                {
                    "date": "01/03/2012",
                    "title": "Bank reply denying insurance liability",
                    "particulars": "The bank wrote to the borrower denying liability.",
                    "eventType": "communication",
                    "phase": "correspondence",
                    "forum": "",
                    "caseNumber": "",
                    "sourcePage": "33",
                    "exhibit": "",
                    "sourceRole": "respondent",
                    "disputed": False,
                    "sourceQuote": "The bank's reply letter dated 01 March 2012 denied liability",
                }
            ]
        }
        events = extract_grounded_events(payload, source_text=source, document_name="writ.pdf")
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].phase, "correspondence")
        self.assertEqual(events[0].event_type, "communication")

    def test_communication_tagged_pleadings_is_reclassified(self) -> None:
        source = "The bank's reply letter dated 01 March 2012 denied liability for the insurance."
        payload = {
            "events": [
                {
                    "date": "01/03/2012",
                    "title": "Bank reply denying insurance liability",
                    "particulars": "The bank wrote to the borrower denying liability.",
                    "eventType": "communication",
                    "phase": "pleadings",
                    "sourceQuote": "The bank's reply letter dated 01 March 2012 denied liability",
                }
            ]
        }
        events = extract_grounded_events(payload, source_text=source, document_name="writ.pdf")
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].phase, "correspondence")

    def test_gazette_is_official_record_not_admitted(self) -> None:
        source = (
            "The declaration was published in the Official Gazette on 15.12.2017 "
            "pursuant to Resolution No. 1850 dated 24.07.2017."
        )
        payload = {
            "events": [
                {
                    "date": "15/12/2017",
                    "title": "Declaration published in Official Gazette",
                    "particulars": "The declaration was published in the Official Gazette.",
                    "eventType": "notice",
                    "phase": "pre_litigation",
                    "sourceRole": "admitted",
                    "sourceQuote": "published in the Official Gazette on 15.12.2017",
                }
            ]
        }
        events = extract_grounded_events(payload, source_text=source, document_name="wp.pdf")
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].source_role, "official")

    def test_section_31_notification_is_impugned_not_court_finding(self) -> None:
        source = (
            "The State Government issued the impugned notification dated 15.04.2025 "
            "under Section 31(1) of the MRTP Act sanctioning the modified Draft Development Plan."
        )
        payload = {
            "events": [
                {
                    "date": "15/04/2025",
                    "title": "Government notification under Section 31(1)",
                    "particulars": "The notification is challenged in this writ petition.",
                    "eventType": "order",
                    "phase": "order",
                    "sourceRole": "court",
                    "disputed": True,
                    "sourceQuote": "impugned notification dated 15.04.2025 under Section 31(1)",
                }
            ]
        }
        events = extract_grounded_events(payload, source_text=source, document_name="wp.pdf")
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].source_role, "impugned")

    def test_verification_is_not_treated_as_filing(self) -> None:
        source = (
            "I, Mirza Ashraf Ali Baig, do hereby solemnly affirm and verify "
            "that the contents of this petition are true. DATE: 26.05.2025."
        )
        payload = {
            "events": [
                {
                    "date": "26/05/2025",
                    "title": "Verified and Filed",
                    "particulars": "The writ petition was verified and filed.",
                    "eventType": "filing",
                    "phase": "institution",
                    "sourceRole": "petitioner",
                    "sourceQuote": "solemnly affirm and verify that the contents of this petition are true. DATE: 26.05.2025",
                }
            ]
        }
        events = extract_grounded_events(payload, source_text=source, document_name="wp.pdf")
        self.assertEqual(len(events), 1)
        self.assertNotIn("filed", events[0].title.lower())
        self.assertIn("verif", events[0].title.lower())
        self.assertNotEqual(events[0].phase, "institution")


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

    def test_metadata_survives_merge(self) -> None:
        event = _event(
            forum="Co-op Court Aurangabad",
            case_number="Dispute 88/2012",
            source_page="54",
            exhibit="Exh. 5",
            source_role="court",
            disputed=True,
        )
        tree = merge_events(None, [event])
        stored = tree.dates[0].events[0]
        self.assertEqual(stored.forum, "Co-op Court Aurangabad")
        self.assertEqual(stored.caseNumber, "Dispute 88/2012")
        self.assertEqual(stored.sourcePage, "54")
        self.assertEqual(stored.exhibit, "Exh. 5")
        self.assertEqual(stored.sourceRole, "court")
        self.assertTrue(stored.disputed)
        again = merge_events(tree, [])
        self.assertEqual(again.dates[0].events[0].caseNumber, "Dispute 88/2012")


if __name__ == "__main__":
    unittest.main()
