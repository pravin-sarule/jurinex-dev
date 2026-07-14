from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from app.services.db import get_db_connection, is_db_available

logger = logging.getLogger("agentic_document_service.branding")

# Columns written on create/update (excludes id, user_id, created_at, updated_at)
_PROFILE_FIELDS = [
    "name", "is_default",
    "firm_name", "tagline", "bar_council_no", "office_address", "phone", "email",
    "logo", "logo_position", "logo_width", "logo_height", "letterhead_alignment",
    "header_enabled", "header_text", "header_alignment", "header_font_size",
    "footer_enabled", "footer_pattern", "footer_position", "footer_font_size",
    "watermark", "watermark_text", "watermark_opacity", "watermark_angle",
    "font_family", "font_size", "line_height", "primary_color",
    "firm_name_font_size", "firm_name_color", "tagline_font_size", "tagline_color",
    "meta_font_size", "meta_color", "header_color", "footer_color", "body_text_color",
    "page_size", "orientation",
]

# camelCase keys expected from / returned to the frontend
_CAMEL_TO_SNAKE: dict[str, str] = {
    "isDefault": "is_default",
    "firmName": "firm_name",
    "barCouncilNo": "bar_council_no",
    "officeAddress": "office_address",
    "logoPosition": "logo_position",
    "logoWidth": "logo_width",
    "logoHeight": "logo_height",
    "letterheadAlignment": "letterhead_alignment",
    "headerEnabled": "header_enabled",
    "headerText": "header_text",
    "headerAlignment": "header_alignment",
    "headerFontSize": "header_font_size",
    "footerEnabled": "footer_enabled",
    "footerPattern": "footer_pattern",
    "footerPosition": "footer_position",
    "footerFontSize": "footer_font_size",
    "watermarkText": "watermark_text",
    "watermarkOpacity": "watermark_opacity",
    "watermarkAngle": "watermark_angle",
    "fontFamily": "font_family",
    "fontSize": "font_size",
    "lineHeight": "line_height",
    "primaryColor": "primary_color",
    "firmNameFontSize": "firm_name_font_size",
    "firmNameColor": "firm_name_color",
    "taglineFontSize": "tagline_font_size",
    "taglineColor": "tagline_color",
    "metaFontSize": "meta_font_size",
    "metaColor": "meta_color",
    "headerColor": "header_color",
    "footerColor": "footer_color",
    "bodyTextColor": "body_text_color",
    "pageSize": "page_size",
}
_SNAKE_TO_CAMEL: dict[str, str] = {v: k for k, v in _CAMEL_TO_SNAKE.items()}


def _to_snake(data: dict[str, Any]) -> dict[str, Any]:
    return {_CAMEL_TO_SNAKE.get(k, k): v for k, v in data.items()}


def _row_to_profile(row: dict[str, Any]) -> dict[str, Any]:
    """Convert DB snake_case row → camelCase profile dict for the frontend."""
    out: dict[str, Any] = {}
    for k, v in row.items():
        camel = _SNAKE_TO_CAMEL.get(k, k)
        # Serialize datetimes
        if isinstance(v, datetime):
            out[camel] = v.isoformat()
        else:
            out[camel] = v
    return out


def list_profiles(user_id: str) -> list[dict[str, Any]]:
    if not is_db_available():
        return []
    with get_db_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM branding_profiles WHERE user_id = %s ORDER BY created_at ASC",
            [user_id],
        )
        return [_row_to_profile(r) for r in cur.fetchall()]


def get_profile(user_id: str, profile_id: str) -> dict[str, Any] | None:
    if not is_db_available():
        return None
    with get_db_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM branding_profiles WHERE id = %s AND user_id = %s",
            [profile_id, user_id],
        )
        row = cur.fetchone()
        return _row_to_profile(row) if row else None


def get_default_profile(user_id: str) -> dict[str, Any] | None:
    if not is_db_available():
        return None
    with get_db_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM branding_profiles WHERE user_id = %s AND is_default = TRUE LIMIT 1",
            [user_id],
        )
        row = cur.fetchone()
        return _row_to_profile(row) if row else None


def create_profile(user_id: str, data: dict[str, Any]) -> dict[str, Any]:
    snake = _to_snake(data)
    profile_id = str(uuid.uuid4())
    now = datetime.now(tz=UTC)

    # Skip absent/None fields so column defaults apply (several are NOT NULL).
    fields = [f for f in _PROFILE_FIELDS if snake.get(f) is not None]
    cols = ["id", "user_id"] + fields + ["created_at", "updated_at"]
    vals = [profile_id, user_id] + [snake[f] for f in fields] + [now, now]
    placeholders = ", ".join(["%s"] * len(cols))
    col_list = ", ".join(cols)

    with get_db_connection() as conn, conn.cursor() as cur:
        if snake.get("is_default"):
            cur.execute(
                "UPDATE branding_profiles SET is_default = FALSE WHERE user_id = %s",
                [user_id],
            )
        cur.execute(
            f"INSERT INTO branding_profiles ({col_list}) VALUES ({placeholders}) RETURNING *",
            vals,
        )
        row = cur.fetchone()
        conn.commit()

    return _row_to_profile(row)


def update_profile(user_id: str, profile_id: str, data: dict[str, Any]) -> dict[str, Any] | None:
    snake = _to_snake(data)
    now = datetime.now(tz=UTC)

    # Only update fields that were provided (None would violate NOT NULL defaults)
    allowed = set(_PROFILE_FIELDS)
    updates = {k: v for k, v in snake.items() if k in allowed and v is not None}
    updates["updated_at"] = now

    set_clause = ", ".join(f"{k} = %s" for k in updates)
    vals = list(updates.values()) + [profile_id, user_id]

    with get_db_connection() as conn, conn.cursor() as cur:
        if updates.get("is_default"):
            cur.execute(
                "UPDATE branding_profiles SET is_default = FALSE WHERE user_id = %s AND id != %s",
                [user_id, profile_id],
            )
        cur.execute(
            f"UPDATE branding_profiles SET {set_clause} WHERE id = %s AND user_id = %s RETURNING *",
            vals,
        )
        row = cur.fetchone()
        conn.commit()

    return _row_to_profile(row) if row else None


def delete_profile(user_id: str, profile_id: str) -> bool:
    if not is_db_available():
        return False
    with get_db_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "DELETE FROM branding_profiles WHERE id = %s AND user_id = %s",
            [profile_id, user_id],
        )
        deleted = cur.rowcount > 0
        conn.commit()
    return deleted


def set_default_profile(user_id: str, profile_id: str) -> dict[str, Any] | None:
    with get_db_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE branding_profiles SET is_default = FALSE WHERE user_id = %s",
            [user_id],
        )
        cur.execute(
            """
            UPDATE branding_profiles
               SET is_default = TRUE, updated_at = NOW()
             WHERE id = %s AND user_id = %s
            RETURNING *
            """,
            [profile_id, user_id],
        )
        row = cur.fetchone()
        conn.commit()
    return _row_to_profile(row) if row else None
