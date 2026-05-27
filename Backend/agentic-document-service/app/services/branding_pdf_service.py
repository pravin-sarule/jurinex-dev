"""
Render branded HTML to PDF using Chromium (Playwright).

Same print engine as Puppeteer — native @page margins, fonts, SVG, and page breaks.
Page numbers use Chromium's PDF footer templates (pageNumber / totalPages), not CSS counters.
"""

from __future__ import annotations

import html as html_module
import logging
import re
from typing import Any

logger = logging.getLogger("agentic_document_service.branding_pdf")

_PLAYWRIGHT_AVAILABLE: bool | None = None

# Extra bottom band for Playwright footer templates (mm)
_FOOTER_BAND_MM = 14


def is_pdf_renderer_available() -> bool:
    global _PLAYWRIGHT_AVAILABLE
    if _PLAYWRIGHT_AVAILABLE is not None:
        return _PLAYWRIGHT_AVAILABLE
    try:
        from playwright.sync_api import sync_playwright  # noqa: F401

        _PLAYWRIGHT_AVAILABLE = True
    except ImportError:
        _PLAYWRIGHT_AVAILABLE = False
    return _PLAYWRIGHT_AVAILABLE


def safe_filename(name: str | None) -> str:
    base = (name or "export.pdf").strip()
    if not base.lower().endswith(".pdf"):
        base = f"{base}.pdf"
    return re.sub(r'[^\w.\- ]', "_", base) or "export.pdf"


def _page_format(profile: dict[str, Any] | None) -> str:
    if not profile:
        return "A4"
    size = str(profile.get("pageSize") or "a4").lower()
    if size == "letter":
        return "Letter"
    if size == "legal":
        return "Legal"
    return "A4"


def _landscape(profile: dict[str, Any] | None) -> bool:
    return bool(profile and profile.get("orientation") == "landscape")


def _margin_mm(profile: dict[str, Any] | None, *, reserve_footer: bool) -> dict[str, str]:
    p = profile or {}
    mt = float(p.get("marginTop") or 20)
    mr = float(p.get("marginRight") or 20)
    mb = float(p.get("marginBottom") or 20)
    ml = float(p.get("marginLeft") or 20)
    if reserve_footer:
        mb += _FOOTER_BAND_MM
    return {
        "top": f"{mt}mm",
        "right": f"{mr}mm",
        "bottom": f"{mb}mm",
        "left": f"{ml}mm",
    }


def _footer_template(profile: dict[str, Any] | None) -> str | None:
    """
    Chromium PDF footer: <span class="pageNumber"> and <span class="totalPages">
    are replaced on every printed page (reliable vs CSS counter() in fixed elements).
    """
    if not profile:
        return None
    footer_enabled = bool(profile.get("footerEnabled"))
    footer_text = str(profile.get("footerText") or "").strip()
    if not footer_enabled and not footer_text:
        return None

    color = str(profile.get("footerColor") or "#000000").lstrip("#")
    if len(color) == 3:
        color = "".join(c * 2 for c in color)
    fs = float(profile.get("footerFontSize") or 9)
    align = profile.get("footerPosition") or "bottom-center"
    text_align = (
        "left" if align == "bottom-left" else "right" if align == "bottom-right" else "center"
    )

    lines: list[str] = []
    if footer_text:
        lines.append(
            f'<div style="font-size:{fs}pt;color:#{color};text-align:{text_align};'
            f'width:100%;line-height:1.3;">{html_module.escape(footer_text)}</div>'
        )
    if footer_enabled:
        pattern = str(profile.get("footerPattern") or "Page {n} of {total}")
        label = (
            html_module.escape(pattern)
            .replace("{n}", '<span class="pageNumber"></span>')
            .replace("{total}", '<span class="totalPages"></span>')
        )
        lines.append(
            f'<div style="font-size:{fs}pt;color:#{color};text-align:{text_align};'
            f'width:100%;line-height:1.3;margin-top:2px;">{label}</div>'
        )

    inner = "".join(lines)
    return (
        '<div style="width:100%;font-family:Times New Roman,Georgia,serif;'
        'padding:0 8mm;box-sizing:border-box;">'
        f"{inner}</div>"
    )


def html_to_pdf(html: str, profile: dict[str, Any] | None = None) -> bytes:
    """
    Render a complete HTML document (from buildBrandedHtml) to PDF bytes.
    Footer page numbers are drawn by Chromium via footer_template, not HTML/CSS.
    """
    if not is_pdf_renderer_available():
        raise RuntimeError(
            "Playwright is not installed. Run: pip install playwright && playwright install chromium"
        )

    from playwright.sync_api import sync_playwright

    footer_html = _footer_template(profile)
    pdf_margins = _margin_mm(profile, reserve_footer=footer_html is not None)
    t0 = __import__("time").monotonic()

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            page.set_content(html, wait_until="networkidle")
            page.emulate_media(media="print")

            pdf_kwargs: dict[str, Any] = {
                "format": _page_format(profile),
                "landscape": _landscape(profile),
                "print_background": True,
                "prefer_css_page_size": True,
                "margin": pdf_margins,
            }
            if footer_html:
                pdf_kwargs["display_header_footer"] = True
                pdf_kwargs["header_template"] = "<div></div>"
                pdf_kwargs["footer_template"] = footer_html

            pdf_bytes = page.pdf(**pdf_kwargs)
        finally:
            browser.close()

    duration_ms = round((__import__("time").monotonic() - t0) * 1000)
    logger.info(
        "[BrandingExport] pdf_render engine=playwright duration_ms=%s bytes=%s footer=%s",
        duration_ms,
        len(pdf_bytes),
        bool(footer_html),
    )
    return pdf_bytes
