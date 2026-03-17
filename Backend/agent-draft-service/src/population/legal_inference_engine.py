"""
LegalInferenceEngine: Uses legal domain knowledge to infer missing field
values in Writ Petitions without calling an LLM.

All public methods return PopulationResult.  Use result.is_confident() to
decide whether to accept the value or fall through to the next stage.
"""

import re
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional, Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Domain knowledge bases
# ---------------------------------------------------------------------------

WRIT_TO_ARTICLE: Dict[str, str] = {
    "MANDAMUS": "32",
    "CERTIORARI": "32",
    "PROHIBITION": "32",
    "QUO WARRANTO": "32",
    "HABEAS CORPUS": "32",
    # High Court writs
    "HC_MANDAMUS": "226",
    "HC_CERTIORARI": "226",
    "HC_PROHIBITION": "226",
    "HC_QUO_WARRANTO": "226",
    "HC_HABEAS_CORPUS": "226",
}

COURT_TO_ARTICLE: Dict[str, str] = {
    "SUPREME COURT OF INDIA": "32",
    "SUPREME COURT": "32",
    "HIGH COURT": "226",
    "DELHI HIGH COURT": "226",
    "BOMBAY HIGH COURT": "226",
    "MADRAS HIGH COURT": "226",
    "CALCUTTA HIGH COURT": "226",
    "ALLAHABAD HIGH COURT": "226",
    "KERALA HIGH COURT": "226",
    "GUJARAT HIGH COURT": "226",
}

ARTICLE_TO_COURT: Dict[str, str] = {
    "32": "SUPREME COURT OF INDIA",
    "226": "HIGH COURT",
}

RELIEF_TEMPLATES: Dict[str, List[str]] = {
    "MANDAMUS": [
        "issue a writ of mandamus directing the respondent(s) to comply with their statutory duty",
        "issue a writ of mandamus or any other appropriate writ, order or direction commanding the respondent(s) to perform their legal obligation",
        "restrain the respondent(s) from giving effect to the impugned order",
    ],
    "CERTIORARI": [
        "issue a writ of certiorari quashing the impugned order/decision",
        "issue a writ of certiorari and/or any other writ calling for the records of the case and quash the same",
    ],
    "PROHIBITION": [
        "issue a writ of prohibition restraining the respondent(s) from proceeding further",
        "issue a writ of prohibition directing the respondent(s) to refrain from acting without jurisdiction",
    ],
    "QUO WARRANTO": [
        "issue a writ of quo warranto calling upon the respondent to show cause by what authority they hold the said office",
    ],
    "HABEAS CORPUS": [
        "issue a writ of habeas corpus directing the respondent(s) to produce the body of the detainee",
        "issue a writ of habeas corpus and set at liberty the person who is illegally detained",
    ],
}

STANDARD_QUESTION_TEMPLATES: List[str] = [
    "Whether the action of the respondent(s) violates Article {article} of the Constitution of India?",
    "Whether the petitioner is entitled to the relief as prayed for?",
    "Whether the impugned order/action is arbitrary, illegal and without jurisdiction?",
    "Whether the respondent(s) have acted in violation of the fundamental rights of the petitioner?",
    "Whether the respondent(s) are bound to follow due process before taking adverse action against the petitioner?",
]

RESPONDENT_PATTERNS: List[str] = [
    r'State\s+of\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*',
    r'Union\s+of\s+India',
    r'Government\s+of\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*',
    r'Ministry\s+of\s+[A-Za-z\s]+',
    r'(?:Commissioner|Director(?:\s+General)?|Secretary)\s+(?:of\s+)?[A-Za-z\s]+',
    r'the\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+Authority',
    r'National\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Board|Commission|Council|Authority)',
]


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------

@dataclass
class PopulationResult:
    """Holds a single field's population result."""
    value: str
    source: str
    confidence: float
    metadata: Dict[str, Any] = field(default_factory=dict)

    def is_confident(self, threshold: float = 0.70) -> bool:
        """Return True if confidence meets or exceeds threshold."""
        return self.confidence >= threshold


