"""
Template API routes: Template CRUD and URL generation for Drafter agent.
"""

from __future__ import annotations

import logging
import os
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException

from api.deps import optional_user_id
from services import draft_db
from services.gcs_signed_url import generate_signed_url, generate_signed_url_from_gs

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Templates"])


def _is_uuid(value: str) -> bool:
    """True if value looks like a UUID (user-uploaded template from Template Analyzer)."""
    if not value or len(value) < 30:
        return False
    try:
        uuid.UUID(value.strip())
        return True
    except (ValueError, AttributeError):
        return False


def _get_template_analyzer_base_url() -> str:
    """Template Analyzer base URL; default to localhost:5017 for local dev."""
    url = (os.environ.get("TEMPLATE_ANALYZER_URL") or "http://localhost:5017").strip().rstrip("/")
    return url


def _fetch_user_template_from_analyzer(
    template_id: str,
    user_id: Optional[int],
) -> Optional[Dict[str, Any]]:
    """
    Fetch a user-uploaded template from Template Analyzer API.
    Returns dict with template info, fields, and sections (same shape as get_template), or None.
    """
    if user_id is None:
        return None
    base_url = _get_template_analyzer_base_url()
    if not base_url:
        return None
    url = f"{base_url}/analysis/template/{template_id}"
    headers = {"X-User-Id": str(user_id)}
    try:
        import json as _json
        import urllib.request
        req = urllib.request.Request(url, headers=headers, method="GET")
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read().decode()
        payload = _json.loads(data)
    except Exception as e:
        logger.warning("[get_template] Template Analyzer API failed for %s: %s", template_id, e)
        return None
    if not isinstance(payload, dict):
        return None
    t = payload.get("template")
    if not t:
        return None
    # Build template dict in draft-service shape (template_id, name, description, category, fields, sections)
    template_obj = t if isinstance(t, dict) else {}
    section_list = payload.get("sections") or []
    sections_out = []
    for idx, sec in enumerate(section_list):
        if not isinstance(sec, dict):
            continue
        section_name = sec.get("section_name") or "Untitled"
        section_key = (section_name or "").lower().replace(" ", "_").replace("-", "_") or f"section_{idx}"
        prompts = sec.get("section_prompts") or []
        default_prompt = ""
        if isinstance(prompts, list) and len(prompts) > 0:
            first = prompts[0]
            default_prompt = (first.get("prompt") or "") if isinstance(first, dict) else ""
        sections_out.append({
            "section_id": str(sec.get("id", "")),
            "section_key": section_key,
            "section_name": section_name,
            "section_purpose": sec.get("section_purpose"),
            "default_prompt": default_prompt,
            "sort_order": sec.get("order_index", idx),
            "is_required": True,
        })
    fields = payload.get("fields") if isinstance(payload.get("fields"), dict) else {}
    return {
        "template_id": str(template_obj.get("template_id", template_id)),
        "name": template_obj.get("template_name") or template_obj.get("name") or "Untitled",
        "description": template_obj.get("description"),
        "category": template_obj.get("category"),
        "sub_category": template_obj.get("sub_category"),
        "language": template_obj.get("language", "en"),
        "status": template_obj.get("status", "active"),
        "is_active": True,
        "fields": fields,
        "sections": sections_out,
        "preview_image_url": template_obj.get("image_url"),
    }


@router.get("/templates/{template_id}/url")
async def get_template_url(template_id: str) -> Dict[str, Any]:
    """
    Get signed GCS URL for template HTML content.
    Used by Drafter agent for visual reference (multimodal generation).
    
    TODO: Implement GCS signed URL generation:
    1. Fetch template_html.gcs_path from Draft_DB
    2. Generate signed URL from GCS with expiry
    3. Return signed URL
    
    For now, returns a placeholder URL.
    """
    try:
        logger.info(f"[get_template_url] template_id={template_id}")
        
        # TODO: Implement actual GCS URL signing
        # from services import gcs_client
        # gcs_path = fetch_template_html_path(template_id)
        # signed_url = gcs_client.generate_signed_url(gcs_path, expires_in=3600)
        
        # Placeholder for development
        template_url = f"gs://draft-templates/templates/{template_id}.html"
        
        logger.warning(f"[get_template_url] Returning placeholder URL: {template_url}")
        
        return {
            "success": True,
            "template_url": template_url,
            "expires_in": 3600,  # 1 hour
            "message": "Template URL - implement GCS signing for production",
        }
    except Exception as e:
        logger.exception(f"[get_template_url] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/templates")
