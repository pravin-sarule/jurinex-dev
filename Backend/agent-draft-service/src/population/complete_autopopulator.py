"""
ComprehensiveAutoPopulator: 5-stage auto-population engine for Writ Petitions.

Stage pipeline for each field:
  1. Multi-key search    – exact/fuzzy search across all vector_db_keys
  2. Semantic search     – word-overlap search (long_text fields only)
  3. Legal inference     – domain knowledge rules
  4. Cross-field         – extract from other populated fields
  5. Fallbacks           – current_date, auto_generate, leave_blank

Fields are processed in dependency order so facts are ready before questions.
"""

import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any, Tuple

from .vector_db_interface import VectorDBInterface
from .legal_inference_engine import LegalInferenceEngine, PopulationResult
from .cross_field_extractor import CrossFieldExtractor
from ..formatting.legal_text_formatter import LegalTextFormatter

logger = logging.getLogger(__name__)

CONFIDENCE_THRESHOLD = 0.70

# Processing order: simple fields before complex; dependencies first
FIELD_PROCESSING_ORDER = [
    "petition_number",
    "year",
    "court_name",
    "petitioner_name",
    "petitioner_address",
    "writ_type",
    "constitutional_article",
    "respondent_name",
    "filing_date",
    "advocate_name",
    "opposite_party_advocate",
    "facts_of_case",
    "questions_of_law",
    "grounds",
    "prayer_reliefs",
    "interim_relief",
]


@dataclass
class FieldResult:
    field_id: str
    value: str
    confidence: float
    stage: int          # 1-5 indicating which stage populated it; 0 = failed
    source: str
    metadata: Dict[str, Any] = field(default_factory=dict)
    formatted_value: str = ""

    @property
    def is_populated(self) -> bool:
        return bool(self.value and self.value.strip())


