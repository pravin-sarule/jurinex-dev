"""
CrossFieldExtractor: Extracts field values from other already-populated
fields rather than the raw case context.

Useful for deriving respondents/petitioner from facts narration, or
copying a value from a related field.
"""

import re
import logging
from typing import Dict, List, Optional, Any

from .legal_inference_engine import PopulationResult

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Patterns
# ---------------------------------------------------------------------------

RESPONDENT_PATTERNS = [
    r'State\s+of\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*',
    r'Union\s+of\s+India',
    r'Government\s+of\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*',
    r'Ministry\s+of\s+[A-Za-z\s]+',
    r'(?:Commissioner|Director(?:\s+General)?|Secretary)\s+(?:of\s+)?[A-Za-z\s]+',
    r'the\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+Authority',
    r'National\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Board|Commission|Council|Authority)',
]

PETITIONER_PATTERNS = [
    r'[Tt]he\s+[Pp]etitioner[,\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4})',
    r'[Pp]etitioner\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4})\s+is',
    r'([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4})[,\s]+the\s+[Pp]etitioner',
    r'[Aa]pplicant\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4})',
    r'[Pp]laintiff\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4})',
]

COMMON_WORDS = {
    "the", "is", "are", "was", "were", "has", "have", "had",
    "that", "this", "which", "who", "whom", "when", "where",
    "petition", "petitioner", "respondent", "court", "high", "supreme",
    "india", "state", "government", "union", "ministry", "department",
    "hon'ble", "honble", "hence", "therefore", "whereas",
}


class CrossFieldExtractor:
    """
    Extracts field values by reading other already-populated fields.

    Usage::

        extractor = CrossFieldExtractor()
        result = extractor.extract_respondents_from_facts(facts_text)
        result = extractor.extract_petitioner_from_facts(facts_text)
        result = extractor.copy_from_field("petitioner_name", populated_fields)
    """

    # ------------------------------------------------------------------
    # Respondent extraction
    # ------------------------------------------------------------------

    def extract_respondents_from_facts(self, facts: str) -> PopulationResult:
        """
        Parse the facts section to identify respondent entities.

        Returns formatted numbered list:
          1. State of Maharashtra
          2. Pension Commissioner, Maharashtra
        """
        entities = self._extract_entities(facts, RESPONDENT_PATTERNS)

        if not entities:
            return PopulationResult(
                value="",
                source="cross_field_respondent_extraction",
                confidence=0.0,
                metadata={"reason": "no_respondents_found_in_facts"},
            )

        numbered = "\n".join(f"{i}. {e}" for i, e in enumerate(entities, start=1))
        conf = min(0.80, 0.55 + len(entities) * 0.05)

        return PopulationResult(
            value=numbered,
            source="cross_field_respondent_extraction",
            confidence=round(conf, 2),
            metadata={"respondent_count": len(entities), "entities": entities},
        )

    # ------------------------------------------------------------------
    # Petitioner extraction
    # ------------------------------------------------------------------

    def extract_petitioner_from_facts(self, facts: str) -> PopulationResult:
        """
        Parse the facts section to identify the petitioner's name.

        Validates the candidate looks like a proper person name.
        """
        for pattern_str in PETITIONER_PATTERNS:
            pattern = re.compile(pattern_str)
            match = pattern.search(facts)
            if match:
                candidate = match.group(1).strip() if match.lastindex else match.group(0).strip()
                if self._validate_name(candidate):
                    return PopulationResult(
                        value=candidate,
                        source="cross_field_petitioner_extraction",
                        confidence=0.85,
                        metadata={"pattern": pattern_str},
                    )

        return PopulationResult(
            value="",
            source="cross_field_petitioner_extraction",
            confidence=0.0,
            metadata={"reason": "no_petitioner_found_in_facts"},
        )

    # ------------------------------------------------------------------
    # Field copying
    # ------------------------------------------------------------------

    def copy_from_field(
        self,
        source_field: str,
        populated_fields: Dict[str, Any],
    ) -> PopulationResult:
        """
        Copy a value from another already-populated field.

        Confidence is 0.95× the original field's confidence (slight penalty
        for being a derived value).
        """
        if source_field not in populated_fields:
            return PopulationResult(
                value="",
                source=f"copy_from_{source_field}",
                confidence=0.0,
                metadata={"reason": f"{source_field}_not_populated"},
            )

        source_data = populated_fields[source_field]
        if isinstance(source_data, dict):
            value = source_data.get("value", "")
            orig_confidence = source_data.get("confidence", 0.80)
        else:
            value = str(source_data)
            orig_confidence = 0.80

        return PopulationResult(
            value=value,
            source=f"copy_from_{source_field}",
            confidence=round(orig_confidence * 0.95, 4),
            metadata={"source_field": source_field},
        )

    # ------------------------------------------------------------------
    # Entity extraction helpers
    # ------------------------------------------------------------------

    def _extract_entities(self, text: str, patterns: List[str]) -> List[str]:
        """Apply multiple regex patterns and deduplicate results."""
        entities: List[str] = []
        seen: set = set()

        for pattern_str in patterns:
            compiled = re.compile(pattern_str, re.IGNORECASE)
            for match in compiled.finditer(text):
                entity = self._clean_entity(match.group(0))
                entity_norm = entity.lower()
                if entity_norm not in seen and len(entity) > 3:
                    seen.add(entity_norm)
                    entities.append(entity)

        return entities

    @staticmethod
    def _validate_name(text: str) -> bool:
        """
        Return True if text looks like a proper person name.

        Rules: 2–6 words, each capitalised, no common words, no digits.
        """
        words = text.split()
        if not (2 <= len(words) <= 6):
            return False
        for word in words:
            if not word[0].isupper():
                return False
            if word.lower() in COMMON_WORDS:
                return False
            if re.search(r'\d', word):
                return False
        return True

    @staticmethod
    def _clean_entity(text: str) -> str:
        """Normalise whitespace and strip trailing punctuation."""
        return re.sub(r'\s+', ' ', text).strip().rstrip('.,;:')
