"""
Draft_DB: templates, template_assets, template_css, template_html, template_images.
Used for template gallery and preview images. Connection from DRAFT_DATABASE_URL.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Any, Dict, List, Optional

import psycopg2
from psycopg2.extras import RealDictCursor


def get_draft_connection_string() -> str:
    url = os.environ.get("DRAFT_DATABASE_URL")
    if not url:
        raise ValueError("DRAFT_DATABASE_URL must be set for template APIs")
    return url


@contextmanager
def get_draft_conn():
    conn = psycopg2.connect(get_draft_connection_string())
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def list_templates(
    category: Optional[str] = None,
    is_active: bool = True,
    limit: int = 50,
    offset: int = 0,
    finalized_only: bool = False,
) -> List[Dict[str, Any]]:
    """
    List templates with optional category filter. Schema: template_id, template_name, category,
    sub_category, language, status, description, created_by, created_at, updated_at.
    Preview from first template_images row. Filter by status = 'active' when is_active True.
    When finalized_only=True, return only templates with status IN ('finalized', 'active') so
    draft section shows only templates that are finalized (or active for backward compatibility).
    """
    query = """
        SELECT t.template_id,
               t.template_name AS name,
               t.description,
               t.category,
               t.sub_category,
               t.language,
               t.status,
               (t.status = 'active') AS is_active,
               t.created_by,
               t.created_at,
               t.updated_at,
               t.image_url AS template_image_url,
               ti.image_id, ti.gcs_bucket AS preview_gcs_bucket, ti.gcs_path AS preview_gcs_path,
               ti.page_number AS preview_page_number
        FROM templates t
        LEFT JOIN LATERAL (
            SELECT image_id, gcs_bucket, gcs_path, page_number
            FROM template_images
            WHERE template_images.template_id = t.template_id
            ORDER BY page_number ASC NULLS LAST
            LIMIT 1
        ) ti ON true
        WHERE 1=1
    """
    params: List[Any] = []
    if finalized_only:
        query += " AND (t.status = %s OR t.status = %s)"
        params.extend(["finalized", "active"])
    elif is_active:
        query += " AND t.status = %s"
        params.append("active")
    if category:
        query += " AND t.category = %s"
        params.append(category)
    query += " ORDER BY t.template_name ASC LIMIT %s OFFSET %s"
    params.extend([limit, offset])

    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query, params)
            rows = cur.fetchall()
    return [dict(r) for r in rows]


def get_template_by_id(template_id: str) -> Optional[Dict[str, Any]]:
    """Fetch one template with latest css, html, assets, and images."""
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT template_id,
                       template_name AS name,
                       description,
                       category,
                       sub_category,
                       language,
                       status,
                       (status = 'active') AS is_active,
                       created_by,
                       created_at,
                       updated_at
                FROM templates WHERE template_id = %s
                """,
                (template_id,),
            )
            row = cur.fetchone()
    if not row:
        return None
    out = dict(row)

    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT asset_id, template_id, asset_type, original_file_name, gcs_bucket, gcs_path,
                       mime_type, file_size_bytes, checksum, uploaded_by, uploaded_at
                FROM template_assets WHERE template_id = %s ORDER BY uploaded_at DESC
                """,
                (template_id,),
            )
            out["assets"] = [dict(r) for r in cur.fetchall()]
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT css_id, template_id, version, paper_size, court, css_content, checksum, is_active, created_at
                FROM template_css WHERE template_id = %s AND is_active = true ORDER BY version DESC LIMIT 1
                """,
                (template_id,),
            )
            row = cur.fetchone()
            out["css"] = dict(row) if row else None
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT template_id, version, html_content, derived_from_asset_id, checksum, is_active, created_at
                FROM template_html WHERE template_id = %s AND is_active = true ORDER BY version DESC LIMIT 1
                """,
                (template_id,),
            )
            row = cur.fetchone()
            out["html"] = dict(row) if row else None
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT image_id, template_id, source_asset_id, gcs_bucket, gcs_path, page_number, width_px, height_px, created_at
                FROM template_images WHERE template_id = %s ORDER BY page_number ASC NULLS LAST
                """,
                (template_id,),
            )
            out["images"] = [dict(r) for r in cur.fetchall()]
    return out


def get_template_css(template_id: str) -> Optional[Dict[str, Any]]:
    """Fetch the active CSS for a template."""
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT css_id, template_id, version, paper_size, court, css_content, is_active, created_at
                FROM template_css WHERE template_id = %s AND is_active = true 
                ORDER BY version DESC LIMIT 1
                """,
                (template_id,),
            )
            row = cur.fetchone()
            return dict(row) if row else None


def get_preview_image_for_template(template_id: str) -> Optional[Dict[str, Any]]:
    """First image row for template (for gallery preview). Returns gcs_bucket, gcs_path, mime from template_images."""
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT image_id, gcs_bucket, gcs_path, page_number
                FROM template_images WHERE template_id = %s
                ORDER BY page_number ASC NULLS LAST
                LIMIT 1
                """,
                (template_id,),
            )
            row = cur.fetchone()
    if row:
        return dict(row)
    return None


def get_template_image_url(template_id: str) -> Optional[str]:
    """Fetch image_url from templates table (gs://...). Returns None if column missing or empty."""
    try:
        with get_draft_conn() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    "SELECT image_url FROM templates WHERE template_id = %s",
                    (template_id,),
                )
                row = cur.fetchone()
        if row and row.get("image_url"):
            return str(row["image_url"]).strip()
    except Exception:
        pass
    return None


