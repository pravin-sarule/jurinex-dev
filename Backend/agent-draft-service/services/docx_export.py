"""
Shared DOCX export: same format as the static preview (AssembledPreviewPage).
Used for: (1) Google Docs upload in assembler, (2) DOCX download.
Do not change static preview CSS; this module matches its layout so that
Google Docs and DOCX download look like the in-app static preview.

Static preview uses: width 210mm, min-height 297mm, padding 2.54cm, Times New Roman.
Here we use: A4 (21×29.7 cm), 2.54 cm margins, Times New Roman 12pt.
When template_css is provided, it is inlined into the HTML so DOCX/Google Docs
preserve the same formatting (alignment, indents, font) as the static preview.
When template_url is provided, styles are fetched from the template document
and merged with template_css so the Word/Google Docs output matches the
uploaded template format exactly.
"""

from __future__ import annotations

import io
import logging
import re

logger = logging.getLogger(__name__)

# Match static preview .assembled-doc-container: A4, 2.54 cm, Times New Roman
FONT_NAME = "Times New Roman"
FONT_SIZE_PT = 12
PAGE_HEIGHT_CM = 29.7   # 297mm A4
PAGE_WIDTH_CM = 21     # 210mm A4
MARGIN_CM = 2.54
SECTION_BREAK_MARKER = "<!-- SECTION_BREAK -->"


def _extract_style_blocks(html: str) -> str:
    """Extract all <style>...</style> content from template HTML for format reference."""
    if not (html or "").strip():
        return ""
    # Match <style ...>...</style> (any attributes, multiline)
    blocks = re.findall(r"<style[^>]*>([\s\S]*?)</style>", html, re.IGNORECASE)
    return "\n".join(b.strip() for b in blocks if b.strip()).strip()


def _get_merged_template_css(template_css: str | None, template_url: str | None) -> str | None:
    """
    Merge template_css with styles fetched from template_url so conversion uses
    the exact format of the uploaded template (alignment, indents, fonts).
    """
    from services.template_format import fetch_template_html

    css_parts = []
    if (template_css or "").strip():
        css_parts.append(template_css.strip())
    if (template_url or "").strip():
        try:
            template_html = fetch_template_html(template_url.strip())
            if template_html:
                from_template = _extract_style_blocks(template_html)
                if from_template:
                    css_parts.append("/* styles from template document */\n" + from_template)
                    logger.info("DOCX export: merged template URL styles into CSS for format preservation")
        except Exception as e:
            logger.warning("DOCX export: could not fetch template URL for styles: %s", e)
    if not css_parts:
        return None
    return "\n\n".join(css_parts)


def _inline_template_css(html_content: str, template_css: str) -> str:
    """
    Inline template_css into the HTML so conversion to DOCX preserves the same
    format as the static preview (alignment, indents, font-size, etc.).
    Returns the body content with inlined styles (no <style> block in output).
    """
    if not (template_css or "").strip():
        return html_content
    try:
        from premailer import transform
    except ImportError:
        return html_content
    full_doc = (
        "<!DOCTYPE html><html><head><style>\n"
        + (template_css or "").strip()
        + "\n</style></head><body>\n"
        + html_content
        + "\n</body></html>"
    )
    try:
        inlined = transform(full_doc)
        # Extract body inner HTML (premailer returns full document)
        start = inlined.find("<body>")
        end = inlined.rfind("</body>")
        if start != -1 and end != -1:
            start += len("<body>")
            return inlined[start:end].strip()
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("premailer inline failed, using original HTML: %s", e)
    return html_content


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


