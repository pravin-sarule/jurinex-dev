"""
Draft API routes: CRUD operations for drafts and section prompts management.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List

from fastapi import APIRouter, Body, Depends, HTTPException

from api.deps import require_user_id
from services import draft_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Drafts"])


@router.post("/drafts/{draft_id}/section-prompts")
async def save_section_prompts(
    draft_id: str,
    user_id: int = Depends(require_user_id),
    prompts: Dict[str, str] = Body(..., embed=True),
) -> Dict[str, Any]:
    """
    Save user-edited section prompts to draft metadata.
    
    Prompts are stored in draft_field_data.metadata.section_prompts as:
    {
      "document_information": "custom prompt...",
      "parties": "custom prompt...",
      ...
    }
    """
    try:
        logger.info(f"[save_section_prompts] draft_id={draft_id}, user_id={user_id}, prompts_count={len(prompts)}")
        
        # Get current draft metadata
        draft_data = draft_db.get_draft_field_data_for_retrieve(draft_id, user_id)
        if not draft_data:
            raise HTTPException(status_code=404, detail="Draft not found")
        
        # Update metadata with section prompts
        metadata = dict(draft_data.get("metadata", {}))
        metadata["section_prompts"] = prompts
        
        # Save updated metadata
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
        
        logger.info(f"[save_section_prompts] Saved {len(prompts)} prompts for draft {draft_id}")
        
        return {
            "success": True,
            "message": f"Saved {len(prompts)} section prompts",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[save_section_prompts] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/drafts/{draft_id}/section-prompts")
async def get_section_prompts(
    draft_id: str,
    user_id: int = Depends(require_user_id),
) -> Dict[str, Any]:
    """
    Get saved section prompts from draft metadata.
    
    Returns:
      {
        "success": true,
        "prompts": {
          "document_information": "custom prompt...",
          ...
        }
      }
    """
    try:
        logger.info(f"[get_section_prompts] draft_id={draft_id}, user_id={user_id}")
        
        draft_data = draft_db.get_draft_field_data_for_retrieve(draft_id, user_id)
        if not draft_data:
            return {"success": True, "prompts": {}}
        
        metadata = draft_data.get("metadata", {})
        prompts = metadata.get("section_prompts", {})
        
        logger.info(f"[get_section_prompts] Found {len(prompts)} saved prompts")
        
        return {
            "success": True,
            "prompts": prompts,
        }
    except Exception as e:
        logger.exception(f"[get_section_prompts] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/drafts")
async def create_draft(
    user_id: int = Depends(require_user_id),
    template_id: str = Body(..., embed=True),
    draft_title: str = Body(None, embed=True),
) -> Dict[str, Any]:
    """Create a new draft from a template."""
    try:
        logger.info(f"[create_draft] user_id={user_id}, template_id={template_id}")
        
        draft = draft_db.create_user_draft(
            user_id=user_id,
            template_id=template_id,
            draft_title=draft_title or "Untitled Draft",
        )
        
        return {
            "success": True,
            "draft": draft,
        }
    except Exception as e:
        logger.exception(f"[create_draft] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/drafts")
async def list_drafts(
    user_id: int = Depends(require_user_id),
    limit: int = 20,
    offset: int = 0,
) -> Dict[str, Any]:
    """List user's drafts."""
    try:
        logger.info(f"[list_drafts] user_id={user_id}, limit={limit}, offset={offset}")
        
        drafts = draft_db.list_user_drafts(user_id=user_id)
        
        # Apply pagination
        paginated_drafts = drafts[offset:offset + limit]
        
        return {
            "success": True,
            "drafts": paginated_drafts,
            "total": len(drafts),
            "limit": limit,
            "offset": offset,
        }
    except Exception as e:
        logger.exception(f"[list_drafts] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/drafts/{draft_id}")