def get_preview_from_assets(template_id: str) -> Optional[Dict[str, Any]]:
    """
    Fallback: first image asset from template_assets when template_images has no rows.
    Returns dict with gcs_bucket, gcs_path for assets where mime_type starts with 'image/'.
    """
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT gcs_bucket, gcs_path
                FROM template_assets
                WHERE template_id = %s
                  AND mime_type LIKE 'image/%%'
                ORDER BY uploaded_at DESC
                LIMIT 1
                """,
                (template_id,),
            )
            row = cur.fetchone()
    if row:
        return dict(row)
    return None


def get_template_primary_asset(template_id: str) -> Optional[Dict[str, Any]]:
    """Fetch the primary asset (usually HTML or main doc) for a template from template_assets."""
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT asset_id, template_id, asset_type, original_file_name, gcs_bucket, gcs_path,
                       mime_type, file_size_bytes, checksum, uploaded_by, uploaded_at
                FROM template_assets
                WHERE template_id = %s
                ORDER BY uploaded_at DESC
                LIMIT 1
                """,
                (template_id,),
            )
            row = cur.fetchone()
            return dict(row) if row else None


# --- Template fields (form schema) and user drafts ---

from services.template_field_definitions import (
    CATEGORY_DEFAULT_TEMPLATE,
    TEMPLATE_FIELDS,
    TEMPLATE_NAME_ALIASES,
    normalize_category,
)

def _parse_template_fields_json(raw: Any, template_id: str) -> List[Dict[str, Any]]:
    """Helper to parse template_fields JSON into frontend field dicts."""
    if not raw:
        return []

    # Parse JSON — could be dict with "fields" key or direct list
    import json as _json
    if isinstance(raw, str):
        try:
            raw = _json.loads(raw)
        except Exception:
            return []

    fields_list = []
    
    # Logic to extract fields from various JSON structures (list, dict with "fields", dict with "sections")
    if isinstance(raw, list):
        # Case 1: Raw list of fields
        fields_list = raw
    elif isinstance(raw, dict):
        if "fields" in raw and isinstance(raw["fields"], list):
            # Case 2: Dict with "fields" key
            fields_list = raw["fields"]
        elif "sections" in raw:
            # Case 3: Dict with "sections" key
            sections = raw["sections"]
            if isinstance(sections, list):
                # Sections is a list of section objects
                for section in sections:
                    if isinstance(section, dict) and "fields" in section and isinstance(section["fields"], list):
                        fields_list.extend(section["fields"])
            elif isinstance(sections, dict) and "fields" in sections and isinstance(sections["fields"], list):
                 # Edge case: "sections": {"fields": [...]} (user screenshot looked possibly like this?)
                 fields_list.extend(sections["fields"])

    result = []
    for idx, f in enumerate(fields_list):
        result.append({
            "field_id": f.get("field_id") or f.get("id") or None,
            "template_id": template_id,
            "field_name": f.get("key") or f.get("field_name") or f"field_{idx}",
            "field_label": f.get("label") or f.get("field_label") or f.get("key") or f"Field {idx}",
            "field_type": f.get("type") or f.get("field_type") or "text",
            "is_required": f.get("required", False) if "required" in f else f.get("is_required", False),
            "placeholder": f.get("placeholder") or f.get("description") or "",
            "default_value": f.get("default_value") or f.get("default") or None,
            "validation_rules": f.get("validation_rules") or None,
            "options": f.get("options") or None,
            "help_text": f.get("help_text") or f.get("description") or "",
            "field_group": f.get("group") or f.get("field_group") or "Details",
            "sort_order": f.get("sort_order") if f.get("sort_order") is not None else idx,
        })
    return result


def get_template_fields(template_id: str) -> List[Dict[str, Any]]:
    """Return active form fields for a SYSTEM template."""
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, template_id, template_fields
                FROM template_fields
                WHERE template_id = %s AND is_active = true
                LIMIT 1
                """,
                (template_id,),
            )
            row = cur.fetchone()
    if not row:
        return []

    return _parse_template_fields_json(row.get("template_fields"), template_id)


def get_user_template_fields(template_id: str) -> List[Dict[str, Any]]:
    """Return active form fields for a USER CUSTOM template."""
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, template_id, template_fields
                FROM user_template_fields
                WHERE template_id = %s AND is_active = true
                LIMIT 1
                """,
                (template_id,),
            )
            row = cur.fetchone()
    
    # If no fields found in user_template_fields, we might want to return empty 
    # OR fallback to 'user_template_analysis_sections' via get_template_fields_custom
    # BUT the user specifically asked to use `user_template_fields`.
    if not row:
        return []

    return _parse_template_fields_json(row.get("template_fields"), template_id)


def _resolve_template_fields(template_name: str, category: str) -> List[Dict[str, Any]]:
    """Resolve template-specific fields: exact name -> alias -> category default. Returns list with field_id=None."""
    key = (template_name or "").strip()
    if key in TEMPLATE_FIELDS:
        return [{**f, "field_id": None} for f in TEMPLATE_FIELDS[key]]
    canonical = TEMPLATE_NAME_ALIASES.get(key)
    if canonical and canonical in TEMPLATE_FIELDS:
        return [{**f, "field_id": None} for f in TEMPLATE_FIELDS[canonical]]
    norm_cat = normalize_category(category or "")
    default_name = CATEGORY_DEFAULT_TEMPLATE.get(norm_cat)
    if default_name and default_name in TEMPLATE_FIELDS:
        return [{**f, "field_id": None} for f in TEMPLATE_FIELDS[default_name]]
    return []