# ---------------------------------------------------------------------------
# LegalInferenceEngine
# ---------------------------------------------------------------------------

class LegalInferenceEngine:
    """
    Rule-based inference engine for Writ Petition field values.

    Usage::

        engine = LegalInferenceEngine()
        result = engine.infer_article_from_writ("MANDAMUS")
        # result.value == "32", result.confidence == 1.0

        result = engine.generate_relief_from_writ("MANDAMUS")
        # result.value == "(i) issue a writ of mandamus..."
    """

    # ------------------------------------------------------------------
    # Article inference
    # ------------------------------------------------------------------

    def infer_article_from_writ(self, writ_type: str) -> PopulationResult:
        """
        Map writ type → constitutional article number.

        MANDAMUS/CERTIORARI/PROHIBITION/QUO WARRANTO/HABEAS CORPUS → 32 (SC)
        HC_* variants → 226 (High Court)
        """
        writ_upper = writ_type.upper().strip()
        article = WRIT_TO_ARTICLE.get(writ_upper)
        if article:
            return PopulationResult(
                value=article,
                source="writ_to_article_map",
                confidence=1.0,
                metadata={"writ_type": writ_upper},
            )
        logger.warning("Unknown writ type: %s; defaulting to Article 32", writ_type)
        return PopulationResult(
            value="32",
            source="default_fallback",
            confidence=0.5,
            metadata={"writ_type": writ_upper, "reason": "unknown_writ"},
        )

    def infer_court_from_article(self, article: str) -> PopulationResult:
        """Infer court name from constitutional article number."""
        court = ARTICLE_TO_COURT.get(str(article).strip())
        if court:
            return PopulationResult(value=court, source="article_to_court_map", confidence=0.95)
        return PopulationResult(
            value="SUPREME COURT OF INDIA",
            source="default",
            confidence=0.5,
        )

    def infer_article_from_court(self, court_name: str) -> PopulationResult:
        """Infer constitutional article from court name."""
        court_upper = court_name.upper()
        for key, article in COURT_TO_ARTICLE.items():
            if key in court_upper:
                return PopulationResult(
                    value=article,
                    source="court_to_article_map",
                    confidence=0.95,
                )
        return PopulationResult(value="32", source="default", confidence=0.5)

    # ------------------------------------------------------------------
    # Question generation
    # ------------------------------------------------------------------

    def generate_questions_from_context(
        self,
        facts: str,
        relief: str,
        articles: Optional[List[str]] = None,
    ) -> PopulationResult:
        """
        Generate Questions of Law from facts, relief, and articles.

        Creates a lettered-list of legal questions using templates, filling
        in the primary constitutional article.
        """
        if articles is None:
            articles = ["14", "19", "21"]

        primary_article = articles[0] if articles else "14"
        questions: List[str] = []

        for template in STANDARD_QUESTION_TEMPLATES:
            questions.append(template.format(article=primary_article))

        # Add article-specific questions for additional articles
        for art in articles[1:]:
            questions.append(
                f"Whether the respondent(s) have violated Article {art} "
                f"of the Constitution of India?"
            )

        # Deduplicate
        seen: set = set()
        unique_questions: List[str] = []
        for q in questions:
            if q not in seen:
                seen.add(q)
                unique_questions.append(q)

        formatted = self._format_as_lettered_list(unique_questions)

        return PopulationResult(
            value=formatted,
            source="template_based_generation",
            confidence=0.80,
            metadata={
                "article_count": len(articles),
                "question_count": len(unique_questions),
            },
        )

    # ------------------------------------------------------------------
    # Relief generation
    # ------------------------------------------------------------------

    def generate_relief_from_writ(
        self,
        writ_type: str,
        context: str = "",
    ) -> PopulationResult:
        """
        Generate prayer/relief text from writ type.

        Returns roman-numeral formatted prayer with primary relief,
        alternative relief, and standard closing items.
        """
        writ_upper = writ_type.upper().strip()
        templates = RELIEF_TEMPLATES.get(writ_upper, RELIEF_TEMPLATES["MANDAMUS"])

        relief_items: List[str] = [templates[0]]
        if len(templates) > 1:
            relief_items.append(templates[1])

        relief_items.append(
            "pass such other order(s) as this Hon'ble Court may deem fit and "
            "proper in the facts and circumstances of the case"
        )
        relief_items.append("award costs of the present petition to the petitioner")

        formatted = self._format_as_roman_numerals(relief_items)

        return PopulationResult(
            value=formatted,
            source="relief_template_generation",
            confidence=0.75,
            metadata={"writ_type": writ_upper, "items": len(relief_items)},
        )

    # ------------------------------------------------------------------
    # Respondent inference
    # ------------------------------------------------------------------

    def infer_respondents_from_facts(self, facts: str) -> PopulationResult:
        """
        Extract respondent entities from the facts narration using regex.

        Returns numbered list: "1. State of Maharashtra\n2. Union of India"
        """
        entities = self._extract_respondent_entities(facts)
        if not entities:
            return PopulationResult(
                value="",
                source="fact_extraction",
                confidence=0.0,
                metadata={"reason": "no_entities_found"},
            )

        numbered = "\n".join(f"{i}. {e}" for i, e in enumerate(entities, start=1))
        conf = min(0.80, 0.55 + len(entities) * 0.05)

        return PopulationResult(
            value=numbered,
            source="regex_respondent_extraction",
            confidence=round(conf, 2),
            metadata={"respondent_count": len(entities)},
        )

    # ------------------------------------------------------------------
    # Date / year helpers
    # ------------------------------------------------------------------

    def generate_petition_number(self, year: Optional[str] = None) -> PopulationResult:
        """Auto-generate a petition number placeholder."""
        yr = year or str(datetime.now().year)
        return PopulationResult(
            value=f"WP(C) ____/{yr}",
            source="auto_generate",
            confidence=0.60,
            metadata={"year": yr},
        )

    def get_current_year(self) -> PopulationResult:
        """Return current year as a string."""
        year = str(datetime.now().year)
        return PopulationResult(value=year, source="current_year", confidence=1.0)

    def get_current_date(self) -> PopulationResult:
        """Return current date in DD.MM.YYYY format."""
        date_str = datetime.now().strftime("%d.%m.%Y")
        return PopulationResult(value=date_str, source="current_date", confidence=1.0)

    # ------------------------------------------------------------------
    # Formatting helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _format_as_lettered_list(items: List[str]) -> str:
        letters = "abcdefghijklmnopqrstuvwxyz"
        lines = []
        for i, item in enumerate(items):
            letter = letters[i] if i < len(letters) else str(i + 1)
            lines.append(f"   ({letter}) {item.strip()}")
        return "\n\n".join(lines)

    @staticmethod
    def _format_as_roman_numerals(items: List[str]) -> str:
        roman_map = [
            (1000, "m"), (900, "cm"), (500, "d"), (400, "cd"),
            (100, "c"), (90, "xc"), (50, "l"), (40, "xl"),
            (10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i"),
        ]

        def to_roman(n: int) -> str:
            result = ""
            for value, numeral in roman_map:
                while n >= value:
                    result += numeral
                    n -= value
            return result

        lines = []
        for i, item in enumerate(items, start=1):
            lines.append(f"   ({to_roman(i)}) {item.strip()}")
        return "\n\n".join(lines)

    # ------------------------------------------------------------------
    # Entity extraction
    # ------------------------------------------------------------------

    def _extract_respondent_entities(self, text: str) -> List[str]:
        entities: List[str] = []
        seen: set = set()

        for pattern_str in RESPONDENT_PATTERNS:
            compiled = re.compile(pattern_str, re.IGNORECASE)
            for match in compiled.finditer(text):
                entity = re.sub(r'\s+', ' ', match.group(0)).strip().rstrip('.,;:')
                entity_lower = entity.lower()
                if entity_lower not in seen and len(entity) > 3:
                    seen.add(entity_lower)
                    entities.append(entity)

        return entities[:10]
