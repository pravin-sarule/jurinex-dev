"""
Template API routes: Template CRUD and URL generation for Drafter agent.
"""

from __future__ import annotations

import logging
import os
import uuid
import io
import base64
import json as _json
from typing import Any, Dict, Optional
from urllib.error import HTTPError, URLError

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


def _get_template_analyzer_base_urls() -> list[str]:
    """Return analyzer base URLs in fallback order for local development."""
    configured = (os.environ.get("TEMPLATE_ANALYZER_URL") or "").strip().rstrip("/")
    candidates = [
        configured,
        "http://localhost:5017",
        "http://localhost:8002",
    ]
    out: list[str] = []
    for item in candidates:
        if item and item not in out:
            out.append(item)
    return out


def _fetch_user_template_from_analyzer(
    template_id: str,
    user_id: Optional[int],
) -> tuple[Optional[Dict[str, Any]], Optional[str], Optional[int]]:
    """
    Fetch a user-uploaded template from Template Analyzer API.
    Returns:
      (template_dict, error_message, status_code)
    where template_dict is populated on success, otherwise None.
    """
    if user_id is None:
        return None, "Missing user context", None
    base_urls = _get_template_analyzer_base_urls()
    if not base_urls:
        return None, "Template Analyzer URL is not configured", None
    headers = {"X-User-Id": str(user_id)}
    payload = None
    last_error = None
    last_status = None
    for base_url in base_urls:
        url = f"{base_url}/analysis/template/{template_id}"
        try:
            import json as _json
            import urllib.request
            req = urllib.request.Request(url, headers=headers, method="GET")
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = resp.read().decode()
            payload = _json.loads(data)
            break
        except HTTPError as e:
            logger.warning("[get_template] Template Analyzer HTTP %s for %s via %s: %s", e.code, template_id, base_url, e)
            last_error = str(e)
            last_status = e.code
            if e.code not in {404, 503}:
                return None, last_error, last_status
        except URLError as e:
            logger.warning("[get_template] Template Analyzer API failed for %s via %s: %s", template_id, base_url, e)
            last_error = str(e)
            last_status = None
        except Exception as e:
            logger.warning("[get_template] Template Analyzer API failed for %s via %s: %s", template_id, base_url, e)
            last_error = str(e)
            last_status = None
    if payload is None:
        return None, last_error, last_status
    if not isinstance(payload, dict):
        return None, "Template Analyzer returned invalid payload", None
    t = payload.get("template")
    if not t:
        return None, "Template not found in analyzer response", 404
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
    # Template Analyzer may return the complete schema at the top level as
    # `all_fields` / `hybrid_fields`, while `sections[*].fields` can be partial
    # or repetitive. Feed the whole payload into the normalizer so it can pick
    # the richest field source.
    raw_fields = payload
    fields = (
        draft_db._parse_template_fields_json(
            raw_fields,
            str(template_obj.get("template_id", template_id)),
        )
        if raw_fields is not None
        else []
    )
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
    }, None, 200


def _fetch_user_template_payload_from_analyzer(
    template_id: str,
    user_id: int,
) -> tuple[Optional[Dict[str, Any]], Optional[str], Optional[int]]:
    """Fetch full raw payload from Template Analyzer for a UUID template."""
    base_urls = _get_template_analyzer_base_urls()
    if not base_urls:
        return None, "Template Analyzer URL is not configured", None
    headers = {"X-User-Id": str(user_id)}
    payload = None
    last_error = None
    last_status = None
    for base_url in base_urls:
        url = f"{base_url}/analysis/template/{template_id}"
        try:
            import urllib.request
            req = urllib.request.Request(url, headers=headers, method="GET")
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = resp.read().decode()
            payload = _json.loads(data)
            break
        except HTTPError as e:
            logger.warning("[template_content] Analyzer HTTP %s for %s via %s: %s", e.code, template_id, base_url, e)
            last_error = str(e)
            last_status = e.code
            if e.code not in {404, 503}:
                return None, last_error, last_status
        except URLError as e:
            logger.warning("[template_content] Analyzer unreachable for %s via %s: %s", template_id, base_url, e)
            last_error = str(e)
            last_status = None
        except Exception as e:
            logger.warning("[template_content] Analyzer payload fetch failed for %s via %s: %s", template_id, base_url, e)
            last_error = str(e)
            last_status = None
    if payload is None:
        return None, last_error, last_status
    if not isinstance(payload, dict):
        return None, "Template Analyzer returned invalid payload", None
    return payload, None, 200