def get_template_fields_custom(template_id: str) -> List[Dict[str, Any]]:
    """
    Fetch fields for a CUSTOM template from user_template_analysis_sections.
    Converts section prompts into form fields.
    Each section becomes a required field.
    """
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, section_name, section_purpose, section_prompts, order_index
                FROM user_template_analysis_sections
                WHERE template_id = %s AND is_active = true
                ORDER BY order_index ASC
                """,
                (template_id,),
            )
            rows = cur.fetchall()
    
    if not rows:
        return []

    fields = []
    for idx, row in enumerate(rows):
        # Use master_instruction as default value if desired, or just placeholder
        prompts = row.get("section_prompts", [])
        default_prompt = ""
        # Parse prompts JSONB (could be string or list/dict)
        import json as _json
        if isinstance(prompts, str):
            try:
                prompts = _json.loads(prompts)
            except:
                prompts = []
                
        if isinstance(prompts, list) and len(prompts) > 0:
            default_prompt = prompts[0].get("prompt", "")
        elif isinstance(prompts, dict):
            default_prompt = prompts.get("prompt", "")

        section_name = row["section_name"]
        field_key = section_name.lower().replace(" ", "_")
        
        fields.append({
            "field_id": str(row["id"]),
            "template_id": template_id,
            "field_name": field_key,
            "field_label": section_name,
            "field_type": "textarea", # Sections are typically large text blocks
            "is_required": True,
            "placeholder": row.get("section_purpose") or f"Enter {section_name}",
            "default_value": default_prompt, # Pre-fill with the AI prompt/instruction? Or blank? Usually blank for user to fill.
                                             # Actually, for *drafting*, these are usually inputs *to* the AI.
                                             # Let's keep default_value as null/empty for now unless it's a "prompt editor".
                                             # Wait, the prompt editor uses "section_prompts". 
                                             # The *form* fields are variables used IN the prompt. 
                                             # But for custom templates, we might not have variable extraction yet.
                                             # For Phase 1 of custom templates, let's treat the entire section as a field 
                                             # OR return empty if no variables are defined.
                                             # "Fields" usually means "Client Name", "Address", etc.
                                             # Custom templates created via analyzer might not have explicit variables extracted yet.
                                             # If the analyzer extracted variables, they would be in a different table?
                                             # Checking schema... user_templates doesn't have a "fields" column.
                                             # user_template_analysis_sections has prompts.
                                             # If no explicit fields are defined, we might return an empty list 
                                             # and rely on the "Section Prompts" editor instead? 
                                             # BUT `get_template_fields` is for the "Step 1: Fill Form" UI.
                                             # If there are no variables, Step 1 is empty. That's fine.
            "default_value": None,
            "validation_rules": None,
            "options": None,
            "help_text": row.get("section_purpose") or "",
            "field_group": "Sections",
            "sort_order": row.get("order_index", idx),
        })
    return fields


def get_template_fields_with_fallback(template_id: str) -> List[Dict[str, Any]]:
    """
    Return form fields for the opened template only (DB or category-wise fallback).
    Supports both System Templates and Custom Templates.
    """
    # 1. Try System Template Fields
    try:
        fields = get_template_fields(template_id)
        if fields:
            return fields
    except psycopg2.Error:
        pass

    # 2. Try Custom Template Sections (as fields?) or Check if it is a Custom Template
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Check if it's a custom template
            cur.execute(
                "SELECT template_name, category FROM user_templates WHERE template_id = %s",
                (template_id,),
            )
            custom_row = cur.fetchone()
            
            if custom_row:
                # It is a custom template!
                # Try to fetch fields from user_template_fields (Explicit fields extracted by Analyzer)
                fields = get_user_template_fields(template_id)
                if fields:
                    return fields
                
                # If no explicit fields, try fallback to sections as fields?
                # User asked for "user_template_fields" specifically, but if empty, extraction fails.
                # Fallback to sections ensures we have SOMETHING to extract.
                
                # Double check if we should fallback to sections
                return get_template_fields_custom(template_id) # Enabled fallback 

            # Check if it's a system template (fallback for name/category resolution)
            cur.execute(
                "SELECT template_name, category FROM templates WHERE template_id = %s",
                (template_id,),
            )
            sys_row = cur.fetchone()

    if sys_row:
        return _resolve_template_fields(
            sys_row.get("template_name") or "",
            sys_row.get("category") or "",
        )
        
    return []


def create_user_draft(
    user_id: int,
    template_id: str,
    draft_title: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Create a new user draft (fresh clone) from a template.
    Supports both System and Custom templates (foreign key removed).
    """
    uid = int(user_id)
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO user_drafts (user_id, template_id, draft_title, status, completion_percentage)
                VALUES (%s, %s, %s, 'draft', 0)
                RETURNING draft_id, user_id, template_id, draft_title, status, completion_percentage,
                          created_at, updated_at
                """,
                (uid, template_id, draft_title or ""),
            )
            row = cur.fetchone()
            draft = dict(row)
            draft_id = str(draft["draft_id"])
            # Create fresh draft_field_data with empty values and is_fresh flag
            cur.execute(
                """
                INSERT INTO draft_field_data (draft_id, field_values, filled_fields, metadata)
                VALUES (%s, '{}'::jsonb, '[]'::jsonb, '{"is_fresh": true}'::jsonb)
                """,
                (draft_id,),
            )
    return draft


def list_user_drafts(
    user_id: int,
    status: Optional[str] = None,
    template_id: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    """
    List drafts for a user, fetching template details from either 
    'templates' OR 'user_templates'.
    """
    uid = int(user_id)
    # COALESCE pulls from whichever table has the data (system or custom)
    query = """
        SELECT d.draft_id, d.user_id, d.template_id, d.draft_title, d.status,
               d.completion_percentage, d.created_at, d.updated_at,
               COALESCE(t.template_name, ut.template_name) as template_name,
               COALESCE(t.category, ut.category) as category
        FROM user_drafts d
        LEFT JOIN templates t ON t.template_id = d.template_id
        LEFT JOIN user_templates ut ON ut.template_id = d.template_id
        WHERE d.user_id = %s
    """
    params: List[Any] = [uid]
    if status:
        query += " AND d.status = %s"
        params.append(status)
    if template_id:
        query += " AND d.template_id = %s"
        params.append(template_id)
    query += " ORDER BY d.updated_at DESC LIMIT %s OFFSET %s"
    params.extend([limit, offset])
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query, params)
            rows = cur.fetchall()
    return [dict(r) for r in rows]


def get_latest_draft_for_template(user_id: int, template_id: str) -> Optional[Dict[str, Any]]:
    """Return the most recently updated draft for this user and template, or None."""
    drafts = list_user_drafts(
        user_id=user_id,
        template_id=template_id,
        limit=1,
        offset=0,
    )
    return drafts[0] if drafts else None


def get_user_draft(draft_id: str, user_id: int) -> Optional[Dict[str, Any]]:
    """
    Get a single draft with template info.
    Supports fetching metadata from 'templates' OR 'user_templates'.
    """
    uid = int(user_id)
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT d.draft_id, d.user_id, d.template_id, d.draft_title, d.status,
                       d.completion_percentage, d.notes, d.created_at, d.updated_at,
                       COALESCE(t.template_name, ut.template_name) as template_name,
                       COALESCE(t.description, ut.description) as description,
                       COALESCE(t.category, ut.category) as category
                FROM user_drafts d
                LEFT JOIN templates t ON t.template_id = d.template_id
                LEFT JOIN user_templates ut ON ut.template_id = d.template_id
                WHERE d.draft_id = %s AND d.user_id = %s
                """,
                (draft_id, uid),
            )
            row = cur.fetchone()
    if not row:
        return None
    out = dict(row)
    out["fields"] = get_template_fields_with_fallback(str(out["template_id"]))
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT field_values, filled_fields, metadata FROM draft_field_data WHERE draft_id = %s",
                (draft_id,),
            )
            row = cur.fetchone()
    if row:
        fv = row.get("field_values")
        out["field_values"] = dict(fv) if fv is not None else {}
        out["filled_fields"] = list(row["filled_fields"]) if row.get("filled_fields") is not None else []
        out["metadata"] = dict(row["metadata"]) if row.get("metadata") is not None else {}
    else:
        out["field_values"] = {}
        out["filled_fields"] = []
        out["metadata"] = {}
    return out


