"""
LLMAutoPopulator: Enhances ComprehensiveAutoPopulator with Claude AI synthesis
for long-text fields (facts, questions, grounds, prayers).

Strategy:
  - Stages 1 & 2 run first (cheap, fast)
  - Stage 2.5: Claude synthesis for long_text fields
  - Stages 3–5 as fallback if LLM is unavailable

Model: claude-sonnet-4-6
Temperature: 0.3 (balance consistency and naturalness)
Max tokens: 2000 per field
"""

import logging
import os
from typing import Dict, List, Optional, Any

try:
    import anthropic
    ANTHROPIC_AVAILABLE = True
except ImportError:
    ANTHROPIC_AVAILABLE = False

from .complete_autopopulator import ComprehensiveAutoPopulator, FieldResult, PopulationResult
from .vector_db_interface import VectorDBInterface

logger = logging.getLogger(__name__)

LLM_MODEL = "claude-sonnet-4-6"
LLM_TEMPERATURE = 0.3
MAX_TOKENS_PER_FIELD = 2000

LONG_TEXT_FIELDS = {
    "facts_of_case", "questions_of_law", "grounds", "prayer_reliefs", "interim_relief"
}

# ---------------------------------------------------------------------------
# Field-specific synthesis prompts
# ---------------------------------------------------------------------------

SYNTHESIS_PROMPTS: Dict[str, str] = {
    "facts_of_case": """You are a senior advocate drafting a Writ Petition in India.
Draft the FACTS section based on the case information provided.

AVAILABLE INFORMATION:
{context}

REQUIREMENTS:
- Use formal legal language in third person ("The petitioner...")
- Present facts in chronological order
- Include specific dates, facts, and legal violations mentioned
- 300-500 words
- Do NOT add a heading; output only the facts text

FORMAT: Numbered paragraphs like:
1. The petitioner, [name], is a citizen of India...

2. On [date], the respondent...

Output ONLY the facts text, no preamble or explanation.""",

    "questions_of_law": """You are a senior advocate drafting a Writ Petition in India.
Generate the QUESTIONS OF LAW section.

AVAILABLE INFORMATION:
{context}

REQUIREMENTS:
- Identify 3-5 precise legal questions arising from the facts
- Reference specific constitutional articles where mentioned
- Each question must be answerable Yes or No
- Formal legal language

FORMAT: Lettered list:
   (a) Whether the action of the respondent(s) violates Article XX?

   (b) Whether...

Output ONLY the questions, no preamble.""",

    "grounds": """You are a senior advocate drafting a Writ Petition in India.
Draft the GROUNDS section (legal arguments supporting the petition).

AVAILABLE INFORMATION:
{context}

REQUIREMENTS:
- 4-6 grounds lettered (a), (b), (c)...
- Each ground is a distinct legal argument
- Reference constitutional provisions, statutes, and principles
- Each ground begins with "That..."
- Formal legal language

FORMAT:
   (a) That the impugned order...

   (b) That the action of the respondent...

Output ONLY the grounds, no preamble.""",

    "prayer_reliefs": """You are a senior advocate drafting a Writ Petition in India.
Draft the PRAYER section listing reliefs sought.

AVAILABLE INFORMATION:
{context}

REQUIREMENTS:
- List 3-5 specific reliefs sought
- Include primary writ relief, alternative relief, and costs
- Each item starts lowercase (Indian legal convention)
- Roman numeral format

FORMAT:
   (i) issue a writ of [type] directing...

   (ii) alternatively...

   (iii) pass such other order...

Output ONLY the prayer items, no preamble.""",

    "interim_relief": """You are a senior advocate drafting a Writ Petition in India.
Draft the INTERIM RELIEF section.

AVAILABLE INFORMATION:
{context}

REQUIREMENTS:
- List 2-3 urgent interim reliefs sought
- Focus on stay of impugned order and status quo
- Each item starts lowercase
- Roman numeral format

FORMAT:
   (i) stay the impugned order dated...

   (ii) maintain status quo...

Output ONLY the interim relief items, no preamble.""",
}