def _resolve_template_text_from_analyzer_payload(payload: Dict[str, Any]) -> str:
    """Extract best-effort template text from Analyzer payload."""
    template_obj = payload.get("template") if isinstance(payload.get("template"), dict) else {}
    fields_obj = payload.get("fields") if isinstance(payload.get("fields"), dict) else {}
    candidates = [
        # Direct fields JSONB keys (stored by upload endpoint immediately)
        fields_obj.get("original_template_text"),
        fields_obj.get("template_text"),
        fields_obj.get("extracted_text"),
        fields_obj.get("templateText"),
        # Template object keys
        template_obj.get("template_text"),
        template_obj.get("extracted_text"),
        template_obj.get("templateText"),
    ]
    for candidate in candidates:
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return ""


def _extract_text_from_gs_text(gs_uri: str) -> str:
    """Download a gs:// text/html asset and return text content."""
    if not gs_uri or not gs_uri.startswith("gs://"):
        return ""
    try:
        from services.template_format import fetch_template_html
        return (fetch_template_html(gs_uri) or "").strip()
    except Exception as e:
        logger.warning("[template_content] Failed gs text extraction for %s: %s", gs_uri, e)
        return ""


def _extract_text_from_gs_pdf(gs_uri: str) -> str:
    """Download a gs:// PDF and extract text using pypdf as fallback."""
    if not gs_uri or not gs_uri.startswith("gs://"):
        return ""
    try:
        rest = gs_uri[5:].strip()
        if "/" not in rest:
            return ""
        bucket_name, _, blob_path = rest.partition("/")
        if not bucket_name or not blob_path:
            return ""

        from google.cloud import storage
        if os.environ.get("GCS_KEY_BASE64"):
            from google.oauth2 import service_account
            content = base64.b64decode(os.environ["GCS_KEY_BASE64"]).decode("utf-8")
            info = _json.loads(content)
            creds = service_account.Credentials.from_service_account_info(info)
            client = storage.Client(credentials=creds, project=info.get("project_id"))
        else:
            client = storage.Client()

        blob = client.bucket(bucket_name).blob(blob_path)
        data = blob.download_as_bytes()
        if not data:
            return ""

        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        parts = []
        for page in reader.pages:
            parts.append((page.extract_text() or "").strip())
        return "\n".join([p for p in parts if p]).strip()
    except Exception as e:
        logger.warning("[template_content] Failed gs PDF text extraction for %s: %s", gs_uri, e)
        return ""


def _extract_text_from_gs_asset(gs_uri: str) -> str:
    """Best-effort extraction for gs:// assets used as template sources."""
    uri = (gs_uri or "").strip()
    if not uri.startswith("gs://"):
        return ""

    lower = uri.lower()
    if lower.endswith(".pdf"):
        return _extract_text_from_gs_pdf(uri)

    # Generated/custom templates often store a companion .txt or .html asset.
    text = _extract_text_from_gs_text(uri)
    if text:
        return text

    return ""