def get_draft_field_data_for_retrieve(draft_id: str, user_id: int) -> Optional[Dict[str, Any]]:
    """
    Fetch field_values and metadata from draft_field_data for a draft.
    Returns None if draft does not exist or user does not own it.
    Used when Librarian fetches chunks so the response can include draft form data.
    """
    import logging
    logger = logging.getLogger(__name__)
    
    uid = int(user_id)
    logger.info(f"[get_draft_field_data_for_retrieve] Called with draft_id={draft_id}, user_id={uid}")
    
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT 1 FROM user_drafts WHERE draft_id = %s AND user_id = %s",
                (draft_id, uid),
            )
            if not cur.fetchone():
                logger.warning(f"[get_draft_field_data_for_retrieve] Draft not found or user doesn't own it: draft_id={draft_id}, user_id={uid}")
                return None
            cur.execute(
                "SELECT field_values, filled_fields, metadata, updated_at FROM draft_field_data WHERE draft_id = %s",
                (draft_id,),
            )
            row = cur.fetchone()
    
    if not row:
        logger.warning(f"[get_draft_field_data_for_retrieve] No draft_field_data found for draft_id={draft_id}, returning empty metadata")
        return {"draft_id": draft_id, "field_values": {}, "filled_fields": [], "metadata": {}, "updated_at": None}
    
    fv = row.get("field_values")
    filled = row.get("filled_fields")
    meta = row.get("metadata")
    
    logger.info(f"[get_draft_field_data_for_retrieve] Found draft_field_data: metadata={meta}")
    
    return {
        "draft_id": draft_id,
        "field_values": dict(fv) if fv is not None else {},
        "filled_fields": list(filled) if filled is not None else [],
        "metadata": dict(meta) if meta is not None else {},
        "updated_at": row.get("updated_at"),
    }


def update_draft_field_data(
    draft_id: str,
    user_id: int,
    field_values: Dict[str, Any],
    filled_fields: Optional[List[str]] = None,
) -> bool:
    """
    Update field_values and optionally filled_fields for a draft.
    
    When user saves their first edit to a fresh template, clears the is_fresh flag
    so the draft becomes a regular draft that loads saved data on next open.
    
    Verifies ownership. user_id is integer (JWT).
    """
    import json
    uid = int(user_id)
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Verify ownership
            cur.execute(
                "SELECT 1 FROM user_drafts WHERE draft_id = %s AND user_id = %s",
                (draft_id, uid),
            )
            if not cur.fetchone():
                return False
            
            # Get current metadata to check if it's a fresh draft
            cur.execute(
                "SELECT metadata FROM draft_field_data WHERE draft_id = %s",
                (draft_id,),
            )
            row = cur.fetchone()
            current_metadata = dict(row["metadata"]) if row and row.get("metadata") else {}
            
            # Clear is_fresh flag when user saves their first edit
            if current_metadata.get("is_fresh") is True:
                current_metadata["is_fresh"] = False
                print(f"[update_draft_field_data] Clearing is_fresh flag for draft {draft_id} (user made their first edit)")
            
            # Update field data
            cur.execute(
                """
                INSERT INTO draft_field_data (draft_id, field_values, filled_fields, metadata, updated_at)
                VALUES (%s, %s, %s, %s, now())
                ON CONFLICT (draft_id) DO UPDATE SET
                    field_values = EXCLUDED.field_values,
                    filled_fields = EXCLUDED.filled_fields,
                    metadata = EXCLUDED.metadata,
                    updated_at = now()
                """,
                (draft_id, json.dumps(field_values), json.dumps(filled_fields or list(field_values.keys())), json.dumps(current_metadata)),
            )
            
            # Update draft's updated_at timestamp
            cur.execute(
                "UPDATE user_drafts SET updated_at = now() WHERE draft_id = %s",
                (draft_id,),
            )
    return True


def rename_draft(draft_id: str, user_id: int, new_title: str) -> bool:
    """
    Rename a draft. Updates the draft_title in user_drafts table.
    Verifies ownership before renaming.
    
    Args:
        draft_id: UUID of the draft
        user_id: Integer user ID from JWT
        new_title: New title for the draft
    
    Returns:
        True if renamed successfully, False if draft not found or user doesn't own it
    """
    uid = int(user_id)
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Verify ownership
            cur.execute(
                "SELECT 1 FROM user_drafts WHERE draft_id = %s AND user_id = %s",
                (draft_id, uid),
            )
            if not cur.fetchone():
                print(f"[rename_draft] Draft {draft_id} not found or user {uid} doesn't own it")
                return False
            
            # Update draft title
            cur.execute(
                "UPDATE user_drafts SET draft_title = %s, updated_at = now() WHERE draft_id = %s",
                (new_title.strip(), draft_id),
            )
            print(f"[rename_draft] Draft {draft_id} renamed to '{new_title}' by user {uid}")
    return True


