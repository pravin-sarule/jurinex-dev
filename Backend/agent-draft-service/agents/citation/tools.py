"""Citation Agent Tools - Powered by Gemini."""

from __future__ import annotations

import logging
import os
import re
from typing import Any, Dict, List

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

def extract_claims_needing_citation(
    content_html: str,
    section_key: str,
    model: str = "gemini-flash-lite-latest"
) -> List[Dict[str, str]]:
    """
    Use Gemini to identify factual claims, legal arguments, and precedents
    that require citation.

    Args:
        content_html: The HTML content to analyze
        section_key: The section name (for context)
        model: Gemini model to use

    Returns:
        List of {"claim_text": str, "claim_type": str, "context_snippet": str}
    """
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        logger.warning("No GEMINI_API_KEY found, skipping claim extraction")
        return []

    try:
        client = genai.Client(api_key=api_key)

        prompt = f"""You are a legal citation expert. Analyze the following legal document section and identify statements that require formal citation.

**Section:** {section_key}

**Content (HTML):**
{content_html}

**Task:**
Identify all factual claims, legal arguments, case law references, statutory provisions, and precedents that need citation. For each, extract:
1. claim_text: The exact sentence/phrase requiring citation (keep it concise, 10-20 words max)
2. claim_type: One of [fact, legal_argument, case_law, statute, precedent, evidence]
3. context_snippet: Surrounding 50 characters for context

Return as JSON array:
[
  {{"claim_text": "...", "claim_type": "fact", "context_snippet": "..."}},
  ...
]

**Rules:**
- Ignore generic legal statements (e.g., "The law provides...")
- Focus on specific facts, dates, case names, statutory references
- If a statement already has a source marker like [Source: filename], still include it
- Return ONLY the JSON array, no markdown, no explanations
- Limit to maximum 10 most important claims
"""

        response = client.models.generate_content(
            model=model,
            contents=[prompt],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                thinking_config=types.ThinkingConfig(thinking_budget=0)
            )
        )

        import json
        claims = json.loads(response.text) if response.text else []
        logger.info(f"Extracted {len(claims)} claims from Gemini")
        return claims if isinstance(claims, list) else []

    except Exception as e:
        logger.exception("Failed to extract claims for citation")
        return []


def match_claims_to_sources(
    claims: List[Dict[str, str]],
    rag_context: str,
    chunks: List[Dict[str, Any]],
    user_id: int,
    file_ids: List[str]
) -> List[Dict[str, Any]]:
    """
    Match each claim to its source chunk.

    Strategy:
    1. Check if claim already has [Source: filename] marker in rag_context
    2. If yes, extract citation from existing marker
    3. If no, query Librarian for supporting chunk
    4. Build citation metadata

    Args:
        claims: List of claims needing citation
        rag_context: RAG context with [Source: filename] markers
        chunks: Full chunk metadata from Librarian
        user_id: User ID for Librarian queries
        file_ids: File IDs to restrict search

    Returns:
        List of citation dicts with metadata
    """
    from agents.librarian.agent import run_librarian_agent
    from services.db import get_filenames_by_ids

    citations = []
    citation_number = 1

    # Build file_id → filename map
    all_file_ids = list(set(str(c.get("file_id")) for c in chunks if c.get("file_id")))
    file_map = {}
    if all_file_ids:
        try:
            file_map = get_filenames_by_ids(all_file_ids)
        except Exception as e:
            logger.warning(f"Failed to get filenames: {e}")

    for claim in claims:
        claim_text = claim.get("claim_text", "")
        claim_type = claim.get("claim_type", "fact")

        if not claim_text:
            continue

        # Strategy 1: Check if source marker exists in rag_context near this claim
        # Look for [Source: filename] pattern
        source_pattern = r'\[Source:\s*([^\]]+)\]'
        source_matches = re.findall(source_pattern, rag_context)

        if source_matches and chunks:
            # Try to match to one of the chunks
            source_filename = source_matches[0]  # Use first source
            matching_chunk = None
            for chunk in chunks:
                chunk_file_id = str(chunk.get("file_id"))
                if file_map.get(chunk_file_id) == source_filename:
                    matching_chunk = chunk
                    break

            if matching_chunk:
                citations.append({
                    "citation_number": citation_number,
                    "claim_text": claim_text,
                    "claim_type": claim_type,
                    "source_file": source_filename,
                    "source_file_id": matching_chunk.get("file_id"),
                    "chunk_id": matching_chunk.get("chunk_id"),
                    "page_range": _format_page_range(
                        matching_chunk.get("page_start"),
                        matching_chunk.get("page_end")
                    ),
                    "quoted_text": str(matching_chunk.get("content", ""))[:200],
                    "relevance_score": float(matching_chunk.get("similarity", 0.0))
                })
                citation_number += 1
                continue

        # Strategy 2: Query Librarian for supporting chunk
        if user_id:
            try:
                librarian_result = run_librarian_agent({
                    "query": claim_text,
                    "user_id": user_id,
                    "file_ids": file_ids,
                    "top_k": 1
                })

                if librarian_result.get("chunks"):
                    top_chunk = librarian_result["chunks"][0]
                    source_file_id = str(top_chunk.get("file_id"))
                    source_filename = file_map.get(source_file_id, "Unknown Source")

                    citations.append({
                        "citation_number": citation_number,
                        "claim_text": claim_text,
                        "claim_type": claim_type,
                        "source_file": source_filename,
                        "source_file_id": source_file_id,
                        "chunk_id": top_chunk.get("chunk_id"),
                        "page_range": _format_page_range(
                            top_chunk.get("page_start"),
                            top_chunk.get("page_end")
                        ),
                        "quoted_text": str(top_chunk.get("content", ""))[:200],
                        "relevance_score": float(top_chunk.get("similarity", 0.0))
                    })
                    citation_number += 1
            except Exception as e:
                logger.warning(f"Failed to find source for claim '{claim_text[:50]}...': {e}")

    logger.info(f"Matched {len(citations)} citations from {len(claims)} claims")
    return citations