@router.get("/templates/{template_id}/content")
async def get_template_html_content(
    template_id: str,
    user_id: Optional[int] = Depends(optional_user_id),
    x_user_id: Optional[str] = Header(None, alias="X-User-Id"),
) -> Dict[str, Any]:
    """
    Return the full HTML content for a template.
    Priority:
      1. template_html table (html_content column)
      2. template_assets — first HTML/DOCX asset fetched via GCS (gs:// path)
    Used by chat-draft-backend automatic mode to feed template to the LLM.
    """
    try:
        if _is_uuid(template_id):
            resolved_user_id: Optional[int] = user_id
            if resolved_user_id is None and x_user_id:
                try:
                    resolved_user_id = int(str(x_user_id).strip())
                except ValueError:
                    resolved_user_id = None

            if resolved_user_id is None:
                return {
                    "success": False,
                    "html": "",
                    "source": "none",
                    "message": "User context required for custom template content",
                }

            payload, err, status = _fetch_user_template_payload_from_analyzer(template_id, resolved_user_id)
            if payload:
                text = _resolve_template_text_from_analyzer_payload(payload)
                if text:
                    return {"success": True, "html": text, "source": "analyzer_text"}

                template_obj = payload.get("template") if isinstance(payload.get("template"), dict) else {}
                fields_obj = payload.get("fields") if isinstance(payload.get("fields"), dict) else {}
                gs_candidates = [
                    fields_obj.get("generated_template_txt_gcs_uri"),
                    fields_obj.get("generated_template_pdf_gcs_uri"),
                    template_obj.get("file_url"),
                ]
                seen_uris = set()
                for gs_uri in gs_candidates:
                    uri = (gs_uri or "").strip()
                    if not uri or uri in seen_uris or not uri.startswith("gs://"):
                        continue
                    seen_uris.add(uri)
                    asset_text = _extract_text_from_gs_asset(uri)
                    if asset_text:
                        source = "analyzer_gcs_pdf" if uri.lower().endswith(".pdf") else "analyzer_gcs_asset"
                        return {"success": True, "html": asset_text, "source": source}

            return {
                "success": False,
                "html": "",
                "source": "none",
                "message": err or (f"Template fetch failed ({status})" if status else "No template content found"),
            }

        # 1) Try template_html table (fastest path)
        full = draft_db.get_template_by_id(template_id)
        if full and full.get("html") and full["html"].get("html_content"):
            return {"success": True, "html": full["html"]["html_content"], "source": "db"}

        # 2) Try assets — look for an HTML asset in GCS
        if full and full.get("assets"):
            from services.template_format import fetch_template_html
            for asset in full["assets"]:
                bucket = asset.get("gcs_bucket", "")
                path = asset.get("gcs_path", "")
                mime = (asset.get("mime_type") or "").lower()
                if not bucket or not path:
                    continue
                gs_url = f"gs://{bucket}/{path}"
                if "html" in mime or path.endswith(".html"):
                    html = _extract_text_from_gs_asset(gs_url)
                    if html:
                        return {"success": True, "html": html, "source": "gcs_html"}

            # 3) Any asset in GCS (try first non-image asset)
            for asset in full["assets"]:
                bucket = asset.get("gcs_bucket", "")
                path = asset.get("gcs_path", "")
                mime = (asset.get("mime_type") or "").lower()
                if not bucket or not path:
                    continue
                if mime.startswith("image/"):
                    continue
                gs_url = f"gs://{bucket}/{path}"
                html = _extract_text_from_gs_asset(gs_url)
                if html:
                    return {"success": True, "html": html, "source": "gcs_asset"}

        return {"success": False, "html": "", "source": "none", "message": "No HTML content found for this template"}
    except Exception as e:
        logger.exception(f"[get_template_html_content] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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
            user_tpl, analyzer_err, analyzer_status = _fetch_user_template_from_analyzer(template_id, analyzer_user_id)
            if user_tpl:
                db_fields = draft_db.get_template_fields_with_fallback(template_id)
                analyzer_fields = user_tpl.get("fields", [])
                db_sections = draft_db.get_template_sections(template_id) if include_sections else []
                out = {
                    "template_id": user_tpl["template_id"],
                    "name": user_tpl["name"],
                    "description": user_tpl.get("description"),
                    "category": user_tpl.get("category"),
                    "sub_category": user_tpl.get("sub_category"),
                    "language": user_tpl.get("language"),
                    "status": user_tpl.get("status"),
                    "is_active": user_tpl.get("is_active", True),
                    "fields": analyzer_fields if len(analyzer_fields) > len(db_fields) else db_fields,
                }
                if include_sections:
                    out["sections"] = db_sections or user_tpl.get("sections", [])
                if include_preview_url and user_tpl.get("preview_image_url"):
                    out["preview_image_url"] = user_tpl["preview_image_url"]
                logger.info("[get_template] Served user template from Template Analyzer: %s", template_id)
                return {"success": True, "template": out}
            # Analyzer unavailable/unreachable -> return service unavailable instead of misleading 404
            if analyzer_err and analyzer_status is None:
                raise HTTPException(
                    status_code=503,
                    detail=f"Template Analyzer service is unavailable for template {template_id}. Please start Template Analyzer and retry.",
                )
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
            user_tpl, _, _ = _fetch_user_template_from_analyzer(template_id, analyzer_user_id)
            if user_tpl and user_tpl.get("preview_image_url"):
                return {"success": True, "preview_image_url": user_tpl["preview_image_url"]}

        return {"success": False, "preview_image_url": None, "message": "No preview image available"}
    except Exception as e:
        logger.exception("[get_template_preview_image] Error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/templates/{template_id}/fields")
async def get_template_fields(
    template_id: str,
    x_user_id: Optional[str] = Header(None, alias="X-User-Id"),
    user_id: Optional[int] = Depends(optional_user_id),
) -> Dict[str, Any]:
    """Get fields for a specific template."""
    try:
        logger.info(f"[get_template_fields] template_id={template_id}")

        fields = draft_db.get_template_fields_with_fallback(template_id)

        analyzer_user_id = user_id
        if analyzer_user_id is None and x_user_id is not None:
            try:
                analyzer_user_id = int(x_user_id)
            except (ValueError, TypeError):
                analyzer_user_id = None

        if _is_uuid(template_id) and (not fields) and analyzer_user_id is not None:
            user_tpl, analyzer_err, analyzer_status = _fetch_user_template_from_analyzer(template_id, analyzer_user_id)
            if user_tpl:
                fields = user_tpl.get("fields", []) or []
            elif analyzer_err and analyzer_status is None:
                raise HTTPException(
                    status_code=503,
                    detail=f"Template Analyzer service is unavailable for template {template_id}. Please start Template Analyzer and retry.",
                )
        
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