def attach_case_to_draft(
    draft_id: str,
    user_id: int,
    case_id: str,
    case_title: Optional[str] = None,
) -> bool:
    """Attach a case to the draft (store case_id in draft_field_data.metadata). Agent can use it for context."""
    import json
    import logging
    logger = logging.getLogger(__name__)
    
    uid = int(user_id)
    logger.info(f"[attach_case_to_draft] Attaching case_id={case_id} to draft_id={draft_id}")
    
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT 1 FROM user_drafts WHERE draft_id = %s AND user_id = %s",
                (draft_id, uid),
            )
            if not cur.fetchone():
                logger.warning(f"[attach_case_to_draft] Draft not found or user doesn't own it: draft_id={draft_id}, user_id={uid}")
                return False
            
            # Get existing metadata or create new
            cur.execute(
                "SELECT metadata FROM draft_field_data WHERE draft_id = %s",
                (draft_id,),
            )
            row = cur.fetchone()
            meta = dict(row["metadata"]) if row and row.get("metadata") else {}
            meta["case_id"] = str(case_id)
            if case_title is not None:
                meta["case_title"] = str(case_title)
            
            logger.info(f"[attach_case_to_draft] Updated metadata: {meta}")
            
            # UPSERT: Insert if not exists, update if exists
            cur.execute(
                """
                INSERT INTO draft_field_data (draft_id, field_values, filled_fields, metadata, updated_at)
                VALUES (%s, '{}'::jsonb, '[]'::jsonb, %s::jsonb, now())
                ON CONFLICT (draft_id) DO UPDATE SET
                    metadata = EXCLUDED.metadata,
                    updated_at = now()
                """,
                (draft_id, json.dumps(meta)),
            )
            
            cur.execute(
                "UPDATE user_drafts SET updated_at = now() WHERE draft_id = %s",
                (draft_id,),
            )
            
            logger.info(f"[attach_case_to_draft] Successfully attached case_id={case_id} to draft_id={draft_id}")
    return True


def set_uploaded_file_name(draft_id: str, user_id: int, file_name: str) -> bool:
    """Store the uploaded file name in draft_field_data.metadata so it shows when the draft is reopened."""
    import json
    uid = int(user_id)
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT 1 FROM user_drafts WHERE draft_id = %s AND user_id = %s",
                (draft_id, uid),
            )
            if not cur.fetchone():
                return False
            cur.execute(
                "SELECT metadata FROM draft_field_data WHERE draft_id = %s",
                (draft_id,),
            )
            row = cur.fetchone()
            meta = dict(row["metadata"]) if row and row.get("metadata") else {}
            meta["uploaded_file_name"] = str(file_name) if file_name else ""
            cur.execute(
                "UPDATE draft_field_data SET metadata = %s::jsonb, updated_at = now() WHERE draft_id = %s",
                (json.dumps(meta), draft_id),
            )
            cur.execute(
                "UPDATE user_drafts SET updated_at = now() WHERE draft_id = %s",
                (draft_id,),
            )
    return True


def add_uploaded_file_id_to_draft(draft_id: str, user_id: int, file_id: str) -> bool:
    """
    Append a file_id to the draft's metadata.uploaded_file_ids so the Librarian
    only retrieves chunks from this draft's uploaded files (and/or attached case).
    Verifies ownership. user_id is integer (JWT).
    """
    import json
    if not file_id or not str(file_id).strip():
        return False
    fid = str(file_id).strip()
    uid = int(user_id)
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT 1 FROM user_drafts WHERE draft_id = %s AND user_id = %s",
                (draft_id, uid),
            )
            if not cur.fetchone():
                return False
            cur.execute(
                "SELECT metadata FROM draft_field_data WHERE draft_id = %s",
                (draft_id,),
            )
            row = cur.fetchone()
            meta = dict(row["metadata"]) if row and row.get("metadata") else {}
            ids = list(meta.get("uploaded_file_ids") or [])
            if not isinstance(ids, list):
                ids = [ids] if ids else []
            if fid not in ids:
                ids.append(fid)
                meta["uploaded_file_ids"] = ids
                cur.execute(
                    "UPDATE draft_field_data SET metadata = %s::jsonb, updated_at = now() WHERE draft_id = %s",
                    (json.dumps(meta), draft_id),
                )
                cur.execute(
                    "UPDATE user_drafts SET updated_at = now() WHERE draft_id = %s",
                    (draft_id,),
                )
                print(f"[add_uploaded_file_id_to_draft] draft_id={draft_id} file_id={fid} (total {len(ids)} file(s) for this draft)")
    return True


def get_draft_uploaded_file_ids(draft_id: str, user_id: int) -> List[str]:
    """
    Return list of file_ids stored in draft metadata (uploaded_file_ids).
    Used by Librarian to restrict retrieval to this draft's documents only.
    Returns [] if draft not found or no uploaded files.
    """
    uid = int(user_id)
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT 1 FROM user_drafts WHERE draft_id = %s AND user_id = %s",
                (draft_id, uid),
            )
            if not cur.fetchone():
                return []
            cur.execute(
                "SELECT metadata FROM draft_field_data WHERE draft_id = %s",
                (draft_id,),
            )
            row = cur.fetchone()
    if not row or not row.get("metadata"):
        return []
    meta = row["metadata"] or {}
    ids = meta.get("uploaded_file_ids")
    if isinstance(ids, list):
        return [str(f) for f in ids if f]
    if ids:
        return [str(ids)]
    return []