async def list_templates(
    category: str = "",
    is_active: bool = True,
    limit: int = 50,
    offset: int = 0,
    include_preview_url: bool = False,
    finalized_only: bool = False,
) -> Dict[str, Any]:
    """
    List all templates with optional filtering.
    
    Query params:
    - category: Filter by category (e.g., "REAL ESTATE", "CORPORATE")
    - is_active: Filter by active status
    - limit: Number of templates to return
    - offset: Pagination offset
    - include_preview_url: Include signed preview image URLs
    - finalized_only: When True, return only templates ready for drafting (status finalized or active)
    """
    try:
        logger.info(f"[list_templates] category={category}, is_active={is_active}, finalized_only={finalized_only}, limit={limit}")
        
        templates = draft_db.list_templates(
            category=category if category else None,
            is_active=is_active if not finalized_only else True,
            finalized_only=finalized_only,
        )
        
        # Apply pagination
        paginated_templates = templates[offset:offset + limit]
        
        # Add preview URLs if requested
        if include_preview_url:
            for template in paginated_templates:
                bucket = template.get("preview_gcs_bucket")
                path = template.get("preview_gcs_path")
                signed_url = None
                if bucket and path:
                    signed_url = generate_signed_url(bucket, path)
                    if not signed_url:
                        signed_url = f"https://storage.googleapis.com/{bucket}/{path}"
                if not signed_url:
                    # Fallback: templates.image_url (gs://...) - used when admin stores image in templates table
                    gs_url = template.get("template_image_url")
                    if gs_url and str(gs_url).strip().startswith("gs://"):
                        signed_url = generate_signed_url_from_gs(str(gs_url))
                if not signed_url:
                    # Fallback: first image asset from template_assets
                    fallback = draft_db.get_preview_from_assets(str(template.get("template_id", "")))
                    if fallback:
                        bucket = fallback.get("gcs_bucket")
                        path = fallback.get("gcs_path")
                        signed_url = generate_signed_url(bucket, path) if bucket and path else None
                        if not signed_url and bucket and path:
                            signed_url = f"https://storage.googleapis.com/{bucket}/{path}"
                template["preview_image_url"] = signed_url
        
        return {
            "success": True,
            "templates": paginated_templates,
            "total": len(templates),
            "limit": limit,
            "offset": offset,
        }
    except Exception as e:
        logger.exception(f"[list_templates] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/templates/{template_id}")
