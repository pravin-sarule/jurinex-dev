"""
Assembler Agent: Assemble the final document by combining sections with template format reference.

This agent ASSEMBLES only - it does NOT generate content. It combines pre-drafted sections
in order, references the template URL for structure, and produces the final HTML document.
Supports documents up to 500+ pages via pure procedural assembly (no LLM calls for large docs).
"""

from __future__ import annotations

import logging
from typing import Any, Dict

logger = logging.getLogger(__name__)

# Thresholds: above these, use assembly-only mode (no AI) to support 500+ page documents
ASSEMBLY_ONLY_CHAR_THRESHOLD = 150_000  # ~40-50 pages
ASSEMBLY_ONLY_SECTION_THRESHOLD = 8


# Structural-only styles: do not set font/size/alignment so section content keeps exact template format
A4_PAGE_STYLE = """<style type="text/css">
@page { size: A4; margin: 2.54cm; }
.document-section { margin-bottom: 0; }
.page-break { page-break-before: always; break-before: page; height: 0; overflow: hidden; }
@media print {
  .page-break { page-break-before: always; display: block; height: 0; margin: 0; padding: 0; }
  .document-section { page-break-inside: avoid; }
}
</style>"""


def _procedural_assembly(sections: list, template_url: str = None, template_css: str = None) -> str:
    """
    Combine sections procedurally without AI. Preserves exact format of each section's
    generated content (alignment, indentation, fonts from template).
    Uses A4 page size and proper page breaks. Supports documents of any size (500+ pages).
    When template_css is provided, it is embedded in the output so the preview shows
    the same format as the section-generated content.
    Strips citations from each section so the assembled document does not show citation lists.
    """
    from services.assembled_doc_clean import strip_citations_for_assembled

    parts = []
    # Embed template CSS first so preview uses exact same styles as section view (format preservation)
    if (template_css or "").strip():
        parts.append("<style type=\"text/css\">\n" + template_css.strip() + "\n</style>")
    parts.append(A4_PAGE_STYLE)
    for i, s in enumerate(sections):
        s_key = s.get("key", "section")
        s_content = (s.get("content", "") or "").strip()
        if s_content:
            s_content = strip_citations_for_assembled(s_content)
            if s_content.strip():
                parts.append(f'<div class="document-section" id="section-{s_key}">{s_content}</div>')
            if i < len(sections) - 1:
                parts.append("<!-- SECTION_BREAK -->")
    return "\n".join(parts) if parts else ""


def run_assembler_agent(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Run the Assembler agent: ASSEMBLE sections only. Does NOT generate content.
    
    1. Combines sections procedurally in order.
    2. References template_url for format/structure.
    3. For large docs (>150K chars or >8 sections): pure assembly, no LLM (supports 500+ pages).
    4. For small docs: optional lightweight AI placeholder-fill (can be disabled).
    """
    import os
    import requests

    sections = payload.get("sections", [])
    template_url = payload.get("template_url")
    draft_id = payload.get("draft_id", "unknown")

    if not sections:
        draft_content = payload.get("draft", "")
        if not draft_content:
            logger.warning("Assembler: No sections or draft provided for assembly")
            return {"final_document": "", "error": "No content provided"}
        return {"final_document": draft_content, "format": "html"}

    total_chars = sum(len((s.get("content", "") or "")) for s in sections)
    use_assembly_only = (
        total_chars > ASSEMBLY_ONLY_CHAR_THRESHOLD or
        len(sections) > ASSEMBLY_ONLY_SECTION_THRESHOLD
    )

    logger.info(
        "Assembler: Assembling %d sections (~%d chars) for draft %s (assembly_only=%s)",
        len(sections), total_chars, draft_id, use_assembly_only
    )

    # Fetch template for reference (structure/layout; assembly uses template_url in metadata)
    if template_url:
        try:
            requests.get(template_url, timeout=15)  # Validate template URL is reachable
        except Exception as e:
            logger.warning("Assembler: Template URL unreachable: %s", e)

    # Always use procedural assembly: combine sections, preserve exact section format in preview
    template_css_raw = (payload.get("template_css") or "").strip() or None
    final_document = _procedural_assembly(sections, template_url, template_css=template_css_raw)
    if use_assembly_only:
        logger.info("Assembler: Large document (%d sections, ~%d chars) assembled", len(sections), total_chars)

    # Convert the same final_document to DOCX and upload so Google Docs / iframe matches the preview exactly
    upload_result = {}
    try:
        import io
        from services.docx_export import assembled_html_to_docx_bytes

        template_css = template_css_raw
        logger.info("Assembler: Converting final HTML to DOCX (%d parts, template_css=%s, template_url=%s)", len(final_document.split("<!-- SECTION_BREAK -->")), "yes" if template_css else "no", "yes" if template_url else "no")
        docx_bytes = assembled_html_to_docx_bytes(final_document, template_css=template_css, template_url=template_url)
        doc_io = io.BytesIO(docx_bytes)
        doc_io.seek(0)

        DRAFTING_SERVICE_URL = os.environ.get("DRAFTING_SERVICE_URL", "http://localhost:5005")
        existing_google_file_id = payload.get("existing_google_file_id")
        files = {
            "file": (
                f"Assembled_{draft_id}.docx",
                doc_io,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        }
        data = {
            "draft_id": draft_id,
            "title": f"Assembled_{draft_id}",
            "user_id": payload.get("user_id", ""),
            "existing_google_file_id": existing_google_file_id or "",
        }
        headers = {"x-user-id": str(payload.get("user_id", ""))}

        resp = requests.post(
            f"{DRAFTING_SERVICE_URL}/api/drafts/finish-assembled",
            files=files,
            data=data,
            headers=headers,
            timeout=180,
        )
        if resp.status_code == 200:
            upload_result = resp.json()
            logger.info("Assembler: Uploaded to Drafting Service: %s", upload_result.get("googleFileId"))
        else:
            logger.warning("Assembler: Upload failed %d (assembly succeeded, HTML returned)", resp.status_code)
            upload_result = {"error": resp.text or f"Status {resp.status_code}"}
    except Exception as e:
        logger.warning("Assembler: DOCX/upload failed (assembly succeeded): %s", e)
        upload_result = {"error": str(e)}

    return {
        "final_document": final_document,
        "format": "html",
        "sections_assembled": len(sections),
        "google_docs": upload_result,
        "metadata": {
            "draft_id": draft_id,
            "template_url": template_url,
            "ai_polished": False,
            "assembly_only": True,
            "google_file_id": upload_result.get("googleFileId"),
            "iframe_url": upload_result.get("iframeUrl"),
            "existing_file_id": payload.get("existing_google_file_id"),
        },
    }
