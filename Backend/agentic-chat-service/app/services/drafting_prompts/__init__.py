"""System prompts for the Drafting Mode pipeline — one clean file per agent.

Pipeline stages and their contracts:

    ① ``ANALYSIS_SYSTEM_PROMPT``            — template → structure (never drafts)
    ② ``FACT_EXTRACTION_PROMPT``            — source docs → exhaustive fact inventory
    ②b ``GROUNDED_EXTRACTION_PROMPT``        — source docs → cited field JSON (response_schema)
    ③ ``DRAFTING_SYSTEM_PROMPT``            — section-wise drafter (one section/call)
    ③b ``MONOLITHIC_DRAFTING_SYSTEM_PROMPT`` — one-shot whole-document renderer
    ④ ``GROUNDING_AUDIT_PROMPT``            — draft vs inventory zero-hallucination audit
    ⑤ ``DISCREPANCY_REVIEW_PROMPT``          — adversarial verification pass (report-only)

Every prompt enforces the same closed-world rule: the template is FORMAT
authority only, the source documents / fact inventory are the SOLE content
authority, and missing data becomes blanks or markers — never invented text.
"""
from app.services.drafting_prompts.discrepancy_review_prompt import DISCREPANCY_REVIEW_PROMPT
from app.services.drafting_prompts.fact_extraction_prompt import FACT_EXTRACTION_PROMPT
from app.services.drafting_prompts.grounded_extraction_prompt import GROUNDED_EXTRACTION_PROMPT
from app.services.drafting_prompts.grounding_audit_prompt import GROUNDING_AUDIT_PROMPT
from app.services.drafting_prompts.monolithic_drafting_prompt import (
    MONOLITHIC_DRAFTING_SYSTEM_PROMPT,
)
from app.services.drafting_prompts.sectionwise_drafting_prompt import DRAFTING_SYSTEM_PROMPT
from app.services.drafting_prompts.template_analysis_prompt import ANALYSIS_SYSTEM_PROMPT

__all__ = [
    "ANALYSIS_SYSTEM_PROMPT",
    "DISCREPANCY_REVIEW_PROMPT",
    "DRAFTING_SYSTEM_PROMPT",
    "FACT_EXTRACTION_PROMPT",
    "GROUNDED_EXTRACTION_PROMPT",
    "GROUNDING_AUDIT_PROMPT",
    "MONOLITHIC_DRAFTING_SYSTEM_PROMPT",
]
