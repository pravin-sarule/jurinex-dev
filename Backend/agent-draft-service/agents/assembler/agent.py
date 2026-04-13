"""
Assembler Agent: Assemble the final document by combining sections with template format reference.

This agent ASSEMBLES only - it does NOT generate content. It combines pre-drafted sections
in order, references the template URL for structure, and produces the final HTML document.
Supports documents up to 500+ pages via pure procedural assembly (no LLM calls for large docs).
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict

logger = logging.getLogger(__name__)

# Thresholds: above these, use assembly-only mode (no AI) to support 500+ page documents
ASSEMBLY_ONLY_CHAR_THRESHOLD = 150_000  # ~40-50 pages
ASSEMBLY_ONLY_SECTION_THRESHOLD = 8


def _normalize_google_docs_result(raw_result: Dict[str, Any] | None) -> Dict[str, Any]:
    """Normalize Google Docs upload response keys so frontend/cache always get usable values."""
    result = dict(raw_result or {})
    google_file_id = (
        result.get("googleFileId")
        or result.get("google_file_id")
        or result.get("fileId")
        or result.get("file_id")
    )
    web_view_link = result.get("webViewLink") or result.get("web_view_link")
    iframe_url = result.get("iframeUrl") or result.get("iframe_url")

    if not iframe_url and google_file_id:
        iframe_url = f"https://docs.google.com/document/d/{google_file_id}/edit?embedded=true"

    if not web_view_link and google_file_id:
        web_view_link = f"https://docs.google.com/document/d/{google_file_id}/edit"

    if google_file_id:
        result["googleFileId"] = google_file_id
        result["google_file_id"] = google_file_id
    if iframe_url:
        result["iframeUrl"] = iframe_url
        result["iframe_url"] = iframe_url
    if web_view_link:
        result["webViewLink"] = web_view_link
        result["web_view_link"] = web_view_link

    return result


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


def _norm_key(value: str) -> str:
    return (value or "").strip().lower().replace(" ", "_")


def _replace_placeholders(text: str, values: Dict[str, str]) -> str:
    if not text:
        return text
    rendered = text
    for key, value in values.items():
        key_clean = str(key or "").strip()
        if not key_clean:
            continue
        safe_val = str(value or "")
        # Support both {{key}} and __key__ formats used across template flows.
        rendered = re.sub(r"\{\{\s*" + re.escape(key_clean) + r"\s*\}\}", safe_val, rendered, flags=re.IGNORECASE)
        rendered = re.sub(r"__\s*" + re.escape(key_clean) + r"\s*__", safe_val, rendered, flags=re.IGNORECASE)
        rendered = re.sub(r"(?<!_)_" + re.escape(key_clean) + r"_(?!_)", safe_val, rendered, flags=re.IGNORECASE)
    return rendered


def _inject_template_content(template_html: str, sections: list, field_values: Dict[str, Any]) -> str:
    """
    Template injection strategy:
    - Keep static formatting from template HTML.
    - Inject dynamic section content and field placeholders into tagged slots.
    """
    if not (template_html or "").strip():
        return ""

    placeholder_values: Dict[str, str] = {}

    # Field-level placeholders: {{petitioner_full_name}}, __petitioner_full_name__, _petitioner_full_name_
    for k, v in (field_values or {}).items():
        k_norm = _norm_key(str(k))
        placeholder_values[k_norm] = str(v or "")
        placeholder_values[str(k)] = str(v or "")

    # Section-level placeholders: {{section_key}}, {{Section_1_Content}}, etc.
    for idx, s in enumerate(sections, start=1):
        section_key = str(s.get("key") or "").strip()
        section_norm = _norm_key(section_key)
        content = str(s.get("content", "") or "").strip()
        if not content:
            continue
        if section_key:
            placeholder_values[section_key] = content
        if section_norm:
            placeholder_values[section_norm] = content
        placeholder_values[f"section_{idx}_content"] = content
        placeholder_values[f"Section_{idx}_Content"] = content

    return _replace_placeholders(template_html, placeholder_values)


def _build_placeholder_values(sections: list, field_values: Dict[str, Any]) -> Dict[str, str]:
    placeholder_values: Dict[str, str] = {}
    for k, v in (field_values or {}).items():
        k_raw = str(k or "").strip()
        k_norm = _norm_key(k_raw)
        if k_raw:
            placeholder_values[k_raw] = str(v or "")
        if k_norm:
            placeholder_values[k_norm] = str(v or "")
    for idx, s in enumerate(sections, start=1):
        section_key = str(s.get("key") or "").strip()
        section_norm = _norm_key(section_key)
        content = str(s.get("content", "") or "").strip()
        if not content:
            continue
        if section_key:
            placeholder_values[section_key] = content
        if section_norm:
            placeholder_values[section_norm] = content
        placeholder_values[f"section_{idx}_content"] = content
        placeholder_values[f"Section_{idx}_Content"] = content
    return placeholder_values


def _render_docx_master_template(template_url: str, context: Dict[str, str]) -> bytes:
    """
    Render DOCX master template using docxtpl context.
    Requires template_url to point to a .docx file.
    """
    import io
    import requests
    from docxtpl import DocxTemplate

    resp = requests.get(template_url, timeout=45)
    resp.raise_for_status()
    raw = io.BytesIO(resp.content)
    tpl = DocxTemplate(raw)
    tpl.render(context)
    out = io.BytesIO()
    tpl.save(out)
    out.seek(0)
    return out.read()


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
    from services.text_cleaner import clean_assembled_html

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
    assembled = "\n".join(parts) if parts else ""
    return clean_assembled_html(assembled)


def _apply_legal_post_processing(html: str) -> str:
    """
    Post-processing for legal formatting conventions:
    - page breaks before Prayer/Verification sections
    - normalize annexure labels to bold ANNEXURE P-X prefix when present
    """
    out = str(html or "")
    out = re.sub(
        r"(<(h1|h2|h3|p)[^>]*>\s*)(prayer|verification)\b",
        r'<div class="page-break"></div>\1\3',
        out,
        flags=re.IGNORECASE,
    )
    out = re.sub(
        r"(ANNEXURE\s+P-\d+\s*:)",
        r"<strong>\1</strong>",
        out,
        flags=re.IGNORECASE,
    )
    return out


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
    template_asset_meta = payload.get("template_asset_meta") or {}
    draft_id = payload.get("draft_id", "unknown")

    from services.text_cleaner import clean_section_html, remove_cross_section_duplication, clean_assembled_html

    if not sections:
        draft_content = payload.get("draft", "")
        if not draft_content:
            logger.warning("Assembler: No sections or draft provided for assembly")
            return {"final_document": "", "error": "No content provided"}
        return {"final_document": clean_assembled_html(draft_content), "format": "html"}

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

    prepared_sections = []
    for section in sections:
        updated = dict(section)
        updated["content"] = clean_section_html(updated.get("content", "") or updated.get("content_html", ""))
        prepared_sections.append(updated)
    prepared_sections = remove_cross_section_duplication(prepared_sections)

    # Prefer template-file injection when a DOCX master template is available.
    template_css_raw = (payload.get("template_css") or "").strip() or None
    placeholder_values = _build_placeholder_values(prepared_sections, payload.get("field_values", {}) or {})
    injected_docx_bytes = None
    asset_mime = str(template_asset_meta.get("mime_type") or "").lower()
    asset_name = str(template_asset_meta.get("original_file_name") or "").lower()
    is_docx_master = (
        ".docx" in asset_name
        or "wordprocessingml.document" in asset_mime
        or asset_mime.endswith("/docx")
    )
    is_pdf_master = (".pdf" in asset_name) or ("application/pdf" in asset_mime)
    injection_mode = "dynamic_fallback"
    if template_url and is_docx_master:
        try:
            injected_docx_bytes = _render_docx_master_template(template_url, placeholder_values)
            logger.info("Assembler: Using DOCX master-template injection for draft %s", draft_id)
            injection_mode = "docx_master"
        except Exception as e:
            logger.warning("Assembler: DOCX template injection failed; using fallback assembly: %s", e)
    elif template_url and is_pdf_master:
        # PDF cannot be directly tag-rendered like docxtpl; use style-layer path with template reference.
        # This keeps PDF template structure influence while assembling dynamic sections.
        logger.info("Assembler: Using PDF template style-layer assembly for draft %s", draft_id)
        injection_mode = "pdf_style_layer"

    # For in-app preview, keep deterministic HTML assembly (styling layer fallback).
    final_document = _procedural_assembly(prepared_sections, template_url, template_css=template_css_raw)
    final_document = _apply_legal_post_processing(final_document)
    final_document = clean_assembled_html(final_document)
    if use_assembly_only:
        logger.info("Assembler: Large document (%d sections, ~%d chars) assembled", len(sections), total_chars)

    # Convert the same final_document to DOCX and upload so Google Docs / iframe matches the preview exactly
    upload_result = {}
    try:
        import io
        from services.docx_export import assembled_html_to_docx_bytes, assembled_html_to_google_import_html

        template_css = template_css_raw
        try:
            google_import_html = assembled_html_to_google_import_html(final_document, template_css=template_css, template_url=template_url)
        except Exception as _html_err:
            logger.warning("Assembler: assembled_html_to_google_import_html failed (%s), falling back to plain wrapper", _html_err, exc_info=True)
            google_import_html = f"<!DOCTYPE html><html><head><meta charset=\"utf-8\"/></head><body>{final_document}</body></html>"

        logger.info(
            "Assembler: Preparing Google import HTML and DOCX (%d parts, template_css=%s, template_url=%s)",
            len(final_document.split("<!-- SECTION_BREAK -->")),
            "yes" if template_css else "no",
            "yes" if template_url else "no",
        )

        upload_filename = f"Assembled_{draft_id}.docx"
        upload_mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        try:
            if injected_docx_bytes:
                docx_bytes = injected_docx_bytes
            else:
                docx_bytes = assembled_html_to_docx_bytes(final_document, template_css=template_css, template_url=template_url)
            upload_bytes = docx_bytes
        except Exception as docx_error:
            logger.warning("Assembler: DOCX conversion failed, falling back to HTML upload for Google Docs: %s", docx_error)
            upload_bytes = google_import_html.encode("utf-8")
            upload_filename = f"Assembled_{draft_id}.html"
            upload_mime = "text/html"

        doc_io = io.BytesIO(upload_bytes)
        doc_io.seek(0)

        # In Cloud Run, use production drafting-service if not set (K_SERVICE is set by Cloud Run)
        DRAFTING_SERVICE_URL = os.environ.get("DRAFTING_SERVICE_URL") or (
            "https://drafting-service-120280829617.asia-south1.run.app" if os.environ.get("K_SERVICE") else "http://localhost:5005"
        )
        existing_google_file_id = payload.get("existing_google_file_id")
        files = {
            "file": (
                upload_filename,
                doc_io,
                upload_mime,
            )
        }
        data = {
            "draft_id": draft_id,
            "title": f"Assembled_{draft_id}",
            "user_id": payload.get("user_id", ""),
            "existing_google_file_id": existing_google_file_id or "",
            "google_import_html": google_import_html,
            "google_import_filename": f"Assembled_{draft_id}.html",
            "google_import_mime": "text/html",
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
            upload_result = _normalize_google_docs_result(resp.json())
            logger.info("Assembler: Uploaded to Drafting Service: %s", upload_result.get("googleFileId"))
        else:
            logger.warning("Assembler: Upload failed %d (assembly succeeded, HTML returned)", resp.status_code)
            upload_result = {"error": resp.text or f"Status {resp.status_code}"}
    except requests.exceptions.RequestException as e:
        # Common local-dev case: drafting-service on :5005 not running.
        logger.warning("Assembler: Drafting service unavailable at %s (assembly succeeded): %s", DRAFTING_SERVICE_URL, e)
        upload_result = {
            "error": f"Drafting service unavailable at {DRAFTING_SERVICE_URL}",
            "service_url": DRAFTING_SERVICE_URL,
        }
    except Exception as e:
        logger.warning("Assembler: DOCX/upload failed (assembly succeeded): %s", e)
        upload_result = {"error": str(e)}

    return {
        "final_document": final_document,
        "format": "html",
        "sections_assembled": len(prepared_sections),
        "google_docs": _normalize_google_docs_result(upload_result),
        "metadata": {
            "draft_id": draft_id,
            "template_url": template_url,
            "ai_polished": False,
            "assembly_only": True,
            "template_injection_used": bool(injected_docx_bytes),
            "template_injection_mode": injection_mode,
            "template_asset_type": (
                "docx" if is_docx_master else ("pdf" if is_pdf_master else "other")
            ),
            "google_file_id": upload_result.get("googleFileId") or upload_result.get("google_file_id"),
            "iframe_url": upload_result.get("iframeUrl") or upload_result.get("iframe_url"),
            "web_view_link": upload_result.get("webViewLink") or upload_result.get("web_view_link"),
            "existing_file_id": payload.get("existing_google_file_id"),
        },
    }