async def get_draft(
    draft_id: str,
    user_id: int = Depends(require_user_id),
) -> Dict[str, Any]:
    """Get a specific draft with field data."""
    try:
        logger.info(f"[get_draft] draft_id={draft_id}, user_id={user_id}")
        
        draft = draft_db.get_user_draft(draft_id=draft_id, user_id=user_id)
        if not draft:
            raise HTTPException(status_code=404, detail="Draft not found")
        
        # Get field data
        field_data = draft_db.get_draft_field_data_for_retrieve(draft_id, user_id)
        
        return {
            "success": True,
            "draft": {
                **draft,
                "field_values": field_data.get("field_values", {}) if field_data else {},
                "metadata": field_data.get("metadata", {}) if field_data else {},
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[get_draft] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/drafts/{draft_id}")
async def update_draft(
    draft_id: str,
    user_id: int = Depends(require_user_id),
    field_values: Dict[str, Any] = Body(None, embed=True),
    draft_title: str = Body(None, embed=True),
) -> Dict[str, Any]:
    """Update draft field values or title."""
    try:
        logger.info(f"[update_draft] draft_id={draft_id}, user_id={user_id}")
        
        # Update field values if provided
        if field_values is not None:
            draft_db.update_draft_field_data(
                draft_id=draft_id,
                user_id=user_id,
                field_values=field_values,
            )
        
        # Update title if provided
        if draft_title:
            draft_db.rename_draft(
                draft_id=draft_id,
                user_id=user_id,
                new_title=draft_title,
            )
        
        return {
            "success": True,
            "message": "Draft updated successfully",
        }
    except Exception as e:
        logger.exception(f"[update_draft] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/drafts/{draft_id}")
async def delete_draft(
    draft_id: str,
    user_id: int = Depends(require_user_id),
) -> Dict[str, Any]:
    """Delete a draft."""
    try:
        logger.info(f"[delete_draft] draft_id={draft_id}, user_id={user_id}")
        
        success = draft_db.delete_draft(draft_id=draft_id, user_id=user_id)
        if not success:
            raise HTTPException(status_code=404, detail="Draft not found")
        
        return {
            "success": True,
            "message": "Draft deleted successfully",
        }
    except HTTPException:
        raise


@router.post("/drafts/{draft_id}/attach-case")
async def attach_case_to_draft_endpoint(
    draft_id: str,
    user_id: int = Depends(require_user_id),
    case_id: str = Body(..., embed=True),
    case_title: str = Body(None, embed=True),
) -> Dict[str, Any]:
    """
    Attach a case to the draft for context in section generation.
    
    The case_id is stored in draft_field_data.metadata so the Drafter agent
    can use it to retrieve relevant case information.
    
    Body:
      - case_id: ID of the case to attach (required)
      - case_title: Optional title of the case
    """
    try:
        logger.info(f"[attach_case_to_draft] draft_id={draft_id}, case_id={case_id}")
        
        # Verify draft exists and user owns it
        draft = draft_db.get_user_draft(draft_id, user_id)
        if not draft:
            raise HTTPException(status_code=404, detail="Draft not found")
        
        # Attach case to draft
        success = draft_db.attach_case_to_draft(
            draft_id=draft_id,
            user_id=user_id,
            case_id=case_id,
            case_title=case_title,
        )
        
        if not success:
            raise HTTPException(status_code=500, detail="Failed to attach case")
        
        logger.info(f"[attach_case_to_draft] Successfully attached case {case_id} to draft {draft_id}")
        
        return {
            "success": True,
            "message": "Case attached successfully",
            "case_id": case_id,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[attach_case_to_draft] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# --- New Section Prompts Endpoints (Table-based) ---

@router.get("/drafts/{draft_id}/sections/prompts")
async def get_draft_section_prompts_db(
    draft_id: str,
    user_id: int = Depends(require_user_id),
) -> Dict[str, Any]:
    """Get section prompts from the SQL table (dt_draft_section_prompts)."""
    try:
        logger.info(f"[get_draft_section_prompts_db] draft_id={draft_id}")
        rows = draft_db.get_draft_section_prompts_list(draft_id)
        # Convert snake_case rows to camelCase for frontend if needed? 
        # Frontend uses "custom_prompt" in PHP/SQL side usually, but let's check frontend usage.
        # DraftFormPage.jsx uses response to setSectionPrompts.
        # Actually draftApi.ts expects `response.data.prompts` which is the array.
        return {"success": True, "prompts": rows}
    except Exception as e:
        logger.exception(f"[get_draft_section_prompts_db] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))



@router.post("/drafts/{draft_id}/sections/prompts")
async def upsert_draft_section_prompt_db(
    draft_id: str,
    sectionId: str = Body(...),
    customPrompt: str = Body(None),
    isDeleted: bool = Body(False),
    detailLevel: str = Body(None),
    language: str = Body(None),
    sectionName: str = Body(None),
    sectionType: str = Body(None),
    sortOrder: int = Body(None),
    user_id: int = Depends(require_user_id),
) -> Dict[str, Any]:
    """Upsert a single section prompt into SQL table with detail level, language, name and type."""
    try:
        logger.info(f"[upsert_draft_section_prompt_db] draft_id={draft_id}, section={sectionId}, deleted={isDeleted}, detail={detailLevel}, lang={language}, name={sectionName}, type={sectionType}, sortOrder={sortOrder}")
        result = draft_db.upsert_draft_section_prompt(
            draft_id, 
            sectionId, 
            customPrompt, 
            isDeleted,
            detail_level=detailLevel,
            language=language,
            section_name=sectionName,
            section_type=sectionType,
            sort_order=sortOrder
        )
        return {"success": True, "prompt": result}
    except Exception as e:
        logger.exception(f"[upsert_draft_section_prompt_db] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/drafts/{draft_id}/sections/order")
async def save_section_order_endpoint(
    draft_id: str,
    sectionIds: List[str] = Body(..., embed=True),
    user_id: int = Depends(require_user_id),
) -> Dict[str, Any]:
    """
    Save the display order of sections.
    Body: { "sectionIds": ["s1", "s2", "s3"] }
    """
    try:
        logger.info(f"[save_section_order] draft_id={draft_id}, order={sectionIds[:5]}...")
        
        # Convert list of IDs to list of dicts with sort_order
        section_orders = [
            {"section_id": sid, "sort_order": idx} 
            for idx, sid in enumerate(sectionIds)
        ]
        
        success = draft_db.update_draft_section_orders(draft_id, section_orders)
        
        return {
            "success": success,
            "message": "Section order saved successfully"
        }
    except Exception as e:
        logger.exception(f"[save_section_order] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/drafts/{draft_id}/rename")
async def rename_draft_endpoint(
    draft_id: str,
    new_title: str = Body(..., embed=True),
    user_id: int = Depends(require_user_id),
) -> Dict[str, Any]:
    """Rename a draft."""
    try:
        success = draft_db.rename_draft(draft_id, user_id, new_title)
        if not success:
            raise HTTPException(status_code=404, detail="Draft not found or unauthorized")
        return {"success": True, "message": "Draft renamed successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Rename failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/drafts/{draft_id}/uploaded-file")
async def add_uploaded_file_to_draft(
    draft_id: str,
    user_id: int = Depends(require_user_id),
    file_id: str = Body(None, embed=True),
    body: Dict[str, Any] = Body(None),
) -> Dict[str, Any]:
    """
    Add an uploaded file to a draft.
    This endpoint is called by the frontend after a file is uploaded.
    Accepts file_id from either {"file_id": "..."} or direct body.
    """
    try:
        # Try to get file_id from either parameter or body
        actual_file_id = file_id
        if not actual_file_id and body:
            actual_file_id = body.get("file_id") or body.get("fileId")
        
        if not actual_file_id:
            raise HTTPException(status_code=400, detail="file_id is required")
        
        logger.info(f"[add_uploaded_file] draft_id={draft_id}, file_id={actual_file_id}, user_id={user_id}")
        
        # Link the file to the draft
        draft_db.add_uploaded_file_id_to_draft(
            draft_id=draft_id,
            user_id=user_id,
            file_id=actual_file_id,
        )
        
        logger.info(f"[add_uploaded_file] Successfully linked file {actual_file_id} to draft {draft_id}")
        
        return {
            "success": True,
            "message": "File linked to draft successfully",
            "file_id": actual_file_id,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[add_uploaded_file] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/drafts/{draft_id}/link-file")
async def link_file_to_draft(
    draft_id: str,
    file_id: str = Body(..., embed=True),
    user_id: int = Depends(require_user_id),
) -> Dict[str, Any]:
    """
    Link an existing file to a draft.
    This is an alias for the uploaded-file endpoint for compatibility.
    """
    try:
        logger.info(f"[link_file] draft_id={draft_id}, file_id={file_id}, user_id={user_id}")
        
        # Link the file to the draft
        draft_db.add_uploaded_file_id_to_draft(
            draft_id=draft_id,
            user_id=user_id,
            file_id=file_id,
        )
        
        logger.info(f"[link_file] Successfully linked file {file_id} to draft {draft_id}")
        
        return {
            "success": True,
            "message": "File linked to draft successfully",
            "file_id": file_id,
        }
    except Exception as e:
        logger.exception(f"[link_file] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
