"""
Shared DOCX export: same format as the static preview (AssembledPreviewPage).
Used for: (1) Google Docs upload in assembler, (2) DOCX download.
Do not change static preview CSS; this module matches its layout so that
Google Docs and DOCX download look like the in-app static preview.

Static preview uses: width 210mm, min-height 297mm, padding 2.54cm, Times New Roman.
Here we use: A4 (21×29.7 cm), 2.54 cm margins, Times New Roman 12pt.
"""

from __future__ import annotations

import io
import re

# Match static preview .assembled-doc-container: A4, 2.54 cm, Times New Roman
FONT_NAME = "Times New Roman"
FONT_SIZE_PT = 12
PAGE_HEIGHT_CM = 29.7   # 297mm A4
PAGE_WIDTH_CM = 21     # 210mm A4
MARGIN_CM = 2.54
SECTION_BREAK_MARKER = "<!-- SECTION_BREAK -->"


def _strip_style_tags(html: str) -> str:
    """Remove <style>...</style> blocks so CSS is not shown as text in DOCX/Google Docs."""
    out = re.sub(r"<style[^>]*>[\s\S]*?</style>", "", html, flags=re.IGNORECASE)
    # Remove any stray CSS-like lines that might remain (e.g. from malformed tags)
    out = re.sub(r"@page\s*\{[^}]*\}", "", out, flags=re.IGNORECASE)
    out = re.sub(r"@media\s+print\s*\{[\s\S]*?\}", "", out, flags=re.IGNORECASE)
    out = re.sub(r"\.document-section\s*\{[^}]*\}", "", out, flags=re.IGNORECASE)
    out = re.sub(r"\.page-break\s*\{[^}]*\}", "", out, flags=re.IGNORECASE)
    return out.strip()


def _ensure_anchor_href(html: str) -> str:
    """Ensure every <a> tag has an href so htmldocx does not raise KeyError('href')."""
    def repl(m: re.Match) -> str:
        prefix, rest = m.group(1), m.group(2)
        if rest and "href=" in rest.lower():
            return m.group(0)
        if rest:
            return f'<a{prefix}href="#" {rest}>'
        return f'<a{prefix}href="#">'
    return re.sub(r"<a(\s*)([^>]*)>", repl, html, flags=re.IGNORECASE)


def assembled_html_to_docx_bytes(html_content: str) -> bytes:
    """
    Convert assembled HTML (with SECTION_BREAK markers) to DOCX bytes.
    Format matches static preview: A4, 2.54cm margins, Times New Roman 12pt.
    Same conversion for Google Docs (assembler upload) and DOCX download.
    Strips <style> blocks only (no change to inline styles); CSS is not shown as text.
    Strips all citation/source blocks so DOCX never shows citation lists.
    """
    from docx import Document
    from docx.enum.text import WD_PARAGRAPH_ALIGNMENT
    from docx.shared import Pt, Cm, RGBColor
    from htmldocx import HtmlToDocx

    from services.assembled_doc_clean import strip_citations_for_assembled

    # Remove citations so download never shows citation lists (filename, Page N.)
    html_content = strip_citations_for_assembled(html_content or "")
    # Remove only <style> blocks so they don't appear as plain text; keep inline styles on elements
    html_content = _strip_style_tags(html_content)
    # Ensure every <a> has href so htmldocx does not raise KeyError('href')
    html_content = _ensure_anchor_href(html_content)

    document = Document()

    # Normal style
    style = document.styles["Normal"]
    style.font.name = FONT_NAME
    style.font.size = Pt(FONT_SIZE_PT)

    # Set Times New Roman on all styles that have font (so headings etc. match)
    for s in document.styles:
        if hasattr(s, "font") and s.font is not None:
            try:
                s.font.name = FONT_NAME
            except Exception:
                pass

    # Page setup: A4, margins
    section = document.sections[0]
    section.page_height = Cm(PAGE_HEIGHT_CM)
    section.page_width = Cm(PAGE_WIDTH_CM)
    section.left_margin = Cm(MARGIN_CM)
    section.right_margin = Cm(MARGIN_CM)
    section.top_margin = Cm(MARGIN_CM)
    section.bottom_margin = Cm(MARGIN_CM)

    parser = HtmlToDocx()
    content_parts = html_content.split(SECTION_BREAK_MARKER)

    for i, part in enumerate(content_parts):
        clean_part = part.strip()
        if not clean_part:
            continue
        parser.add_html_to_document(clean_part, document)
        if i < len(content_parts) - 1:
            document.add_page_break()

    # Force Times New Roman and black text on every run (no colors in Google Docs/Word)
    black = RGBColor(0, 0, 0)
    for paragraph in document.paragraphs:
        for run in paragraph.runs:
            run.font.name = FONT_NAME
            run.font.color.rgb = black
        # Keep same formatting as static preview: left-aligned content must not appear "in the middle"
        # Zero right indent so blocks stay left-aligned (no symmetric indent that looks centered)
        pf = paragraph.paragraph_format
        pf.right_indent = Pt(0)
        # Default to left alignment when not explicitly set (preserves center from HTML where set)
        if paragraph.alignment is None:
            paragraph.alignment = WD_PARAGRAPH_ALIGNMENT.LEFT

    buf = io.BytesIO()
    document.save(buf)
    buf.seek(0)
    return buf.read()
