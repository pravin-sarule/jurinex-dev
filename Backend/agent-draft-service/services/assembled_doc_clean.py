"""
Strip all citation/source content from HTML used for the assembled document.
Used so preview, Google Docs, and DOCX download do not show citations.
Removes: [cite:...], [Source:...], footnotes div, inline <sup>N</sup> markers,
and citation blocks (e.g. Adv S.K. Patil, Notary Dist. Latur).
"""

from __future__ import annotations

import re


def strip_citations_for_assembled(html: str) -> str:
    """
    Remove from HTML everything that should not appear in the final assembled
    document so preview, Google Docs, and DOCX show no citations:
    - [cite:...], [Source:...]
    - Footnotes div and footnote-style blocks
    - Inline <sup>N</sup> citation markers
    - Citation lines (filename.pdf Page X, Adv X, Notary Dist. Y, etc.)
    """
    if not html or not html.strip():
        return html

    # 1. [cite: ...], [Source: ...]
    out = re.sub(r"\[cite:\s*[^\]]*\]", "", html, flags=re.IGNORECASE)
    out = re.sub(r"\[Source:\s*[^\]]*\]", "", out, flags=re.IGNORECASE)

    # 2. Entire footnotes block (div/section with class or id containing "footnotes")
    out = re.sub(
        r'<div[^>]*class="[^"]*footnotes[^"]*"[^>]*>[\s\S]*?</div>\s*',
        "",
        out,
        flags=re.IGNORECASE,
    )
    out = re.sub(
        r"<div[^>]*class=['\"]?footnotes['\"]?[^>]*>[\s\S]*?</div>\s*",
        "",
        out,
        flags=re.IGNORECASE,
    )
    out = re.sub(
        r'<div[^>]*id=["\']footnotes["\'][^>]*>[\s\S]*?</div>\s*',
        "",
        out,
        flags=re.IGNORECASE,
    )
    out = re.sub(
        r'<section[^>]*class="[^"]*footnotes[^"]*"[^>]*>[\s\S]*?</section>\s*',
        "",
        out,
        flags=re.IGNORECASE,
    )

    # 3. Paragraphs that are only citation lines
    # 3a. <p><sup>N</sup> Adv X / Notary Y / filename.pdf...</p>
    out = re.sub(
        r'<p[^>]*>\s*<sup>\d+</sup>\s*[^<]*</p>\s*',
        "",
        out,
        flags=re.IGNORECASE,
    )
    # 3a2. <p>Adv Patil<sup>7</sup></p> or <p>Notary Dist. Latur<sup>8</sup></p>
    out = re.sub(
        r'<p[^>]*>[^<]{0,80}<sup>\d+</sup>\s*</p>\s*',
        "",
        out,
        flags=re.IGNORECASE,
    )
    # 3b. Paragraphs that are only citation: <p>...<sup>N</sup> filename.pdf, Page X.</p>
    out = re.sub(
        r'<p[^>]*>\s*<sup>\d+</sup>\s*[^<]*?[A-Za-z0-9_\-]+\.(?:pdf|docx?),\s*Page\s+\d+[^<]*\.?\s*</p>\s*',
        "",
        out,
        flags=re.IGNORECASE,
    )
    # 3c. Paragraphs that are only "N filename.pdf, Page 17." (no <sup>)
    out = re.sub(
        r'<p[^>]*>\s*\d+\s*\.?\s*[^<]*?[A-Za-z0-9_\-]+\.(?:pdf|docx?),\s*Page\s+\d+[^<]*\.?\s*</p>\s*',
        "",
        out,
        flags=re.IGNORECASE,
    )

    # 4. Remove ALL inline <sup>N</sup> citation markers (e.g. Before Me,<sup>7</sup><sup>8</sup>)
    out = re.sub(r"<sup>\d+</sup>", "", out)

    # 5. Remove duplicate notary/citation blocks: standalone lines like "Adv S.K. Patil" or "Notary Dist. Latur"
    # Only remove when they appear as whole-paragraph content (likely citation repetition)
    out = re.sub(
        r'<p[^>]*>\s*(?:Adv\.?\s+[A-Z][a-zA-Z\s\.]+|Notary\s+Dist\.?\s+[A-Za-z]+)\s*</p>\s*',
        "",
        out,
        flags=re.IGNORECASE,
    )

    # 6. Numbered citation lines (plain text): "1. filename.pdf, Page 17."
    out = re.sub(
        r"(?:^|\n)\s*\d+\s*\.?\s*[A-Za-z0-9_\-]+\.(?:pdf|docx?),\s*Page\s+\d+\s*\.?\s*(?=\n|$)",
        "",
        out,
        flags=re.IGNORECASE | re.MULTILINE,
    )

    # 7. List items that are only citation
    out = re.sub(
        r'<li[^>]*>\s*(?:<sup>\d+</sup>\s*)?[^<]*?[A-Za-z0-9_\-]+\.(?:pdf|docx?),\s*Page\s+\d+[^<]*\.?\s*</li>\s*',
        "",
        out,
        flags=re.IGNORECASE,
    )

    # 8. Standalone "Source: filename.pdf" text
    out = re.sub(
        r"Source:\s*[^\s<>\[\]]+\.(?:pdf|docx?)\b",
        "",
        out,
        flags=re.IGNORECASE,
    )

    # Collapse excessive blank lines and trim
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()
