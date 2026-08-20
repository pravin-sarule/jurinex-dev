from __future__ import annotations

import unittest

from app.services.chronology.dates import parse_date
from app.services.chronology.grounding import date_in_source, quote_in_source


class DateParseTests(unittest.TestCase):
    def test_iso_day(self) -> None:
        parsed = parse_date("2019-01-15")
        assert parsed is not None
        self.assertEqual(parsed.key, "2019-01-15")
        self.assertEqual(parsed.precision, "day")
        self.assertEqual(parsed.display, "15 Jan 2019")

    def test_indian_numeric_is_day_first(self) -> None:
        parsed = parse_date("04/03/2024")
        assert parsed is not None
        self.assertEqual(parsed.key, "2024-03-04")

    def test_written_day_month_year(self) -> None:
        parsed = parse_date("15th January 2019")
        assert parsed is not None
        self.assertEqual(parsed.key, "2019-01-15")

    def test_month_year_stays_month_precision(self) -> None:
        parsed = parse_date("Jan 2019")
        assert parsed is not None
        self.assertEqual(parsed.key, "2019-01")
        self.assertEqual(parsed.precision, "month")

    def test_invalid_date_is_rejected(self) -> None:
        self.assertIsNone(parse_date("32/13/2020"))
        self.assertIsNone(parse_date(""))
        self.assertIsNone(parse_date("not a date"))

    def test_same_calendar_day_normalises_to_one_key(self) -> None:
        keys = {
            parse_date("15/01/2019").key,  # type: ignore[union-attr]
            parse_date("15 Jan 2019").key,  # type: ignore[union-attr]
            parse_date("2019-01-15").key,  # type: ignore[union-attr]
            parse_date("January 15, 2019").key,  # type: ignore[union-attr]
        }
        self.assertEqual(keys, {"2019-01-15"})


class GroundingTests(unittest.TestCase):
    SOURCE = (
        "The agreement was executed on 15 January 2019 at Pune. "
        "A demand notice dated 20 June 2020 was issued to the defendant."
    )

    def test_quote_must_appear_in_source(self) -> None:
        self.assertTrue(quote_in_source("agreement was executed on 15 January 2019", self.SOURCE))
        self.assertFalse(quote_in_source("the parties secretly met in Goa in 2018", self.SOURCE))

    def test_date_must_appear_in_source(self) -> None:
        parsed = parse_date("15 January 2019")
        assert parsed is not None
        self.assertTrue(date_in_source(parsed, self.SOURCE))
        invented = parse_date("01 January 2018")
        assert invented is not None
        self.assertFalse(date_in_source(invented, self.SOURCE))


if __name__ == "__main__":
    unittest.main()
