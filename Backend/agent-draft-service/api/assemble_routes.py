"""
Assemble API: Combine all generated sections into final document.

POST /api/drafts/{draft_id}/assemble - Assemble all sections into final document
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List

from fastapi import APIRouter, Body, Depends, HTTPException

from api.deps import require_user_id
from services import draft_db
from api.orchestrator_helpers import get_orchestrator
from services.gcs_signed_url import generate_signed_url

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["assemble"])


@router.post("/drafts/{draft_id}/assemble")
async def assemble_document(
    draft_id: str,
    user_id: int = Depends(require_user_id),
    section_ids: List[str] = Body(..., embed=True),
) -> Dict[str, Any]:
    """
    Assemble all generated sections into a final document using Orchestrator.
    Uses caching: if sections haven't changed, returns the previously assembled document.
    """
    import hashlib
    import json
    
    logger.info("API: POST /api/drafts/%s/assemble — orchestrated assembly", draft_id)

    try:
        # 1. Get draft and verify ownership
        draft = draft_db.get_user_draft(draft_id, user_id)
        if not draft:
            raise HTTPException(status_code=404, detail="Draft not found")
        
        template_id = str(draft["template_id"])
        
        # 2. Get all active sections for this draft
        all_sections = draft_db.get_all_active_sections(draft_id, user_id)
        sections_map = {s["section_key"]: s for s in all_sections}
        ordered_sections = []
        
        for section_id in section_ids:
            if section_id in sections_map:
                ordered_sections.append(sections_map[section_id])
            else:
                logger.warning(f"Section {section_id} not found or not generated")
        
        if not ordered_sections:
            raise HTTPException(
                status_code=400,
                detail="No generated sections found for assembly. Please generate them first."
            )
        
        # 3. Calculate hash of current sections to detect changes
        sections_data = [
            {
                "key": s["section_key"],
                "content": s.get("content_html", ""),
                "is_required": s.get("is_required", False)
            }
            for s in ordered_sections
        ]
        
        # Create a deterministic hash of the sections
        sections_json = json.dumps(sections_data, sort_keys=True)
        current_hash = hashlib.sha256(sections_json.encode()).hexdigest()
        
        # 4. Check if we have a cached assembled document
        field_data = draft_db.get_draft_field_data_for_retrieve(draft_id, user_id)
        metadata = field_data.get("metadata", {}) if field_data else {}
        cached_assembly = metadata.get("assembled_cache", {})
        
        cached_hash = cached_assembly.get("sections_hash")
        cached_document = cached_assembly.get("final_document")
        cached_css = cached_assembly.get("template_css")
        cached_metadata = cached_assembly.get("metadata", {})
        
        # 5. If hash matches and we have a valid Google Doc (if template used), return cached version
        is_google_doc_valid = True
        if template_id and cached_metadata:
            # If we expect a Google Doc but don't have an iframe_url or have an error, cache is invalid
            if not cached_metadata.get("iframe_url") or (cached_metadata.get("google_docs") and "error" in str(cached_metadata.get("google_docs"))):
                is_google_doc_valid = False
                logger.info(f"[CACHE INVALID] Cached Google Doc for draft {draft_id} is missing or has error. Reassembling.")

        if cached_hash == current_hash and cached_document and is_google_doc_valid:
            logger.info(f"[CACHE HIT] Returning cached assembled document for draft {draft_id}")
            return {
                "success": True,
                "final_document": cached_document,
                "template_css": cached_css,
                "sections_assembled": len(ordered_sections),
                "cached": True,
                "agent_tasks": [],
                "google_docs": cached_metadata.get("google_docs"),
                "metadata": {
                    "template_id": template_id,
                    "section_keys": [s["key"] for s in sections_data],
                    "from_cache": True,
                    **cached_metadata
                }
            }
        
        logger.info(f"[CACHE MISS] Sections changed or no cache found, reassembling draft {draft_id}")
        
        # 6. Get template asset (URL)
        primary_asset = draft_db.get_template_primary_asset(template_id)
        template_url = None
        if primary_asset:
            template_url = generate_signed_url(
                primary_asset["gcs_bucket"],
                primary_asset["gcs_path"]
            )
        
        # 7. Run Orchestrator with Assembler
        orchestrator = get_orchestrator(ingestion_only=False, retrieve_only=False)
        
        # Get existing Google File ID from cache (if available) to update same document
        existing_google_file_id = cached_metadata.get("google_file_id")
        
        assemble_payload = {
            "draft_id": draft_id,
            "user_id": user_id,
            "template_id": template_id,
            "template_url": template_url,
            "field_values": draft.get("field_values", {}),
            "sections": sections_data,
            "existing_google_file_id": existing_google_file_id  # Pass to update existing doc
        }
        
        if existing_google_file_id:
            logger.info(f"[REASSEMBLY] Will update existing Google Doc: {existing_google_file_id}")
        else:
            logger.info(f"[NEW ASSEMBLY] Will create new Google Doc")
        
        print(f"[API → Orchestrator] Running assembly for draft {draft_id} with {len(ordered_sections)} sections")
        result = orchestrator.run(assemble_payload=assemble_payload)
        
        final_doc = result.get("final_document", "")
        if not final_doc:
            # Fallback to combined content if orchestrator/assembler fails to return a doc
            final_doc = "\n<!-- SECTION_BREAK -->\n".join([s.get("content_html", "") for s in ordered_sections])

        # 8. Get template CSS
        template_css = draft_db.get_template_css(template_id)
        css_content = template_css.get("css_content") if template_css else None
        
        # 9. Cache the assembled document
        assembly_metadata = {
            "template_id": template_id,
            "has_template_url": template_url is not None,
            "section_keys": [s["key"] for s in sections_data],
            "google_docs": result.get("google_docs"),
            **(result.get("metadata", {}) if isinstance(result.get("metadata"), dict) else {})
        }
        
        # Update metadata with cached assembly
        metadata["assembled_cache"] = {
            "sections_hash": current_hash,
            "final_document": final_doc,
            "template_css": css_content,
            "metadata": assembly_metadata,
            "assembled_at": str(__import__("datetime").datetime.now())
        }
        
        # Save updated metadata to database
        with draft_db.get_draft_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE draft_field_data 
                    SET metadata = %s::jsonb, updated_at = NOW()
                    WHERE draft_id = %s
                    """,
                    (json.dumps(metadata), draft_id),
                )
        
        logger.info(f"[CACHE SAVED] Cached assembled document for draft {draft_id}")

        return {
            "success": True,
            "final_document": final_doc,
            "template_css": css_content,
            "sections_assembled": len(ordered_sections),
            "cached": False,
            "agent_tasks": result.get("agent_tasks", []),
            "google_docs": result.get("google_docs"),
            "metadata": assembly_metadata
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("orchestrated_assemble failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/drafts/{draft_id}/export/docx")
async def export_to_docx(
    draft_id: str,
    user_id: int = Depends(require_user_id),
    body: Dict[str, Any] = Body(...),
):
    """
    Convert assembled HTML to a downloadable DOCX file.
    """
    import io
    from fastapi.responses import StreamingResponse
    try:
        from htmldocx import HtmlToDocx
        from docx import Document
    except ImportError:
        raise HTTPException(status_code=500, detail="html2docx or python-docx not installed on server.")

    html_content = body.get("html_content")
    if not html_content:
        raise HTTPException(status_code=400, detail="No html_content provided for export")

    try:
        document = Document()
        
        # Set Global Font to Times New Roman
        from docx.shared import Pt, Cm
        style = document.styles['Normal']
        font = style.font
        font.name = 'Times New Roman'
        font.size = Pt(12)
        
        # Set default font for all other styles too
        for s in document.styles:
            if hasattr(s, 'font'):
                s.font.name = 'Times New Roman'

        # Set A4 size (approx 21cm x 29.7cm)
        section = document.sections[0]
        section.page_height = Cm(29.7)
        section.page_width = Cm(21)
        section.left_margin = Cm(2.54)
        section.right_margin = Cm(2.54)
        section.top_margin = Cm(2.54)
        section.bottom_margin = Cm(2.54)
        
        parser = HtmlToDocx()
        
        # Split by section break marker
        # We don't want to show section names anymore as per user request
        content_parts = html_content.split('<!-- SECTION_BREAK -->')
        
        for i, part in enumerate(content_parts):
            clean_part = part.strip()
            if not clean_part:
                continue
            
            # Remove any residual internal UI wrappers if they exist
            # (The Assembler already removed the headers, but we double check for clean content)
            parser.add_html_to_document(clean_part, document)
            
            # Add page break if not the last part and not empty
            if i < len(content_parts) - 1:
                document.add_page_break()

        # Final pass on all paragraphs to force Times New Roman (Double Protection)
        for paragraph in document.paragraphs:
            for run in paragraph.runs:
                run.font.name = 'Times New Roman'
                
        # Save to stream
        file_stream = io.BytesIO()
        document.save(file_stream)
        file_stream.seek(0)

        filename = f"Draft_{draft_id}.docx"
        return StreamingResponse(
            file_stream,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )

    except Exception as e:
        logger.exception("DOCX export failed")
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")