class LLMAutoPopulator(ComprehensiveAutoPopulator):
    """
    LLM-enhanced auto-populator that uses Claude for long-text synthesis.

    Extends ComprehensiveAutoPopulator by inserting a Claude synthesis stage
    (Stage 2.5) between semantic search (Stage 2) and legal inference (Stage 3).
    Only invoked for long_text fields when the LLM client is available.

    Usage::

        vdb = VectorDBInterface(case_context)
        populator = LLMAutoPopulator(vdb, field_schema, anthropic_api_key="sk-ant-...")
        results = populator.populate_all_fields()
    """

    def __init__(
        self,
        vector_db: VectorDBInterface,
        field_schema: List[Dict],
        anthropic_api_key: Optional[str] = None,
    ):
        llm_client = None
        if ANTHROPIC_AVAILABLE:
            key = anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY")
            if key:
                llm_client = anthropic.Anthropic(api_key=key)
                logger.info("LLMAutoPopulator: Claude ready (model=%s)", LLM_MODEL)
            else:
                logger.warning("LLMAutoPopulator: No API key; LLM synthesis disabled")
        else:
            logger.warning("LLMAutoPopulator: anthropic not installed; LLM synthesis disabled")

        super().__init__(vector_db, field_schema, llm_client=llm_client)
        self._llm_cache: Dict[str, str] = {}  # cache_key → response text

    # ------------------------------------------------------------------
    # Override per-field pipeline
    # ------------------------------------------------------------------

    def _populate_field(self, field_id: str, config: Dict) -> FieldResult:
        """Extended pipeline: 1→2→2.5(LLM)→3→4→5."""
        context = {
            "populated_fields": self._populated_fields,
            "facts": self._get_facts_text(),
        }

        # Stage 1: Multi-key vector search
        result = self._stage1_multikey_search(config)
        if result and result.confidence >= 0.70:
            return self._make_field_result(field_id, result, stage=1, config=config)

        # Stage 2: Semantic search
        result = self._stage2_semantic_search(field_id, config)
        if result and result.confidence >= 0.70:
            return self._make_field_result(field_id, result, stage=2, config=config)

        # Stage 2.5: LLM synthesis (long_text fields only)
        if field_id in LONG_TEXT_FIELDS and self.llm_client:
            result = self._synthesize_with_llm(field_id, config, context)
            if result and result.confidence >= 0.70:
                return self._make_field_result(field_id, result, stage=3, config=config)

        # Stage 3: Legal inference
        result = self._stage3_legal_inference(field_id, config, context)
        if result and result.confidence >= 0.70:
            return self._make_field_result(field_id, result, stage=4, config=config)

        # Stage 4: Cross-field
        result = self._stage4_cross_field(field_id, config, context)
        if result and result.confidence >= 0.70:
            return self._make_field_result(field_id, result, stage=5, config=config)

        # Stage 5: Fallbacks
        result = self._stage5_fallbacks(field_id, config, context)
        if result:
            return self._make_field_result(field_id, result, stage=6, config=config)

        return FieldResult(
            field_id=field_id, value="", confidence=0.0,
            stage=0, source="all_stages_failed",
        )

    # ------------------------------------------------------------------
    # LLM synthesis
    # ------------------------------------------------------------------

    def _synthesize_with_llm(
        self,
        field_id: str,
        config: Dict,
        context: Dict,
    ) -> Optional[PopulationResult]:
        """
        Call Claude to synthesise content for a long-text field.

        Gathers context from vector DB + populated fields, fills the
        appropriate prompt template, calls Claude, and returns result.
        Response is cached by (field_id, context_hash).
        """
        prompt_template = SYNTHESIS_PROMPTS.get(field_id)
        if not prompt_template:
            return None

        context_str = self._build_llm_context(field_id)
        cache_key = f"{field_id}:{hash(context_str)}"

        if cache_key in self._llm_cache:
            logger.debug("LLM cache hit for %s", field_id)
            return PopulationResult(
                value=self._llm_cache[cache_key],
                source="llm_cache",
                confidence=0.90,
            )

        prompt = prompt_template.format(context=context_str)

        try:
            message = self.llm_client.messages.create(
                model=LLM_MODEL,
                max_tokens=MAX_TOKENS_PER_FIELD,
                temperature=LLM_TEMPERATURE,
                messages=[{"role": "user", "content": prompt}],
            )
            value = message.content[0].text.strip()
            self._llm_cache[cache_key] = value

            tokens = message.usage.output_tokens if hasattr(message, "usage") else 0
            logger.info("LLM synthesised %s (%d chars, %d tokens)", field_id, len(value), tokens)

            return PopulationResult(
                value=value,
                source=f"llm_synthesis_{LLM_MODEL}",
                confidence=0.90,
                metadata={"tokens": tokens},
            )
        except Exception as exc:
            logger.error("LLM synthesis failed for %s: %s", field_id, exc)
            return None

    def _build_llm_context(self, field_id: str) -> str:
        """Build a context string for the LLM from populated fields + vector DB chunks."""
        lines: List[str] = []

        # Short populated fields
        for fid, result in self._populated_fields.items():
            if result.is_populated and fid != field_id:
                config = self.field_schema.get(fid, {})
                if config.get("field_type") != "long_text":
                    lines.append(f"{fid}: {result.value}")

        # Semantic search chunks
        config = self.field_schema.get(field_id, {})
        keys = config.get("vector_db_keys", [field_id])
        chunks = self.vector_db.semantic_search(keys, top_k=5)
        for chunk in chunks:
            lines.append(f"[from {chunk['source_key']}]: {chunk['text']}")

        return "\n".join(lines) if lines else "No additional context available."