def _parse_indent_to_twips(value: str, default_pt: float = 12.0) -> float | None:
    """
    Parse CSS indent (text-indent / margin-left) to points for Word.
    Returns points (float) or None if unparseable.
    """
    value = (value or "").strip().lower()
    if not value or value == "0" or value == "0px" or value == "0pt":
        return 0.0
    num = re.sub(r"[a-z%]+", "", value)
    if not num:
        return None
    try:
        num_f = float(num)
    except ValueError:
        return None
    if "cm" in value:
        return num_f * 28.35  # 1 cm ≈ 28.35 pt
    if "mm" in value:
        return num_f * 2.835
    if "pt" in value:
        return num_f
    if "px" in value:
        return num_f * 72 / 96  # 96px = 1in = 72pt
    if "em" in value or "rem" in value:
        return num_f * default_pt
    if "in" in value:
        return num_f * 72
    # default assume px
    return num_f * 72 / 96


class _HtmlToDocxWithIndent:
    """
    Wrapper that uses htmldocx but applies text-indent as first_line_indent
    so template paragraph indentation matches the preview in Word/Google Docs.
    """

    def __init__(self):
        from htmldocx import HtmlToDocx
        self._parser = HtmlToDocx()

    def add_html_to_document(self, html: str, document) -> None:
        # Monkey-patch add_styles_to_paragraph on the parser so we can add text-indent
        original = self._parser.add_styles_to_paragraph
        from docx.shared import Pt

        def _add_styles(style: dict) -> None:
            original(style)
            if not self._parser.paragraph:
                return
            if "text-indent" in style:
                pt_val = _parse_indent_to_twips(style["text-indent"])
                if pt_val is not None and pt_val != 0:
                    self._parser.paragraph.paragraph_format.first_line_indent = Pt(pt_val)
        self._parser.add_styles_to_paragraph = _add_styles
        try:
            self._parser.add_html_to_document(html, document)
        finally:
            self._parser.add_styles_to_paragraph = original


def assembled_html_to_docx_bytes(
    html_content: str,
    template_css: str | None = None,
    template_url: str | None = None,
) -> bytes:
    """
    Convert assembled HTML (with SECTION_BREAK markers) to DOCX bytes.
    Format matches static preview: A4, 2.54cm margins, Times New Roman 12pt.
    Same conversion for Google Docs (assembler upload) and DOCX download.
    When template_css is provided, inlines it so DOCX/Google Docs match static preview format.
    When template_url is provided, fetches styles from the template document and merges with
    template_css so alignment and indentation match the uploaded template exactly.
    Strips <style> blocks after inlining; strips citation/source blocks.
    """
    from docx import Document
    from docx.enum.text import WD_PARAGRAPH_ALIGNMENT, WD_LINE_SPACING
    from docx.shared import Pt, Cm, RGBColor

    from services.assembled_doc_clean import strip_citations_for_assembled

    # Remove citations so download never shows citation lists (filename, Page N.)
    html_content = strip_citations_for_assembled(html_content or "")
    # Merge template_css with styles from template_url so format matches uploaded template
    merged_css = _get_merged_template_css(template_css, template_url)
    # Inline merged CSS so Google Docs / DOCX match static preview (alignment, indents, justify, etc.)
    if merged_css:
        html_content = _inline_template_css(html_content, merged_css)
    # Remove <style> blocks so they don't appear as plain text; keep inline styles on elements
    html_content = _strip_style_tags(html_content)
    # Ensure every <a> has href so htmldocx does not raise KeyError('href')
    html_content = _ensure_anchor_href(html_content)

    document = Document()

    # Normal style: match static preview (Times New Roman 12pt, line-height 1.5)
    style = document.styles["Normal"]
    style.font.name = FONT_NAME
    style.font.size = Pt(FONT_SIZE_PT)
    style.paragraph_format.line_spacing_rule = WD_LINE_SPACING.ONE_POINT_FIVE
    style.paragraph_format.space_after = Pt(0)

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

    parser = _HtmlToDocxWithIndent()
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
        # Default to justify when not set (match legal doc preview); preserve center/right from inlined styles
        if paragraph.alignment is None:
            paragraph.alignment = WD_PARAGRAPH_ALIGNMENT.JUSTIFY

    buf = io.BytesIO()
    document.save(buf)
    buf.seek(0)
    return buf.read()