def delete_draft(draft_id: str, user_id: int) -> bool:
    """Delete a draft and its field data. Verifies ownership (user_id from JWT). Returns True if deleted."""
    uid = int(user_id)
    with get_draft_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM user_drafts WHERE draft_id = %s AND user_id = %s",
                (draft_id, uid),
            )
            if not cur.fetchone():
                return False
            cur.execute("DELETE FROM draft_field_data WHERE draft_id = %s", (draft_id,))
            cur.execute("DELETE FROM user_drafts WHERE draft_id = %s AND user_id = %s", (draft_id, uid))
    return True


# ============================================================================
# SECTION VERSIONS: Section-wise generation with versioning and refinement
# ============================================================================

# Table: template_analysis_sections
# Columns: id, template_id, section_name, section_purpose, section_intro,
#          section_prompts (JSONB array of {prompt, field_id}), order_index,
#          is_active, created_at, updated_at


def get_template_analysis_sections(template_id: str) -> List[Dict[str, Any]]:
    """
    Fetch all section prompts from template_analysis_sections for a template.
    Returns rows with exact table columns: id, template_id, section_name,
    section_purpose, section_intro, section_prompts, order_index, is_active,
    created_at, updated_at. Also adds section_key = lower(replace(section_name, ' ', '_')).
    """
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, template_id, section_name, section_purpose, section_intro,
                       section_prompts, order_index, is_active, created_at, updated_at
                FROM template_analysis_sections
                WHERE template_id = %s AND is_active = true
                ORDER BY order_index ASC
                """,
                (template_id,),
            )
            rows = cur.fetchall()
    results = []
    for r in rows:
        row = dict(r)
        # Add section_key for convenience (matches get_template_sections)
        name = row.get("section_name") or ""
        row["section_key"] = name.lower().replace(" ", "_") if name else ""
        results.append(row)
    return results


def get_template_sections(template_id: str) -> List[Dict[str, Any]]:
    """
    Get all active sections for a template from template_analysis_sections.
    Extracts the master_instruction prompt from the JSONB section_prompts array.
    Returns: [{ section_id, section_key, section_name, default_prompt, sort_order, ... }]
    """
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id as section_id, template_id,
                       lower(replace(section_name, ' ', '_')) as section_key,
                       section_name, section_purpose, section_intro,
                       section_prompts, order_index as sort_order,
                       is_active, created_at, updated_at
                FROM template_analysis_sections
                WHERE template_id = %s AND is_active = true
                ORDER BY order_index ASC
                """,
                (template_id,),
            )
            rows = cur.fetchall()
            
            # If no system sections found, check for custom template sections
            if not rows:
                cur.execute(
                    """
                    SELECT id as section_id, template_id,
                           lower(replace(section_name, ' ', '_')) as section_key,
                           section_name, section_purpose, 
                           NULL as section_intro, -- user_template_analysis_sections might not have intro
                           section_prompts, order_index as sort_order,
                           is_active, created_at, updated_at
                    FROM user_template_analysis_sections
                    WHERE template_id = %s AND is_active = true
                    ORDER BY order_index ASC
                    """,
                    (template_id,),
                )
                rows = cur.fetchall()

    results = []
    for r in rows:
        row = dict(r)
        # Extract default_prompt from section_prompts JSONB array
        # Each element has {"prompt": "...", "field_id": "master_instruction"}
        prompts = row.get("section_prompts", [])
        default_prompt = ""
        if isinstance(prompts, list) and len(prompts) > 0:
            # Use the first prompt (master_instruction) as the default
            default_prompt = prompts[0].get("prompt", "")
        elif isinstance(prompts, dict):
            default_prompt = prompts.get("prompt", "")
        row["default_prompt"] = default_prompt
        row["is_required"] = True  # All template_analysis_sections are required
        results.append(row)
    return results


def get_section_latest_version(draft_id: str, section_key: str, user_id: int) -> Optional[Dict[str, Any]]:
    """
    Get the latest active version for a section in a draft.
    Verifies user owns the draft. Returns None if no version exists.
    """
    uid = int(user_id)
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Verify ownership
            cur.execute(
                "SELECT 1 FROM user_drafts WHERE draft_id = %s AND user_id = %s",
                (draft_id, uid),
            )
            if not cur.fetchone():
                return None
            # Get latest active version (case-insensitive section_key match for frontend compatibility)
            cur.execute(
                """
                SELECT version_id, draft_id, section_key, version_number, content_html,
                       user_prompt_override, rag_context_used, generation_metadata,
                       is_active, created_by_agent, created_at
                FROM section_versions
                WHERE draft_id = %s AND LOWER(TRIM(section_key)) = LOWER(TRIM(%s)) AND is_active = true
                ORDER BY version_number DESC
                LIMIT 1
                """,
                (draft_id, section_key),
            )
            row = cur.fetchone()
    return dict(row) if row else None


def save_section_version(
    draft_id: str,
    user_id: int,
    section_key: str,
    content_html: str,
    user_prompt_override: Optional[str] = None,
    rag_context_used: Optional[str] = None,
    generation_metadata: Optional[Dict[str, Any]] = None,
    created_by_agent: str = "drafter",
) -> Dict[str, Any]:
    """
    Save a new section version. Deactivates previous versions for this section.
    Returns the new version dict.
    """
    import json
    uid = int(user_id)
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Verify ownership
            cur.execute(
                "SELECT 1 FROM user_drafts WHERE draft_id = %s AND user_id = %s",
                (draft_id, uid),
            )
            if not cur.fetchone():
                raise ValueError(f"Draft {draft_id} not found or user {uid} doesn't own it")
            
            # Get next version number
            cur.execute(
                "SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM section_versions WHERE draft_id = %s AND section_key = %s",
                (draft_id, section_key),
            )
            res = cur.fetchone()
            version_number = res["next_version"] if res else 1
            
            # Deactivate previous versions for this section
            cur.execute(
                "UPDATE section_versions SET is_active = false WHERE draft_id = %s AND section_key = %s",
                (draft_id, section_key),
            )
            
            # Insert new version
            cur.execute(
                """
                INSERT INTO section_versions
                  (draft_id, section_key, version_number, content_html, user_prompt_override,
                   rag_context_used, generation_metadata, is_active, created_by_agent)
                VALUES (%s, %s, %s, %s, %s, %s, %s, true, %s)
                RETURNING version_id, draft_id, section_key, version_number, content_html,
                          user_prompt_override, rag_context_used, generation_metadata,
                          is_active, created_by_agent, created_at
                """,
                (
                    draft_id,
                    section_key,
                    version_number,
                    content_html,
                    user_prompt_override,
                    rag_context_used,
                    json.dumps(generation_metadata or {}),
                    created_by_agent,
                ),
            )
            row = cur.fetchone()
            
            # Update draft timestamp
            cur.execute("UPDATE user_drafts SET updated_at = now() WHERE draft_id = %s", (draft_id,))
    
    print(f"[save_section_version] draft={draft_id} section={section_key} v{version_number} by {created_by_agent}")
    return dict(row)


