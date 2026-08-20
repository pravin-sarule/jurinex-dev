"""Parse and normalise dates from Indian legal documents. Day-first (DD/MM/YYYY)."""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

_MONTHS = {
    "january": 1, "jan": 1,
    "february": 2, "feb": 2,
    "march": 3, "mar": 3,
    "april": 4, "apr": 4,
    "may": 5,
    "june": 6, "jun": 6,
    "july": 7, "jul": 7,
    "august": 8, "aug": 8,
    "september": 9, "sep": 9, "sept": 9,
    "october": 10, "oct": 10,
    "november": 11, "nov": 11,
    "december": 12, "dec": 12,
}

_MONTH_NAMES = (
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)
_MONTH_ABBR = (
    "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
)

_ISO = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_ISO_MONTH = re.compile(r"^(\d{4})-(\d{2})$")
_ISO_YEAR = re.compile(r"^(\d{4})$")
_NUMERIC = re.compile(r"^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$")
_DAY_MONTH_YEAR = re.compile(
    r"^(\d{1,2})(?:st|nd|rd|th)?[\s\-]+([A-Za-z]{3,9})[\s,\-]+(\d{4})$",
    re.I,
)
_MONTH_YEAR = re.compile(r"^([A-Za-z]{3,9})[\s,\-]+(\d{4})$", re.I)
_MONTH_DAY_YEAR = re.compile(
    r"^([A-Za-z]{3,9})[\s,]+(\d{1,2})(?:st|nd|rd|th)?[\s,]+(\d{4})$",
    re.I,
)


@dataclass(frozen=True, slots=True)
class ParsedDate:
    key: str
    display: str
    precision: str  # day | month | year
    year: int
    month: int | None = None
    day: int | None = None

    @property
    def sort_tuple(self) -> tuple[int, int, int]:
        return (self.year, self.month or 0, self.day or 0)


def _year(value: int) -> int | None:
    if value < 100:
        value = 2000 + value if value < 50 else 1900 + value
    if 1800 <= value <= 2100:
        return value
    return None


def _valid_day(year: int, month: int, day: int) -> bool:
    try:
        date(year, month, day)
        return True
    except ValueError:
        return False


def parse_date(raw: str | None) -> ParsedDate | None:
    """Parse a date string. Ambiguous numeric dates are treated as DD/MM/YYYY."""
    text = str(raw or "").strip()
    if not text:
        return None
    text = re.sub(r"\s+", " ", text).strip(" .;,:")
    if not text:
        return None

    match = _ISO.fullmatch(text)
    if match:
        year, month, day = int(match.group(1)), int(match.group(2)), int(match.group(3))
        if _valid_day(year, month, day):
            return _day(year, month, day)

    match = _ISO_MONTH.fullmatch(text)
    if match:
        year, month = int(match.group(1)), int(match.group(2))
        if 1 <= month <= 12 and _year(year):
            return _month(year, month)

    match = _ISO_YEAR.fullmatch(text)
    if match:
        year = _year(int(match.group(1)))
        if year:
            return _year_only(year)

    match = _NUMERIC.fullmatch(text)
    if match:
        first, second, year_raw = int(match.group(1)), int(match.group(2)), int(match.group(3))
        year = _year(year_raw)
        if year is None:
            return None
        # Indian legal docs are day-first. If that is invalid, try month-first.
        if 1 <= second <= 12 and _valid_day(year, second, first):
            return _day(year, second, first)
        if 1 <= first <= 12 and _valid_day(year, first, second):
            return _day(year, first, second)
        return None

    match = _DAY_MONTH_YEAR.fullmatch(text)
    if match:
        day = int(match.group(1))
        month = _MONTHS.get(match.group(2).lower())
        year = _year(int(match.group(3)))
        if month and year and _valid_day(year, month, day):
            return _day(year, month, day)

    match = _MONTH_DAY_YEAR.fullmatch(text)
    if match:
        month = _MONTHS.get(match.group(1).lower())
        day = int(match.group(2))
        year = _year(int(match.group(3)))
        if month and year and _valid_day(year, month, day):
            return _day(year, month, day)

    match = _MONTH_YEAR.fullmatch(text)
    if match:
        month = _MONTHS.get(match.group(1).lower())
        year = _year(int(match.group(2)))
        if month and year:
            return _month(year, month)

    return None


def _day(year: int, month: int, day: int) -> ParsedDate:
    return ParsedDate(
        key=f"{year:04d}-{month:02d}-{day:02d}",
        display=f"{day:02d} {_MONTH_ABBR[month]} {year}",
        precision="day",
        year=year,
        month=month,
        day=day,
    )


def _month(year: int, month: int) -> ParsedDate:
    return ParsedDate(
        key=f"{year:04d}-{month:02d}",
        display=f"{_MONTH_ABBR[month]} {year}",
        precision="month",
        year=year,
        month=month,
    )


def _year_only(year: int) -> ParsedDate:
    return ParsedDate(
        key=f"{year:04d}",
        display=str(year),
        precision="year",
        year=year,
    )


def date_variants(parsed: ParsedDate) -> list[str]:
    """Surface forms that should appear in source text if the date is genuine."""
    year = parsed.year
    month = parsed.month
    day = parsed.day
    out: list[str] = [parsed.key, parsed.display]
    if parsed.precision == "day" and month and day:
        name = _MONTH_NAMES[month]
        abbr = _MONTH_ABBR[month]
        out.extend(
            [
                f"{day:02d}/{month:02d}/{year}",
                f"{day}/{month}/{year}",
                f"{day:02d}-{month:02d}-{year}",
                f"{day}-{month}-{year}",
                f"{day:02d}.{month:02d}.{year}",
                f"{day} {name} {year}",
                f"{day:02d} {name} {year}",
                f"{day} {abbr} {year}",
                f"{day:02d} {abbr} {year}",
                f"{name} {day}, {year}",
                f"{abbr} {day}, {year}",
                f"{day:02d}/{month:02d}/{year % 100:02d}",
                f"{day}/{month}/{year % 100:02d}",
            ]
        )
        for suffix in ("st", "nd", "rd", "th"):
            if day in {1, 21, 31} and suffix != "st":
                continue
            if day in {2, 22} and suffix != "nd":
                continue
            if day in {3, 23} and suffix != "rd":
                continue
            if day not in {1, 2, 3, 21, 22, 23, 31} and suffix != "th":
                continue
            out.append(f"{day}{suffix} {name} {year}")
            out.append(f"{day}{suffix} {abbr} {year}")
    elif parsed.precision == "month" and month:
        out.extend(
            [
                f"{_MONTH_NAMES[month]} {year}",
                f"{_MONTH_ABBR[month]} {year}",
                f"{month:02d}/{year}",
                f"{year}-{month:02d}",
            ]
        )
    else:
        out.append(str(year))
    # Deduplicate while preserving order.
    seen: set[str] = set()
    unique: list[str] = []
    for item in out:
        key = item.lower()
        if key not in seen:
            seen.add(key)
            unique.append(item)
    return unique