def _format_page_range(page_start: Any, page_end: Any) -> str:
    """Format page range for citation display."""
    if page_start is None and page_end is None:
        return "?"
    if page_start == page_end or page_end is None:
        return str(page_start) if page_start is not None else "?"
    return f"{page_start}-{page_end}"


def format_citations_html(
    content_html: str,
    citations: List[Dict[str, Any]],
    section_key: str,
    model: str = "gemini-flash-lite-latest"
) -> str:
    """
    Use Gemini to insert <sup>N</sup> markers and generate footnotes section.

    Args:
        content_html: Original HTML content
        citations: List of citation metadata
        section_key: Section name
        model: Gemini model to use

    Returns:
        HTML content with citations
    """
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key or not citations:
        logger.info("No API key or no citations, returning original content")
        return content_html

    try:
        client = genai.Client(api_key=api_key)

        # Build citation reference list
        citation_refs = "\n".join([
            f"{c['citation_number']}. Claim: \"{c['claim_text']}\" → Source: {c['source_file']}, Page {c['page_range']}"
            for c in citations
        ])

        prompt = f"""You are a legal document formatter. Add formal footnote citations to the content.

**Original Content (HTML):**
{content_html}

**Citations to Insert:**
{citation_refs}

**Task:**
1. For each citation, find the claim_text in the content
2. Insert <sup>N</sup> immediately after the claim (before punctuation if present)
3. At the end of the content, add a footnotes section:

<div class="footnotes" style="margin-top: 30px; padding-top: 10px; border-top: 1px solid #333; font-size: 10pt; font-family: 'Times New Roman', serif;">
  <p><sup>1</sup> [Source], Page [Page Range].</p>
  <p><sup>2</sup> [Source], Page [Page Range].</p>
  ...
</div>

**Rules:**
- PRESERVE all existing HTML structure, CSS classes, and inline styles
- Insert <sup>N</sup> naturally without breaking sentences
- Use simple citation format: "Filename, Page X" or "Filename, Page X-Y"
- Return ONLY the HTML, no markdown code blocks
- If claim_text appears multiple times, cite it only on first occurrence
- If you cannot find the exact claim_text, skip that citation

**Example Output:**
<p>The petitioner filed a writ petition on 15th January 2024<sup>1</sup> alleging violation of fundamental rights.</p>
<div class="footnotes" style="margin-top: 30px; padding-top: 10px; border-top: 1px solid #333; font-size: 10pt;">
  <p><sup>1</sup> Case_Document.pdf, Page 3-5.</p>
</div>
"""

        response = client.models.generate_content(
            model=model,
            contents=[prompt],
            config=types.GenerateContentConfig(
                thinking_config=types.ThinkingConfig(thinking_budget=0)
            )
        )

        content_with_citations = response.text if response.text else content_html

        # Clean markdown artifacts (```html``` blocks)
        content_with_citations = re.sub(
            r'```(?:html)?\s*(.*?)\s*```',
            r'\1',
            content_with_citations,
            flags=re.DOTALL
        ).strip()

        logger.info("Successfully formatted citations into HTML")
        return content_with_citations

    except Exception as e:
        logger.exception("Failed to format citations")
        return content_html  # Return original on error