def get_all_active_sections(draft_id: str, user_id: int) -> List[Dict[str, Any]]:
    """
    Get all active section versions for a draft.
    Returns: [{ version_id, section_key, version_number, content_html, ... }]
    """
    uid = int(user_id)
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT 1 FROM user_drafts WHERE draft_id = %s AND user_id = %s",
                (draft_id, uid),
            )
            if not cur.fetchone():
                return []
            cur.execute(
                """
                SELECT version_id, draft_id, section_key, version_number, content_html,
                       user_prompt_override, rag_context_used, generation_metadata,
                       is_active, created_by_agent, created_at
                FROM section_versions
                WHERE draft_id = %s AND is_active = true
                ORDER BY section_key ASC, version_number DESC
                """,
                (draft_id,),
            )
            rows = cur.fetchall()
    return [dict(r) for r in rows]


def save_critic_review(
    version_id: str,
    critic_status: str,
    critic_score: int,
    critic_feedback: str,
    review_metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Save a Critic agent review for a section version.
    Returns the review dict.
    """
    import json
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO section_reviews
                  (version_id, critic_status, critic_score, critic_feedback, review_metadata)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING review_id, version_id, critic_status, critic_score, critic_feedback,
                          review_metadata, reviewed_at
                """,
                (version_id, critic_status, critic_score, critic_feedback, json.dumps(review_metadata or {})),
            )
            row = cur.fetchone()
    print(f"[save_critic_review] version={version_id} status={critic_status} score={critic_score}")
    return dict(row)


def get_section_reviews(version_id: str) -> List[Dict[str, Any]]:
    """Get all reviews for a section version (ordered by most recent first)."""
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT review_id, version_id, critic_status, critic_score, critic_feedback,
                       review_metadata, reviewed_at
                FROM section_reviews
                WHERE version_id = %s
                ORDER BY reviewed_at DESC
                """,
                (version_id,),
            )
            rows = cur.fetchall()
    return [dict(r) for r in rows]


# ============================================================================
# SECTION PROMPTS: User customizations for universal sections (prompts/skip)
# ============================================================================

def upsert_draft_section_prompt(
    draft_id: str, 
    section_id: str, 
    custom_prompt: Optional[str], 
    is_deleted: bool,
    detail_level: Optional[str] = None,
    language: Optional[str] = None,
    section_name: Optional[str] = None,
    section_type: Optional[str] = None,
    sort_order: Optional[int] = None
) -> Dict[str, Any]:
    """Upsert a section prompt customization (prompt text, is_deleted flag, detail_level, language, name, type, sort_order)."""
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO dt_draft_section_prompts (
                    draft_id, section_id, custom_prompt, is_deleted, detail_level, language, section_name, section_type, sort_order, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, COALESCE(%s, 0), NOW())
                ON CONFLICT (draft_id, section_id)
                DO UPDATE SET
                    custom_prompt = EXCLUDED.custom_prompt,
                    is_deleted = EXCLUDED.is_deleted,
                    detail_level = EXCLUDED.detail_level,
                    language = EXCLUDED.language,
                    section_name = EXCLUDED.section_name,
                    section_type = EXCLUDED.section_type,
                    sort_order = CASE WHEN %s IS NOT NULL THEN EXCLUDED.sort_order ELSE dt_draft_section_prompts.sort_order END,
                    updated_at = NOW()
                RETURNING *
                """,
                (draft_id, section_id, custom_prompt, is_deleted, detail_level, language, section_name, section_type, sort_order, sort_order)
            )
            row = cur.fetchone()
            return dict(row) if row else {}


def get_draft_section_prompts_list(draft_id: str) -> List[Dict[str, Any]]:
    """Get all section customizations for a draft."""
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            try:
                cur.execute(
                    """
                    SELECT section_id, custom_prompt, is_deleted, detail_level, language, sort_order, section_name, section_type
                    FROM dt_draft_section_prompts
                    WHERE draft_id = %s
                    ORDER BY sort_order ASC NULLS LAST
                    """,
                    (draft_id,)
                )
                return [dict(r) for r in cur.fetchall()]
            except psycopg2.errors.UndefinedTable:
                conn.rollback()
                return []
            except psycopg2.errors.UndefinedColumn:
                # Fallback if migration hasn't run yet
                conn.rollback()
                cur.execute(
                    """
                    SELECT section_id, custom_prompt, is_deleted, detail_level, language
                    FROM dt_draft_section_prompts
                    WHERE draft_id = %s
                    """,
                    (draft_id,)
                )
                return [dict(r) for r in cur.fetchall()]

