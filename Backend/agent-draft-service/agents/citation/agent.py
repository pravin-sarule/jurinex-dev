"""
Citation Agent (ADK-style): Add formal legal citations to drafted content.

The Citation Agent receives drafted HTML content from the Drafter agent and:
1. Identifies factual claims, legal arguments, and precedents requiring citation
2. Matches claims to source chunks (using existing Librarian context or querying Librarian)
3. Generates footnotes in Bluebook/Indian legal citation format
4. Inserts <sup>N</sup> markers in HTML content
5. Returns content with citations for Critic validation
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List

from agents.citation.tools import (
    extract_claims_needing_citation,
    match_claims_to_sources,
    format_citations_html
)
from agents.citation.legal_citation_validator import (
    CitationValidator,
    validate_all_citations
)

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-flash-lite-latest"

def run_citation_agent(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Run the Citation agent: add formal citations to drafted content.

    Payload (from orchestrator):
      - draft_id: UUID (optional)
      - section_key: str
      - content_html: str (from Drafter)
      - rag_context: str (context used by Drafter, has [Source: filename] markers)
      - chunks: list (full chunk metadata from Librarian)
      - field_values: dict (optional)
      - user_id: int
      - file_ids: list[str] (optional)

    Returns (to orchestrator):
      - content_html: str (with <sup>N</sup> markers and footnotes)
      - citations: list[dict] (structured citation metadata)
      - citation_count: int
      - metadata: dict
    """
    draft_id = payload.get("draft_id")
    section_key = payload.get("section_key", "unknown")
    content_html = payload.get("content_html", "")
    rag_context = payload.get("rag_context", "")
    chunks = payload.get("chunks", [])
    user_id = payload.get("user_id")
    file_ids = payload.get("file_ids", [])

    if not content_html:
        logger.info("Citation: No content provided, returning empty result")
        return {
            "content_html": "",
            "citations": [],
            "citation_count": 0,
            "confidence": 0,
            "sources": [],
            "metadata": {"model": DEFAULT_MODEL, "section_key": section_key, "cited_by_agent": "citation"}
        }

    try:
        logger.info(f"Citation: Processing section '{section_key}' with {len(chunks)} chunks available")

        # Step 1: Extract claims needing citation using Gemini
        claims = extract_claims_needing_citation(
            content_html=content_html,
            section_key=section_key,
            model=DEFAULT_MODEL
        )
        logger.info(f"Citation: Identified {len(claims)} claims needing citation")

        # Step 2: Match claims to source chunks
        citations = match_claims_to_sources(
            claims=claims,
            rag_context=rag_context,
            chunks=chunks,
            user_id=user_id,
            file_ids=file_ids
        )
        logger.info(f"Citation: Matched {len(citations)} citations")

        # Step 3: Validate citations for legal accuracy
        logger.info(f"Citation: Validating {len(citations)} citations for legal accuracy")
        validation_report = validate_all_citations(citations, chunks)
        logger.info(f"Citation: Validation quality: {validation_report.get('overall_quality')}, "
                   f"Errors: {validation_report.get('total_errors')}, "
                   f"Warnings: {validation_report.get('total_warnings')}")

        # Step 4: Generate Table of Authorities
        validator = CitationValidator()
        toa = validator.generate_table_of_authorities(citations, content_html)
        logger.info(f"Citation: Generated Table of Authorities with {toa.get('total_citations')} entries")

        # Step 5: Check citation consistency
        consistency_check = validator.check_citation_consistency(content_html, citations)
        if not consistency_check['is_consistent']:
            logger.warning(f"Citation: Consistency issues found: {len(consistency_check['issues'])} issues")

        # Step 6: Format citations and insert into HTML
        content_with_citations = format_citations_html(
            content_html=content_html,
            citations=citations,
            section_key=section_key,
            model=DEFAULT_MODEL
        )

        # Confidence (0-100): target 90+ when no errors; no lengthy description
        total_errors = validation_report.get("total_errors") or 0
        total_warnings = validation_report.get("total_warnings") or 0
        if total_errors > 0:
            confidence = max(0, 70 - total_errors * 10)
        elif total_warnings > 0:
            confidence = 90
        else:
            confidence = min(100, 92 + (len(citations) > 0) * 3)  # 92-95 when good

        # Sources: unique list of source names only (no lengthy description)
        sources = list(dict.fromkeys(
            (c.get("source_file") or c.get("filename") or "Unknown") for c in citations
        ))

        return {
            "content_html": content_with_citations,
            "citations": citations,
            "citation_count": len(citations),
            "confidence": confidence,
            "sources": sources,
            "metadata": {
                "model": DEFAULT_MODEL,
                "section_key": section_key,
                "cited_by_agent": "citation",
                "confidence": confidence,
                "sources": sources,
            }
        }

    except Exception as e:
        logger.exception("Citation agent failed")
        return {
            "content_html": content_html,
            "citations": [],
            "citation_count": 0,
            "confidence": 0,
            "sources": [],
            "error": str(e),
            "metadata": {"model": DEFAULT_MODEL, "section_key": section_key, "cited_by_agent": "citation", "error": str(e)}
        }
