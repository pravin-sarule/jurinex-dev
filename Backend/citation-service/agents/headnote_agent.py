"""
Headnote Generator Agent — uses Claude (claude-sonnet-4-6) to generate
structured legal headnotes for Indian court judgments.

A headnote is a concise 4-5 point summary of the key legal issues, holdings,
and principles decided in a judgment. It appears at the top of SCC/AIR reports
so practitioners can quickly assess relevance without reading the full judgment.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict

logger = logging.getLogger(__name__)

MODEL = "claude-sonnet-4-6"

HEADNOTE_SYSTEM = """You are a Senior Legal Reporter for an Indian law journal (SCC/AIR standard). Your task is to write a concise, professional headnote for the court judgment provided.

A headnote MUST:
1. Summarise the KEY LEGAL ISSUES decided (not procedural facts or background)
2. State the COURT'S HOLDING on each issue in precise legal language
3. Identify the RATIO DECIDENDI — the legal principle of general application
4. Use formal language consistent with SCC (Supreme Court Cases) reporting standards
5. Be organised as numbered points, maximum 5 points

FORMAT — strictly follow:
- Number each point: "1.", "2.", etc., one per line
- Each point: 1-2 sentences maximum
- Do NOT include the case name, citation reference, or date (these appear in the header)
- Do NOT include procedural history or background facts
- Do NOT include any preamble, title, or closing commentary
- Focus ONLY on the legal propositions and principles established

OUTPUT: Return only the numbered headnote points. Nothing else."""


def generate_headnote(
    raw_text: str,
    case_name: str = "",
    max_chars: int = 14000,
) -> str:
    """
    Generate a structured legal headnote for a judgment.

    Args:
        raw_text:  Full or partial judgment text (HTML will be cleaned automatically).
        case_name: Case name for context (e.g., "State v. Sharma").
        max_chars: Maximum characters of judgment text to send (default 14,000).

    Returns:
        A string of 4-5 numbered bullet points, or "" on failure/unavailable.
    """
    import re

    if not raw_text or not raw_text.strip():
        return ""

    api_key = os.environ.get("CLAUDE_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        logger.debug("[HEADNOTE] No API key set — skipping headnote generation")
        return ""

    # Strip HTML tags for cleaner input
    text = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", raw_text)
    text = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = text[:max_chars]

    if len(text) < 100:
        return ""

    user_content = (
        f"Case: {case_name}\n\n"
        f"Judgment text:\n{text}\n\n"
        f"Write the headnote (4-5 numbered points):"
    )

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)

        response = client.messages.create(
            model=MODEL,
            max_tokens=600,
            system=HEADNOTE_SYSTEM,
            messages=[{"role": "user", "content": user_content}],
        )

        headnote = response.content[0].text.strip()
        logger.info("[HEADNOTE] Generated %d chars for: %s", len(headnote), case_name[:60])
        return headnote

    except Exception as e:
        logger.warning("[HEADNOTE] Generation failed for '%s': %s", case_name[:60], e)
        return ""


def generate_headnote_from_judgement(j: Dict[str, Any]) -> str:
    """
    Convenience wrapper: extract text from a judgement dict and generate a headnote.
    Text priority: raw_content > full_text > ratio + excerpt_text.
    """
    raw = (
        j.get("raw_content")
        or j.get("full_text")
        or ""
    ).strip()

    # Fallback: combine ratio + excerpt if no full text
    if not raw or len(raw) < 200:
        ratio = (j.get("ratio") or "").strip()
        excerpt = (j.get("excerpt_text") or "").strip()
        raw = f"{ratio}\n\n{excerpt}".strip() if (ratio or excerpt) else raw

    if not raw:
        return ""

    case_name = (j.get("title") or j.get("case_name") or j.get("caseName") or "").strip()
    return generate_headnote(raw, case_name=case_name)