def update_draft_section_orders(draft_id: str, section_orders: List[Dict[str, Any]]) -> bool:
    """
    Update sort_order for multiple sections.
    section_orders example: [{"section_id": "s1", "sort_order": 0}, ...]
    """
    with get_draft_conn() as conn:
        with conn.cursor() as cur:
            # We use upsert to ensure row exists even if only setting order
            # Keeping existing values for other columns if they exist, or defaults
            from psycopg2.extras import execute_values
            
            # Format: (draft_id, section_id, sort_order, updated_at)
            from datetime import datetime
            now = datetime.utcnow()
            values = [(draft_id, item["section_id"], item["sort_order"], now) for item in section_orders]
            
            execute_values(cur,
                """
                INSERT INTO dt_draft_section_prompts (draft_id, section_id, sort_order, updated_at)
                VALUES %s
                ON CONFLICT (draft_id, section_id)
                DO UPDATE SET
                    sort_order = EXCLUDED.sort_order,
                    updated_at = NOW()
                """,
                values
            )
    return True


# ============================================================================
# INJECTION AGENT: Auto-extract template fields from uploaded documents
# ============================================================================

import logging as _logging
_injection_logger = _logging.getLogger(__name__)


def get_existing_user_field_values(
    template_id: str,
    user_id: int,
    draft_session_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Fetch existing field_values and user_edited_fields for the given
    (template_id, user_id, draft_session_id) from template_user_field_values.

    WHY: The InjectionAgent needs to know which fields the user has manually
    edited so it can skip those during field-level merge.

    Returns:
        Dict with field_values, user_edited_fields, filled_by, extraction_status
        or None if no row exists yet.
    """
    uid = int(user_id)
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if draft_session_id:
                cur.execute(
                    """
                    SELECT field_values, user_edited_fields, filled_by,
                           extraction_status, extraction_error
                    FROM template_user_field_values
                    WHERE template_id = %s AND user_id = %s AND draft_session_id = %s
                    """,
                    (template_id, uid, draft_session_id),
                )
            else:
                cur.execute(
                    """
                    SELECT field_values, user_edited_fields, filled_by,
                           extraction_status, extraction_error
                    FROM template_user_field_values
                    WHERE template_id = %s AND user_id = %s AND draft_session_id IS NULL
                    """,
                    (template_id, uid),
                )
            row = cur.fetchone()

    if not row:
        return None

    return {
        "field_values": dict(row["field_values"]) if row.get("field_values") else {},
        "user_edited_fields": list(row["user_edited_fields"]) if row.get("user_edited_fields") else [],
        "filled_by": row.get("filled_by"),
        "extraction_status": row.get("extraction_status"),
        "extraction_error": row.get("extraction_error"),
    }


def upsert_extracted_field_values(
    template_id: str,
    user_id: int,
    field_values: Dict[str, Any],
    filled_by: str = "agent",
    extraction_status: str = "completed",
    draft_session_id: Optional[str] = None,
    source_document_id: Optional[str] = None,
) -> bool:
    """
    UPSERT extracted field values into template_user_field_values.

    WHY: Uses ON CONFLICT (template_id, user_id, draft_session_id) so that
    re-extraction for the same draft overwrites previous agent extractions
    while the field-level merge (done in the agent layer) protects user-edited
    fields.

    The caller (InjectionAgent) is responsible for performing the field-level
    merge BEFORE calling this function. This function writes the pre-merged
    values as-is.

    Args:
        template_id: Template being filled
        user_id: User who owns the values
        field_values: Pre-merged dict of field values
        filled_by: 'agent' or 'user' — who performed this write
        extraction_status: 'completed', 'partial', or 'failed'
        draft_session_id: Optional draft session link
        source_document_id: Optional source document reference
    """
    import json as _json
    uid = int(user_id)

    _injection_logger.info(
        "[InjectionAgent][DB] Upserting %d fields for template_id=%s, user_id=%s, "
        "draft_session_id=%s, filled_by=%s, status=%s",
        len(field_values), template_id, uid, draft_session_id, filled_by, extraction_status,
    )

    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO template_user_field_values
                    (template_id, user_id, draft_session_id, source_document_id,
                     field_values, filled_by, extraction_status, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s, now(), now())
                ON CONFLICT (template_id, user_id, draft_session_id)
                DO UPDATE SET
                    field_values = EXCLUDED.field_values,
                    source_document_id = EXCLUDED.source_document_id,
                    filled_by = EXCLUDED.filled_by,
                    extraction_status = EXCLUDED.extraction_status,
                    extraction_error = NULL,
                    updated_at = now()
                """,
                (
                    template_id, uid, draft_session_id, source_document_id,
                    _json.dumps(field_values), filled_by, extraction_status,
                ),
            )

    _injection_logger.info("[InjectionAgent][DB] Upsert successful")
    return True


def update_extraction_status(
    template_id: str,
    user_id: int,
    extraction_status: str,
    extraction_error: Optional[str] = None,
    draft_session_id: Optional[str] = None,
) -> bool:
    """
    Update only the extraction_status and extraction_error columns.

    WHY: For partial or failed extractions, we want to record the error
    in the DB without touching the field_values. If no row exists yet,
    we INSERT a minimal row so the status is always trackable.
    """
    import json as _json
    uid = int(user_id)

    # Truncate error message to prevent DB overflow
    error_truncated = extraction_error[:2000] if extraction_error else None

    _injection_logger.info(
        "[InjectionAgent][DB] Updating extraction status: template_id=%s, user_id=%s, "
        "draft_session_id=%s → status=%s, error=%s",
        template_id, uid, draft_session_id, extraction_status,
        (error_truncated[:100] + "...") if error_truncated and len(error_truncated) > 100 else error_truncated,
    )

    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO template_user_field_values
                    (template_id, user_id, draft_session_id,
                     field_values, extraction_status, extraction_error, filled_by,
                     created_at, updated_at)
                VALUES (%s, %s, %s, '{}'::jsonb, %s, %s, 'agent', now(), now())
                ON CONFLICT (template_id, user_id, draft_session_id)
                DO UPDATE SET
                    extraction_status = EXCLUDED.extraction_status,
                    extraction_error = EXCLUDED.extraction_error,
                    updated_at = now()
                """,
                (template_id, uid, draft_session_id, extraction_status, error_truncated),
            )

    return True
