"""
Strip all citation/source content from HTML used for the assembled document.
Used so preview, Google Docs, and DOCX download do not show citations.
"""

from __future__ import annotations

import re


def strip_citations_for_assembled(html: str) -> str:
    """
    Remove from HTML everything that should not appear in the final assembled
    document: [cite:...], [Source:...], footnotes div, and numbered citation
    lines like "1. filename.pdf, Page 17." so preview, Google Docs, and DOCX
    show no citations.
    """
    if not html or not html.strip():
        return html

    # 1. [cite: ...], [Source: ...]
    out = re.sub(r"\[cite:\s*[^\]]*\]", "", html, flags=re.IGNORECASE)
    out = re.sub(r"\[Source:\s*[^\]]*\]", "", out, flags=re.IGNORECASE)

    # 2. Entire footnotes block (div with class containing "footnotes")
    out = re.sub(
        r'<div[^>]*class="[^"]*footnotes[^"]*"[^>]*>[\s\S]*?</div>\s*',
        "",
        out,
        flags=re.IGNORECASE,
    )
    # Also without quotes: class=footnotes
    out = re.sub(
        r"<div[^>]*class=['\"]?footnotes['\"]?[^>]*>[\s\S]*?</div>\s*",
        "",
        out,
        flags=re.IGNORECASE,
    )

    # 3. Paragraphs that are only citation: <p>...<sup>N</sup> filename.pdf, Page X.</p>
    out = re.sub(
        r'<p[^>]*>\s*<sup>\d+</sup>\s*[^<]*?[A-Za-z0-9_\-]+\.(?:pdf|docx?),\s*Page\s+\d+[^<]*\.?\s*</p>\s*',
        "",
        out,
        flags=re.IGNORECASE,
    )
    # 3b. Paragraphs that are only "N filename.pdf, Page 17." (no <sup>)
    out = re.sub(
        r'<p[^>]*>\s*\d+\s*\.?\s*[^<]*?[A-Za-z0-9_\-]+\.(?:pdf|docx?),\s*Page\s+\d+[^<]*\.?\s*</p>\s*',
        "",
        out,
        flags=re.IGNORECASE,
    )

    # 4. Numbered citation lines (plain text): "1. filename.pdf, Page 17." or "1 filename.pdf, Page 17."
    # Match line that starts with optional number + period/space then filename ending .pdf/.docx, Page N
    out = re.sub(
        r"(?:^|\n)\s*\d+\s*\.?\s*[A-Za-z0-9_\-]+\.(?:pdf|docx?),\s*Page\s+\d+\s*\.?\s*(?=\n|$)",
        "",
        out,
        flags=re.IGNORECASE | re.MULTILINE,
    )

    # 5. List items that are only citation
    out = re.sub(
        r'<li[^>]*>\s*(?:<sup>\d+</sup>\s*)?[^<]*?[A-Za-z0-9_\-]+\.(?:pdf|docx?),\s*Page\s+\d+[^<]*\.?\s*</li>\s*',
        "",
        out,
        flags=re.IGNORECASE,
    )

    # 6. Standalone "Source: filename.pdf" text
    out = re.sub(
        r"Source:\s*[^\s<>\[\]]+\.(?:pdf|docx?)\b",
        "",
        out,
        flags=re.IGNORECASE,
    )

    # Collapse excessive blank lines and trim
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()
