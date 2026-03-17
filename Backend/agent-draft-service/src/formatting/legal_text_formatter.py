"""
LegalTextFormatter: Formats text according to Indian legal document conventions.

Supports:
  * Numbered paragraphs  – facts section style
  * Lettered list        – questions of law, grounds
  * Roman numerals       – prayer / relief section
  * Plain                – no transformation

Usage::

    fmt = LegalTextFormatter()
    text = fmt.format_numbered_paragraphs(raw_facts)
    text = fmt.format_lettered_list(raw_questions)
    text = fmt.format_roman_numerals(raw_prayers)
    text = fmt.format(raw, style="lettered_list")
"""

import re
import textwrap
from typing import List

WRAP_WIDTH = 80
SENTENCES_PER_PARA = 3

ROMAN_MAP = [
    (1000, "m"), (900, "cm"), (500, "d"), (400, "cd"),
    (100, "c"), (90, "xc"), (50, "l"), (40, "xl"),
    (10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i"),
]

STANDARD_CLOSING_PRAYER = (
    "pass such other order(s) as this Hon'ble Court may deem fit and "
    "proper in the facts and circumstances of the case"
)


class LegalTextFormatter:
    """
    Formats text for insertion into Indian legal documents.

    Usage::

        fmt = LegalTextFormatter()
        formatted = fmt.format(raw_text, style="numbered_paragraphs")
    """

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def format_numbered_paragraphs(self, text: str) -> str:
        """
        Split text into numbered paragraphs (facts-section style).

        Groups SENTENCES_PER_PARA sentences per paragraph, numbered
        "1. ", "2. ", with continuation lines indented 3 spaces.
        Lines are wrapped at WRAP_WIDTH characters.

        Example output::

            1. The petitioner, Rajesh Kumar, is a citizen of India
               residing at 123 Main Street, New Delhi.

            2. On 01.01.2024, the respondent issued an order without
               following due process.
        """
        if not text or not text.strip():
            return text

        sentences = self._split_into_sentences(text)
        if not sentences:
            return text

        groups = self._group_sentences(sentences, SENTENCES_PER_PARA)
        paragraphs: List[str] = []

        for i, group in enumerate(groups, start=1):
            para_text = ' '.join(group)
            indented = self._indent_paragraph(
                para_text,
                first_line=f"{i}. ",
                other_lines="   ",
                width=WRAP_WIDTH,
            )
            paragraphs.append(indented)

        return "\n\n".join(paragraphs)

    def format_lettered_list(self, text: str) -> str:
        """
        Format text as lettered list: (a), (b), (c)...

        Splits on sentence boundaries or existing numbered/lettered markers.
        Each item on its own paragraph with proper indentation.

        Example output::

               (a) Whether the action of the respondent violates
                   Article 14 of the Constitution of India?

               (b) Whether the petitioner is entitled to relief?
        """
        if not text or not text.strip():
            return text

        items = self._split_into_items(text)
        letters = "abcdefghijklmnopqrstuvwxyz"
        formatted: List[str] = []

        for i, item in enumerate(items):
            letter = letters[i] if i < len(letters) else str(i + 1)
            indented = self._indent_paragraph(
                item.strip(),
                first_line=f"   ({letter}) ",
                other_lines="       ",
                width=WRAP_WIDTH,
            )
            formatted.append(indented)

        return "\n\n".join(formatted)

    def format_roman_numerals(self, text: str) -> str:
        """
        Format text as roman numeral list: (i), (ii), (iii)...

        Standard format for prayer/relief sections. Appends the standard
        closing prayer if not already present. Each item starts lowercase
        per Indian legal convention.

        Example output::

               (i) issue a writ of mandamus directing the respondent
                   to comply with its statutory duty;

               (ii) pass such other order as this Hon'ble Court may
                    deem fit.
        """
        if not text or not text.strip():
            return text

        items = self._split_into_items(text)

        # Add standard closing prayer if missing
        if not any(STANDARD_CLOSING_PRAYER[:25].lower() in item.lower() for item in items):
            items.append(STANDARD_CLOSING_PRAYER)

        formatted: List[str] = []
        for i, item in enumerate(items, start=1):
            roman = self._to_roman(i)
            item_text = item.strip()
            # Ensure items start lowercase (Indian legal convention)
            if item_text and item_text[0].isupper():
                item_text = item_text[0].lower() + item_text[1:]

            indented = self._indent_paragraph(
                item_text,
                first_line=f"   ({roman}) ",
                other_lines=" " * (6 + len(roman)),
                width=WRAP_WIDTH,
            )
            formatted.append(indented)

        return "\n\n".join(formatted)

    def format(self, text: str, style: str) -> str:
        """
        Dispatch to the right formatter based on style string.

        style options:
          'numbered_paragraphs' | 'lettered_list' | 'roman_numerals' | 'plain'
        """
        if style == "numbered_paragraphs":
            return self.format_numbered_paragraphs(text)
        if style == "lettered_list":
            return self.format_lettered_list(text)
        if style == "roman_numerals":
            return self.format_roman_numerals(text)
        return text  # plain or numbered_list: no transformation

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _split_into_sentences(text: str) -> List[str]:
        """Split text into individual sentences, handling common abbreviations."""
        # Temporarily replace dots in abbreviations so they don't trigger splits
        abbrevs = r'\b(Mr|Mrs|Ms|Dr|Sr|Jr|vs|etc|i\.e|e\.g|No|Art|Sec|Govt|Adv)\.'
        text = re.sub(abbrevs + r'\s+', r'\1@@@ ', text)
        raw = re.split(r'(?<=[.!?])\s+', text)
        return [s.replace('@@@', '.').strip() for s in raw if s.strip()]

    @staticmethod
    def _group_sentences(sentences: List[str], size: int) -> List[List[str]]:
        """Group sentences into chunks of `size`."""
        groups: List[List[str]] = []
        for i in range(0, len(sentences), size):
            groups.append(sentences[i:i + size])
        return groups

    @staticmethod
    def _split_into_items(text: str) -> List[str]:
        """
        Split text into discrete items for list formatting.

        Handles:
        * Existing numbered/lettered markers  (1. / (a) / (i))
        * Semicolon-separated clauses
        * Sentence boundaries
        """
        # Already numbered/lettered
        splits = re.split(r'\n\s*(?:\d+\.|[a-z]\)|[ivxlc]+\)|[A-Z]\.)\s+', text)
        if len(splits) > 1:
            return [s.strip() for s in splits if s.strip()]

        # Semicolon-separated
        if ';' in text:
            return [s.strip().rstrip(';') for s in text.split(';') if s.strip()]

        # Sentence boundaries
        raw = re.split(r'(?<=[.!?])\s+', text)
        return [s.strip() for s in raw if s.strip()]

    @staticmethod
    def _indent_paragraph(
        text: str,
        first_line: str,
        other_lines: str,
        width: int = 80,
    ) -> str:
        """Wrap and indent with different first/subsequent line prefixes."""
        return textwrap.fill(
            text,
            width=width,
            initial_indent=first_line,
            subsequent_indent=other_lines,
        )

    @staticmethod
    def _wrap_text(text: str, width: int = 80) -> str:
        """Simple word-wrap helper."""
        return textwrap.fill(text, width=width)

    @staticmethod
    def _to_roman(num: int) -> str:
        """Convert integer to lowercase Roman numeral string."""
        result = ""
        for value, numeral in ROMAN_MAP:
            while num >= value:
                result += numeral
                num -= value
        return result
