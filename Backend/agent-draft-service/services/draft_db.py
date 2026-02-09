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
) -> List[Dict[str, Any]]:
    """
    List templates with optional category filter. Schema: template_id, template_name, category,
    sub_category, language, status, description, created_by, created_at, updated_at.
    Preview from first template_images row. Filter by status = 'active' when is_active True.
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
    if is_active:
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
    if not row:
        return None
    return dict(row)


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

def get_template_fields(template_id: str) -> List[Dict[str, Any]]:
    """Return active form fields for a template, ordered by sort_order."""
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT field_id, template_id, field_name, field_label, field_type,
                       is_required, placeholder, default_value, validation_rules,
                       options, help_text, field_group, sort_order
                FROM template_fields
                WHERE template_id = %s AND is_active = true
                ORDER BY sort_order ASC NULLS LAST, field_name
                """,
                (template_id,),
            )
            rows = cur.fetchall()
    return [dict(r) for r in rows]


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


def get_template_fields_with_fallback(template_id: str) -> List[Dict[str, Any]]:
    """Return form fields for the opened template only (DB or category-wise fallback)."""
    try:
        fields = get_template_fields(template_id)
        if fields:
            return fields
    except psycopg2.Error:
        # template_fields table may not exist or other DB error -> use static fallback
        pass
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT template_name, category FROM templates WHERE template_id = %s",
                (template_id,),
            )
            row = cur.fetchone()
    if not row:
        return []
    return _resolve_template_fields(
        row.get("template_name") or "",
        row.get("category") or "",
    )


def create_user_draft(
    user_id: int,
    template_id: str,
    draft_title: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Create a new user draft (fresh clone) from a template.
    
    Inserts:
      - user_drafts: new row with user_id, template_id, draft_title
      - draft_field_data: empty field_values ({}), filled_fields ([]), metadata ({is_fresh: true})
    
    Returns: draft dict with draft_id, template_id, etc.
    
    This ALWAYS creates a brand new draft. Use this when user clicks a template from the gallery.
    For continuing an existing draft, use get_latest_draft_for_template or list_user_drafts.
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
    """List drafts for a user, optionally filtered by status and template_id. user_id is integer (JWT)."""
    uid = int(user_id)
    query = """
        SELECT d.draft_id, d.user_id, d.template_id, d.draft_title, d.status,
               d.completion_percentage, d.created_at, d.updated_at,
               t.template_name, t.category
        FROM user_drafts d
        JOIN templates t ON t.template_id = d.template_id
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
    """Get a single draft with template info, template fields, and current field_data. Returns None if not found or not owned. user_id is integer (JWT)."""
    uid = int(user_id)
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT d.draft_id, d.user_id, d.template_id, d.draft_title, d.status,
                       d.completion_percentage, d.notes, d.created_at, d.updated_at,
                       t.template_name, t.description, t.category
                FROM user_drafts d
                JOIN templates t ON t.template_id = d.template_id
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

def get_template_sections(template_id: str) -> List[Dict[str, Any]]:
    """
    Get all active sections for a template (admin-configured prompts).
    Returns: [{ section_id, section_key, section_name, default_prompt, sort_order, ... }]
    """
    with get_draft_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT section_id, template_id, section_key, section_name, default_prompt,
                       sort_order, is_required, is_active, created_at, updated_at
                FROM template_sections
                WHERE template_id = %s AND is_active = true
                ORDER BY sort_order ASC, section_key ASC
                """,
                (template_id,),
            )
            rows = cur.fetchall()
    return [dict(r) for r in rows]


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
            # Get latest active version
            cur.execute(
                """
                SELECT version_id, draft_id, section_key, version_number, content_html,
                       user_prompt_override, rag_context_used, generation_metadata,
                       is_active, created_by_agent, created_at
                FROM section_versions
                WHERE draft_id = %s AND section_key = %s AND is_active = true
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
            
            # Format: (draft_id, section_id, sort_order)
            values = [(draft_id, item["section_id"], item["sort_order"]) for item in section_orders]
            
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
