"""
Template API routes: Template CRUD and URL generation for Drafter agent.
"""

from __future__ import annotations

import logging
from typing import Any, Dict

from fastapi import APIRouter, HTTPException

from services import draft_db
from services.gcs_signed_url import generate_signed_url

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Templates"])


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
) -> Dict[str, Any]:
    """
    List all templates with optional filtering.
    
    Query params:
    - category: Filter by category (e.g., "REAL ESTATE", "CORPORATE")
    - is_active: Filter by active status
    - limit: Number of templates to return
    - offset: Pagination offset
    - include_preview_url: Include signed preview image URLs
    """
    try:
        logger.info(f"[list_templates] category={category}, is_active={is_active}, limit={limit}")
        
        templates = draft_db.list_templates(
            category=category if category else None,
            is_active=is_active,
        )
        
        # Apply pagination
        paginated_templates = templates[offset:offset + limit]
        
        # Add preview URLs if requested
        if include_preview_url:
            for template in paginated_templates:
                bucket = template.get("preview_gcs_bucket")
                path = template.get("preview_gcs_path")
                signed_url = generate_signed_url(bucket, path) if bucket and path else None
                if not signed_url and bucket and path:
                    # Fallback for public buckets
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
async def get_template(template_id: str) -> Dict[str, Any]:
    """Get a specific template with its fields."""
    try:
        logger.info(f"[get_template] template_id={template_id}")
        
        # Get template basic info
        templates = draft_db.list_templates()
        template = next((t for t in templates if t.get("template_id") == template_id), None)
        
        if not template:
            raise HTTPException(status_code=404, detail="Template not found")
        
        # Get template fields
        fields = draft_db.get_template_fields(template_id)
        
        return {
            "success": True,
            "template": {
                **template,
                "fields": fields,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[get_template] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