class ComprehensiveAutoPopulator:
    """
    Main 5-stage field population engine.

    Usage::

        vdb = VectorDBInterface(case_context)
        populator = ComprehensiveAutoPopulator(vdb, field_schema)
        results = populator.populate_all_fields()
        print(f"Rate: {results['metrics']['population_rate']:.1%}")
    """

    def __init__(
        self,
        vector_db: VectorDBInterface,
        field_schema: List[Dict],
        llm_client=None,
    ):
        self.vector_db = vector_db
        self.field_schema: Dict[str, Dict] = {f["field_id"]: f for f in field_schema}
        self.llm_client = llm_client

        self._inference = LegalInferenceEngine()
        self._cross_field = CrossFieldExtractor()
        self._formatter = LegalTextFormatter()
        self._populated_fields: Dict[str, FieldResult] = {}

        logger.info("ComprehensiveAutoPopulator ready (%d fields)", len(self.field_schema))

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------

    def populate_all_fields(self) -> Dict:
        """
        Run 5-stage pipeline for every field in dependency order.

        Returns:
            {
              "populated_fields": {field_id: {...}},
              "empty_fields": [field_id, ...],
              "metrics": {...}
            }
        """
        self._populated_fields = {}

        # Build processing order: explicit order first, then remaining schema fields
        order = [fid for fid in FIELD_PROCESSING_ORDER if fid in self.field_schema]
        remaining = [fid for fid in self.field_schema if fid not in order]
        processing_order = order + remaining

        total = len(self.field_schema)
        populated_count = 0
        high_conf = medium_conf = low_conf = 0
        stage_breakdown: Dict[int, int] = {}

        for field_id in processing_order:
            config = self.field_schema[field_id]
            result = self._populate_field(field_id, config)
            self._populated_fields[field_id] = result

            if result.is_populated:
                populated_count += 1
                if result.confidence >= 0.85:
                    high_conf += 1
                elif result.confidence >= 0.70:
                    medium_conf += 1
                else:
                    low_conf += 1
                stage_breakdown[result.stage] = stage_breakdown.get(result.stage, 0) + 1

        population_rate = populated_count / total if total else 0.0
        logger.info(
            "Population complete: %d/%d (%.1f%%)",
            populated_count, total, population_rate * 100,
        )

        populated = {
            fid: self._result_to_dict(res)
            for fid, res in self._populated_fields.items()
            if res.is_populated
        }
        empty = [
            fid for fid, res in self._populated_fields.items()
            if not res.is_populated
        ]

        return {
            "populated_fields": populated,
            "empty_fields": empty,
            "metrics": {
                "total_fields": total,
                "populated_count": populated_count,
                "empty_count": total - populated_count,
                "population_rate": round(population_rate, 4),
                "confidence_distribution": {
                    "high": high_conf,
                    "medium": medium_conf,
                    "low": low_conf,
                },
                "stage_breakdown": stage_breakdown,
            },
        }

    # ------------------------------------------------------------------
    # Per-field pipeline
    # ------------------------------------------------------------------

    def _populate_field(self, field_id: str, config: Dict) -> FieldResult:
        """Run stages 1–5 until one succeeds or all fail."""
        context = {
            "populated_fields": self._populated_fields,
            "facts": self._get_facts_text(),
        }

        # Stage 1: Multi-key vector search
        result = self._stage1_multikey_search(config)
        if result and result.confidence >= CONFIDENCE_THRESHOLD:
            return self._make_field_result(field_id, result, stage=1, config=config)

        # Stage 2: Semantic search (long_text only)
        result = self._stage2_semantic_search(field_id, config)
        if result and result.confidence >= CONFIDENCE_THRESHOLD:
            return self._make_field_result(field_id, result, stage=2, config=config)

        # Stage 3: Legal inference
        result = self._stage3_legal_inference(field_id, config, context)
        if result and result.confidence >= CONFIDENCE_THRESHOLD:
            return self._make_field_result(field_id, result, stage=3, config=config)

        # Stage 4: Cross-field extraction
        result = self._stage4_cross_field(field_id, config, context)
        if result and result.confidence >= CONFIDENCE_THRESHOLD:
            return self._make_field_result(field_id, result, stage=4, config=config)

        # Stage 5: Fallbacks
        result = self._stage5_fallbacks(field_id, config, context)
        if result and result.value:
            return self._make_field_result(field_id, result, stage=5, config=config)

        return FieldResult(
            field_id=field_id, value="", confidence=0.0,
            stage=0, source="all_stages_failed",
        )

    # ------------------------------------------------------------------
    # Stage 1: Multi-key vector search
    # ------------------------------------------------------------------

    def _stage1_multikey_search(self, config: Dict) -> Optional[PopulationResult]:
        keys = config.get("vector_db_keys", [config.get("field_id", "")])
        best: Optional[Tuple[str, float]] = None

        for key in keys:
            hit = self.vector_db.search(key, threshold=CONFIDENCE_THRESHOLD)
            if hit:
                val, score = hit
                if best is None or score > best[1]:
                    best = (val, score)

        if best:
            return PopulationResult(value=best[0], source="vector_db_search", confidence=best[1])
        return None

    # ------------------------------------------------------------------
    # Stage 2: Semantic search
    # ------------------------------------------------------------------

    def _stage2_semantic_search(self, field_id: str, config: Dict) -> Optional[PopulationResult]:
        if config.get("field_type") != "long_text":
            return None

        keys = config.get("vector_db_keys", [field_id])
        chunks = self.vector_db.semantic_search(keys, top_k=5)
        if not chunks:
            return None

        combined = " ".join(c["text"] for c in chunks[:3])
        avg_relevance = sum(c["relevance"] for c in chunks[:3]) / max(len(chunks[:3]), 1)
        confidence = min(0.82, 0.55 + avg_relevance * 0.3)

        return PopulationResult(
            value=combined,
            source="semantic_search",
            confidence=round(confidence, 4),
            metadata={"chunks_used": len(chunks[:3])},
        )

    # ------------------------------------------------------------------
    # Stage 3: Legal inference
    # ------------------------------------------------------------------

    def _stage3_legal_inference(
        self,
        field_id: str,
        config: Dict,
        context: Dict,
    ) -> Optional[PopulationResult]:
        if field_id == "constitutional_article":
            writ_result = self._populated_fields.get("writ_type")
            if writ_result and writ_result.is_populated:
                return self._inference.infer_article_from_writ(writ_result.value)
            hit = self.vector_db.search("writ_type")
            if hit:
                return self._inference.infer_article_from_writ(hit[0])

        elif field_id == "court_name":
            article_result = self._populated_fields.get("constitutional_article")
            if article_result and article_result.is_populated:
                return self._inference.infer_court_from_article(article_result.value)

        elif field_id == "year":
            return self._inference.get_current_year()

        elif field_id == "filing_date":
            return self._inference.get_current_date()

        elif field_id == "petition_number":
            year_result = self._populated_fields.get("year")
            year = year_result.value if year_result and year_result.is_populated else None
            return self._inference.generate_petition_number(year)

        elif field_id == "questions_of_law":
            facts = context.get("facts", "")
            if facts:
                return self._inference.generate_questions_from_context(
                    facts, "", self._get_articles_list()
                )

        elif field_id == "prayer_reliefs":
            writ_result = self._populated_fields.get("writ_type")
            writ_type = writ_result.value if writ_result and writ_result.is_populated else "MANDAMUS"
            return self._inference.generate_relief_from_writ(writ_type)

        elif field_id == "respondent_name":
            facts = context.get("facts", "")
            if facts:
                return self._inference.infer_respondents_from_facts(facts)

        return None

    # ------------------------------------------------------------------
    # Stage 4: Cross-field extraction
    # ------------------------------------------------------------------

    def _stage4_cross_field(
        self,
        field_id: str,
        config: Dict,
        context: Dict,
    ) -> Optional[PopulationResult]:
        if field_id == "respondent_name":
            facts = context.get("facts", "")
            if facts:
                return self._cross_field.extract_respondents_from_facts(facts)

        elif field_id == "petitioner_name":
            facts = context.get("facts", "")
            if facts:
                return self._cross_field.extract_petitioner_from_facts(facts)

        # Generic copy from related field
        related_field = config.get("copy_from")
        if related_field:
            return self._cross_field.copy_from_field(
                related_field,
                {
                    fid: {"value": r.value, "confidence": r.confidence}
                    for fid, r in self._populated_fields.items()
                },
            )

        return None

    # ------------------------------------------------------------------
    # Stage 5: Fallbacks
    # ------------------------------------------------------------------

    def _stage5_fallbacks(
        self,
        field_id: str,
        config: Dict,
        context: Dict,
    ) -> Optional[PopulationResult]:
        strategies = config.get("fallback_strategies", ["leave_blank"])
        for strategy in strategies:
            result = self._apply_fallback(field_id, strategy)
            if result and result.value:
                return result
        return PopulationResult(value="", source="all_fallbacks_exhausted", confidence=0.0)

    def _apply_fallback(self, field_id: str, strategy: str) -> Optional[PopulationResult]:
        if strategy == "current_date":
            return self._inference.get_current_date()
        if strategy == "current_year":
            return self._inference.get_current_year()
        if strategy == "auto_generate":
            return self._inference.generate_petition_number()
        if strategy == "infer_from_writ":
            writ_result = self._populated_fields.get("writ_type")
            if writ_result and writ_result.is_populated:
                return self._inference.infer_article_from_writ(writ_result.value)
        if strategy == "infer_from_article":
            article_result = self._populated_fields.get("constitutional_article")
            if article_result and article_result.is_populated:
                return self._inference.infer_court_from_article(article_result.value)
        if strategy == "leave_blank":
            return PopulationResult(value="", source="leave_blank", confidence=0.0)
        return None

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _get_facts_text(self) -> str:
        """Get populated facts text if available, otherwise search vector DB."""
        facts_result = self._populated_fields.get("facts_of_case")
        if facts_result and facts_result.is_populated:
            return facts_result.value
        hit = self.vector_db.search("facts_of_case", threshold=0.5)
        return hit[0] if hit else ""

    def _get_articles_list(self) -> List[str]:
        """Get list of constitutional articles to use in question generation."""
        article_result = self._populated_fields.get("constitutional_article")
        if article_result and article_result.is_populated:
            return [article_result.value, "14", "21"]
        return ["14", "19", "21"]

    def _make_field_result(
        self,
        field_id: str,
        pop_result: PopulationResult,
        stage: int,
        config: Dict,
    ) -> FieldResult:
        """Convert PopulationResult to FieldResult with formatting applied."""
        formatting = config.get("formatting", "plain")
        formatted = self._formatter.format(pop_result.value, formatting) if pop_result.value else ""

        return FieldResult(
            field_id=field_id,
            value=pop_result.value,
            confidence=pop_result.confidence,
            stage=stage,
            source=pop_result.source,
            metadata=pop_result.metadata,
            formatted_value=formatted,
        )

    @staticmethod
    def _result_to_dict(result: FieldResult) -> Dict:
        return {
            "value": result.value,
            "formatted_value": result.formatted_value,
            "confidence": result.confidence,
            "stage": result.stage,
            "source": result.source,
            "metadata": result.metadata,
        }