async def get_template(
    template_id: str,
    include_sections: bool = False,
    include_preview_url: bool = False,
    x_user_id: Optional[str] = Header(None, alias="X-User-Id"),
    user_id: Optional[int] = Depends(optional_user_id),
) -> Dict[str, Any]:
    """
    Get a specific template with its fields.
    Admin templates: from draft DB. User-uploaded (UUID) templates: from Template Analyzer when not in draft DB.
    Use include_sections=true and include_preview_url=true to get sections and preview image URL.
    """
    try:
        logger.info(f"[get_template] template_id={template_id}")
        analyzer_user_id = user_id
        if analyzer_user_id is None and x_user_id is not None:
            try:
                analyzer_user_id = int(x_user_id)
            except (ValueError, TypeError):
                pass

        # 1) Try draft DB (admin templates)
        templates = draft_db.list_templates()
        template = next((t for t in templates if str(t.get("template_id")) == template_id), None)
        if template:
            fields = draft_db.get_template_fields_with_fallback(template_id)
            out = {**template, "fields": fields}
            if include_sections:
                sections = draft_db.get_template_sections(template_id)
                out["sections"] = sections
            if include_preview_url:
                bucket = template.get("preview_gcs_bucket")
                path = template.get("preview_gcs_path")
                signed = None
                if bucket and path:
                    signed = generate_signed_url(bucket, path)
                    if not signed:
                        signed = f"https://storage.googleapis.com/{bucket}/{path}"
                if not signed:
                    gs_url = template.get("template_image_url")
                    if gs_url and str(gs_url).strip().startswith("gs://"):
                        signed = generate_signed_url_from_gs(str(gs_url))
                if not signed:
                    fallback = draft_db.get_preview_from_assets(template_id)
                    if fallback:
                        bucket = fallback.get("gcs_bucket")
                        path = fallback.get("gcs_path")
                        signed = generate_signed_url(bucket, path) if bucket and path else None
                        if not signed and bucket and path:
                            signed = f"https://storage.googleapis.com/{bucket}/{path}"
                out["preview_image_url"] = signed
            return {"success": True, "template": out}
        # 2) User-uploaded (UUID): fetch from Template Analyzer (requires user context)
        if _is_uuid(template_id):
            if analyzer_user_id is None:
                raise HTTPException(
                    status_code=401,
                    detail="User context required for user-uploaded templates. Send Authorization: Bearer <token> or X-User-Id header.",
                )
            user_tpl = _fetch_user_template_from_analyzer(template_id, analyzer_user_id)
            if user_tpl:
                out = {
                    "template_id": user_tpl["template_id"],
                    "name": user_tpl["name"],
                    "description": user_tpl.get("description"),
                    "category": user_tpl.get("category"),
                    "sub_category": user_tpl.get("sub_category"),
                    "language": user_tpl.get("language"),
                    "status": user_tpl.get("status"),
                    "is_active": user_tpl.get("is_active", True),
                    "fields": user_tpl.get("fields", {}),
                }
                if include_sections:
                    out["sections"] = user_tpl.get("sections", [])
                if include_preview_url and user_tpl.get("preview_image_url"):
                    out["preview_image_url"] = user_tpl["preview_image_url"]
                logger.info("[get_template] Served user template from Template Analyzer: %s", template_id)
                return {"success": True, "template": out}
        raise HTTPException(status_code=404, detail="Template not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[get_template] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
@router.get("/templates/{template_id}/preview-image")
async def get_template_preview_image(
    template_id: str,
    x_user_id: Optional[str] = Header(None, alias="X-User-Id"),
    user_id: Optional[int] = Depends(optional_user_id),
) -> Dict[str, Any]:
    """
    Get signed preview image URL for a template.
    Admin templates: from template_images (GCS). User templates: from Template Analyzer (image_url).
    Use in frontend as <img src="{preview_image_url}" />.
    """
    try:
        analyzer_user_id = user_id
        if analyzer_user_id is None and x_user_id is not None:
            try:
                analyzer_user_id = int(x_user_id)
            except (ValueError, TypeError):
                pass

        # 1) Admin template: template_images -> templates.image_url -> template_assets
        preview = draft_db.get_preview_image_for_template(template_id)
        if preview:
            bucket = preview.get("gcs_bucket")
            path = preview.get("gcs_path")
            signed_url = generate_signed_url(bucket, path) if bucket and path else None
            if not signed_url and bucket and path:
                signed_url = f"https://storage.googleapis.com/{bucket}/{path}"
            if signed_url:
                return {"success": True, "preview_image_url": signed_url}
        gs_url = draft_db.get_template_image_url(template_id)
        if gs_url and gs_url.startswith("gs://"):
            signed_url = generate_signed_url_from_gs(gs_url)
            if signed_url:
                return {"success": True, "preview_image_url": signed_url}
        preview = draft_db.get_preview_from_assets(template_id)
        if preview:
            bucket = preview.get("gcs_bucket")
            path = preview.get("gcs_path")
            signed_url = generate_signed_url(bucket, path) if bucket and path else None
            if not signed_url and bucket and path:
                signed_url = f"https://storage.googleapis.com/{bucket}/{path}"
            if signed_url:
                return {"success": True, "preview_image_url": signed_url}

        # 2) User template (UUID): from Template Analyzer
        if _is_uuid(template_id) and analyzer_user_id is not None:
            user_tpl = _fetch_user_template_from_analyzer(template_id, analyzer_user_id)
            if user_tpl and user_tpl.get("preview_image_url"):
                return {"success": True, "preview_image_url": user_tpl["preview_image_url"]}

        return {"success": False, "preview_image_url": None, "message": "No preview image available"}
    except Exception as e:
        logger.exception("[get_template_preview_image] Error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/templates/{template_id}/fields")
async def get_template_fields(template_id: str) -> Dict[str, Any]:
    """Get fields for a specific template."""
    try:
        logger.info(f"[get_template_fields] template_id={template_id}")
        
        fields = draft_db.get_template_fields_with_fallback(template_id)
        
        return {
            "success": True,
            "fields": fields,
        }
    except Exception as e:
        logger.exception(f"[get_template_fields] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/templates/{template_id}/analysis-sections")
async def get_template_analysis_sections_endpoint(template_id: str) -> Dict[str, Any]:
    """
    Fetch section prompts from template_analysis_sections for this template.
    Returns: id, template_id, section_name, section_purpose, section_intro,
    section_prompts (JSONB array of {prompt, field_id}), order_index, is_active,
    created_at, updated_at, and section_key (derived from section_name).
    """
    try:
        logger.info("[get_template_analysis_sections] template_id=%s", template_id)
        rows = draft_db.get_template_analysis_sections(template_id)
        # Make JSON-serializable (e.g. UUID and datetime)
        out = []
        for r in rows:
            item = dict(r)
            for k in ("created_at", "updated_at"):
                if k in item and hasattr(item[k], "isoformat"):
                    item[k] = item[k].isoformat()
            if "id" in item and item["id"] is not None:
                item["id"] = str(item["id"])
            out.append(item)
        return {"success": True, "template_id": template_id, "sections": out}
    except Exception as e:
        logger.exception("[get_template_analysis_sections] Error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
