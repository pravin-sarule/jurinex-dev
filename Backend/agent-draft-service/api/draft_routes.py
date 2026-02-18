"""
Draft API routes: CRUD operations for drafts and section prompts management.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List

from fastapi import APIRouter, Body, Depends, HTTPException, BackgroundTasks

from api.deps import require_user_id
from services import draft_db, db as doc_db
from agents.ingestion.injection_agent import run_injection_agent

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
    """Get a specific draft with field data. Merges autopopulated values from template_user_field_values (InjectionAgent) with saved draft_field_data so form fields show agent-extracted values until user overwrites."""
    try:
        logger.info(f"[get_draft] draft_id={draft_id}, user_id={user_id}")
        
        draft = draft_db.get_user_draft(draft_id=draft_id, user_id=user_id)
        if not draft:
            raise HTTPException(status_code=404, detail="Draft not found")
        
        # Get field data (saved form state)
        field_data = draft_db.get_draft_field_data_for_retrieve(draft_id, user_id)
        draft_field_values = (field_data.get("field_values") or {}) if field_data else {}
        
        # Merge autopopulated values (InjectionAgent) so attach-case / upload autofill shows
        template_id = draft.get("template_id")
        if template_id:
            agent_row = draft_db.get_existing_user_field_values(
                str(template_id), user_id, draft_session_id=draft_id
            )
            if agent_row and agent_row.get("field_values"):
                agent_values = agent_row["field_values"]
                # Agent values as base; saved draft values override (user edits take precedence)
                merged = dict(agent_values)
                for k, v in draft_field_values.items():
                    if v is not None and str(v).strip() != "":
                        merged[k] = v
                draft_field_values = merged
        
        return {
            "success": True,
            "draft": {
                **draft,
                "field_values": draft_field_values,
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
    background_tasks: BackgroundTasks,
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
        
        # --- Auto-populate fields from case document ---
        try:
            # 1. Get draft to find template_id
            draft_info = draft_db.get_user_draft(draft_id, user_id)
            if draft_info and draft_info.get("template_id"):
                template_id = str(draft_info["template_id"])
                
                # 2. Find case document (best one with chunks)
                source_doc_id = doc_db.get_best_source_document(case_id, user_id)
                
                if source_doc_id:
                    logger.info(f"[attach_case] Triggering background auto-population from case file {source_doc_id}")
                    
                    payload = {
                        "template_id": template_id,
                        "user_id": user_id,
                        "draft_session_id": draft_id,
                        "source_document_id": source_doc_id,
                        # raw_text is None, so agent will fetch from DB using source_document_id
                    }
                    background_tasks.add_task(run_injection_agent, payload)
                else:
                    logger.warning(f"[attach_case] Case {case_id} has no valid files with content. Skipping auto-population.")
        except Exception as e:
            logger.error(f"[attach_case] Failed to trigger auto-population: {e}")
        
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

def _section_matches(s: dict, section_id: str, section_name: str) -> bool:
    """Match template section by section_id (UUID) or by section_key from section_name."""
    if not section_id and not section_name:
        return False
    sk = (s.get("section_key") or "").strip().lower()
    sid = s.get("section_id")
    key_from_name = (section_name or "").strip().lower().replace(" ", "_")
    id_str = (section_id or "").strip()
    if sid is not None and str(sid).lower() == id_str.lower():
        return True
    if sk and (sk == id_str.lower() or sk == key_from_name):
        return True
    return False


@router.get("/drafts/{draft_id}/sections/prompts")
async def get_draft_section_prompts_db(
    draft_id: str,
    user_id: int = Depends(require_user_id),
) -> Dict[str, Any]:
    """
    Get section prompts from dt_draft_section_prompts and enrich with default_prompt
    from template_analysis_sections.section_prompts (the real AI instructions), not section_intro.
    Frontend should display: custom_prompt if set, else default_prompt.
    """
    try:
        logger.info(f"[get_draft_section_prompts_db] draft_id={draft_id}")
        rows = draft_db.get_draft_section_prompts_list(draft_id)
        draft = draft_db.get_user_draft(draft_id, user_id)
        template_id = str(draft["template_id"]) if draft and draft.get("template_id") else None
        template_sections = draft_db.get_template_sections(template_id) if template_id else []
        out = []
        for r in rows:
            row = dict(r)
            default_prompt = ""
            section_id = row.get("section_id")
            section_name = row.get("section_name") or ""
            section_intro = ""
            for ts in template_sections:
                if _section_matches(ts, section_id, section_name):
                    default_prompt = (ts.get("default_prompt") or "").strip()
                    section_intro = (ts.get("section_intro") or "").strip()
                    break
            if not default_prompt and template_id:
                analysis = draft_db.get_template_analysis_sections(template_id)
                for sec in analysis:
                    if _section_matches(
                        {"section_key": sec.get("section_key"), "section_id": sec.get("id")},
                        section_id,
                        section_name,
                    ):
                        section_intro = (sec.get("section_intro") or "").strip()
                        prompts_list = sec.get("section_prompts") or []
                        if isinstance(prompts_list, list) and len(prompts_list) > 0:
                            default_prompt = (prompts_list[0].get("prompt") or "").strip()
                        elif isinstance(prompts_list, dict):
                            default_prompt = (prompts_list.get("prompt") or "").strip()
                        break
            row["default_prompt"] = default_prompt
            row["section_intro"] = section_intro
            out.append(row)
        return {"success": True, "prompts": out}
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


# --- Template User Field Values (InjectionAgent auto-populated values) ---

@router.get("/template-user-field-values")
async def get_template_user_field_values(
    template_id: str,
    draft_session_id: str = "",
    user_id: int = Depends(require_user_id),
) -> Dict[str, Any]:
    """
    Fetch auto-populated field values + user-edit tracking for a template.

    Used by the frontend Step 2 form to pre-fill inputs with values extracted
    by the InjectionAgent and to identify which fields the user has manually edited.

    Query params:
        template_id (required): The template being filled
        draft_session_id (optional): The draft session (maps to the draft)
    """
    try:
        sid = draft_session_id.strip() if draft_session_id else None
        logger.info(
            "[get_template_user_field_values] template_id=%s, user_id=%s, draft_session_id=%s",
            template_id, user_id, sid,
        )

        row = draft_db.get_existing_user_field_values(
            template_id=template_id,
            user_id=user_id,
            draft_session_id=sid,
        )

        if not row:
            return {
                "success": True,
                "field_values": {},
                "user_edited_fields": [],
                "filled_by": None,
                "extraction_status": None,
            }

        return {
            "success": True,
            "field_values": row.get("field_values", {}),
            "user_edited_fields": row.get("user_edited_fields", []),
            "filled_by": row.get("filled_by"),
            "extraction_status": row.get("extraction_status"),
        }
    except Exception as e:
        logger.exception("[get_template_user_field_values] Error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/template-user-field-values")
async def save_template_user_field_values(
    user_id: int = Depends(require_user_id),
    template_id: str = Body(..., embed=True),
    draft_session_id: str = Body(None, embed=True),
    field_values: Dict[str, Any] = Body(..., embed=True),
    user_edited_fields: List[str] = Body([], embed=True),
) -> Dict[str, Any]:
    """
    Save user-filled field values and the set of user-edited field keys.

    Called by the frontend when the user saves the Step 2 form.
    - field_values: the full set of form values
    - user_edited_fields: keys the user has manually touched (never shrinks)

    MERGE LOGIC: Fetches existing row first. Merges field_values (never drops
    existing agent-extracted values), accumulates user_edited_fields.
    """
    try:
        sid = draft_session_id.strip() if draft_session_id else None
        logger.info(
            "[save_template_user_field_values] template_id=%s, user_id=%s, "
            "draft_session_id=%s, fields=%d, user_edited=%d",
            template_id, user_id, sid, len(field_values), len(user_edited_fields),
        )

        # Guard: if frontend sends empty values and no edits, do nothing
        if not field_values and not user_edited_fields:
            logger.info("[save_template_user_field_values] Skipping empty save (no values, no edits)")
            return {"success": True, "message": "Nothing to save"}

        import json as _json
        uid = int(user_id)

        # Fetch existing row to merge (protect agent-extracted values)
        existing = draft_db.get_existing_user_field_values(
            template_id=template_id,
            user_id=uid,
            draft_session_id=sid,
        )

        # Merge field_values: start from existing, overlay with frontend values
        merged_values = {}
        if existing and existing.get("field_values"):
            merged_values = dict(existing["field_values"])
        # Overlay with new values from frontend (non-empty only)
        for k, v in field_values.items():
            if v is not None and str(v).strip() != "":
                merged_values[k] = v
            elif k not in merged_values:
                merged_values[k] = v  # Allow explicit null if no existing value

        # Accumulate user_edited_fields (never shrink)
        existing_edits = set(existing.get("user_edited_fields", [])) if existing else set()
        merged_edits = list(existing_edits | set(user_edited_fields))

        # Determine filled_by
        new_filled_by = 'user' if merged_edits else (existing.get("filled_by", "agent") if existing else "user")

        with draft_db.get_draft_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO template_user_field_values
                        (template_id, user_id, draft_session_id,
                         field_values, user_edited_fields, filled_by,
                         extraction_status, created_at, updated_at)
                    VALUES (%s, %s, %s, %s::jsonb, %s::jsonb, %s, 'completed', now(), now())
                    ON CONFLICT (template_id, user_id, draft_session_id)
                    DO UPDATE SET
                        field_values = EXCLUDED.field_values,
                        user_edited_fields = EXCLUDED.user_edited_fields,
                        filled_by = EXCLUDED.filled_by,
                        updated_at = now()
                    """,
                    (
                        template_id, uid, sid,
                        _json.dumps(merged_values),
                        _json.dumps(merged_edits),
                        new_filled_by,
                    ),
                )

        logger.info("[save_template_user_field_values] Upsert successful (merged %d values, %d edits)", len(merged_values), len(merged_edits))

        return {
            "success": True,
            "message": "Field values saved",
        }
    except Exception as e:
        logger.exception("[save_template_user_field_values] Error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
