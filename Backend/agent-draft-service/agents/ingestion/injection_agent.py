"""
InjectionAgent: Auto-extract template form fields from uploaded documents.

Given a template_id and document text, this agent:
1. Fetches the template's allowed field schema
2. Uses Gemini to extract ONLY those fields from the document
3. Performs field-level merge (never overwrites user-edited fields)
4. Upserts extracted values into template_user_field_values

Called standalone via POST /api/extract-fields or as a best-effort
step after document ingestion in orchestrate_upload.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_MODEL = "gemini-2.0-flash"

# Termination reasons (used in return contract)
REASON_SCHEMA_MISSING = "schema_missing"
REASON_DOCUMENT_EMPTY = "document_empty"
REASON_AI_FAILURE = "ai_failure"
REASON_JSON_PARSE_ERROR = "json_parse_error"
REASON_DB_FAILURE = "db_failure"


def _terminated(reason: str, error_msg: Optional[str] = None) -> Dict[str, Any]:
    """Build a terminated return contract."""
    return {
        "status": "terminated",
        "reason": reason,
        "extracted_fields": {},
        "skipped_fields": [],
        "errors": error_msg,
    }


# ---------------------------------------------------------------------------
# Gemini prompt builder
# ---------------------------------------------------------------------------

def _build_extraction_prompt(
    fields_schema: List[Dict[str, Any]],
    document_text: str,
) -> str:
    """
    Build the Gemini prompt that instructs the model to extract field values.

    WHY: We pass the exact field schema so the model extracts ONLY allowed
    fields and doesn't hallucinate extra keys. We mandate JSON output so
    parsing is deterministic.
    """
    # Build human-readable field descriptions for the LLM
    field_descriptions = []
    for f in fields_schema:
        name = f.get("field_name", "")
        label = f.get("field_label", name)
        ftype = f.get("field_type", "text")
        required = f.get("is_required", False)
        desc = f"- {name} ({ftype}): {label}"
        if required:
            desc += " [REQUIRED]"
        field_descriptions.append(desc)

    fields_block = "\n".join(field_descriptions)

    return f"""You are a legal document analyst. Extract field values from the
document text below and return them as a JSON object.

RULES:
1. Extract ONLY the fields listed below. Do NOT add extra fields.
2. If a field value cannot be found in the document, set its value to null.
3. Do NOT hallucinate or guess values. Only extract what is explicitly stated.
4. For date fields, use ISO format (YYYY-MM-DD) when possible.
5. For number fields, return numeric values without currency symbols.
6. Return ONLY a valid JSON object. No markdown, no explanation, no code blocks.

ALLOWED FIELDS:
{fields_block}

DOCUMENT TEXT:
{document_text}

Return a JSON object with field names as keys and extracted values as values.
Example: {{"field_name_1": "value1", "field_name_2": 12345, "field_name_3": null}}
"""


def _parse_gemini_json(raw_text: str) -> Optional[Dict[str, Any]]:
    """
    Parse JSON from Gemini response, stripping markdown code blocks if present.

    WHY: Gemini sometimes wraps JSON in ```json ... ``` blocks despite
    instructions. We handle both clean JSON and wrapped JSON.
    """
    if not raw_text:
        return None

    cleaned = raw_text.strip()

    # Strip markdown code blocks: ```json ... ``` or ``` ... ```
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    cleaned = cleaned.strip()

    try:
        parsed = json.loads(cleaned)
        
        # Handle case where Gemini returns a list [ { ... } ]
        if isinstance(parsed, list):
            if len(parsed) > 0 and isinstance(parsed[0], dict):
                logger.info("[InjectionAgent][JSON_PARSE] Gemini returned a list, using first element")
                return parsed[0]
            else:
                logger.warning("[InjectionAgent][JSON_PARSE] Parsed value is a list but empty or first element not dict")
                return None
        
        if isinstance(parsed, dict):
            return parsed
            
        logger.warning("[InjectionAgent][JSON_PARSE] Parsed value is not a dict or list[dict]: %s", type(parsed))
        return None
    except json.JSONDecodeError as e:
        logger.error("[InjectionAgent][JSON_PARSE] Failed to parse JSON: %s", e)
        return None


# ---------------------------------------------------------------------------
# Main agent entry point
# ---------------------------------------------------------------------------

def run_injection_agent(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Run the InjectionAgent. Extracts template field values from document text.

    Payload:
        - template_id: str (required) — which template's fields to extract
        - user_id: int (required) — owner of the field values
        - draft_session_id: str (optional) — links to a specific draft session
        - source_document_id: str (optional) — document to fetch text from
        - raw_text: str (optional) — if provided, use directly instead of DB lookup

    Returns:
        {
            "status": "completed" | "partial" | "terminated",
            "reason": null | "schema_missing" | "document_empty" | ...,
            "extracted_fields": { ... },
            "skipped_fields": ["field_a", ...],
            "errors": null | "error message"
        }
    """
    logger.info("[InjectionAgent][INIT] Agent initialized with payload keys: %s", list(payload.keys()))

    # ------------------------------------------------------------------
    # Step 1: Validate inputs
    # ------------------------------------------------------------------
    template_id = payload.get("template_id")
    user_id = payload.get("user_id")
    draft_session_id = payload.get("draft_session_id")
    source_document_id = payload.get("source_document_id")
    raw_text = payload.get("raw_text")

    if not template_id:
        logger.error("[InjectionAgent][VALIDATE] template_id is missing or empty")
        return _terminated("validation_error", "template_id is required")

    if not user_id:
        logger.error("[InjectionAgent][VALIDATE] user_id is missing or empty")
        return _terminated("validation_error", "user_id is required")

    logger.info(
        "[InjectionAgent][VALIDATE] Inputs valid: template_id=%s, user_id=%s, "
        "draft_session_id=%s, source_document_id=%s, raw_text_len=%s",
        template_id, user_id, draft_session_id,
        source_document_id, len(raw_text) if raw_text else 0,
    )

    # ------------------------------------------------------------------
    # Step 2: Fetch template field schema
    # ------------------------------------------------------------------
    try:
        from services.draft_db import get_template_fields_with_fallback
        fields_schema = get_template_fields_with_fallback(str(template_id))
        logger.info(
            "[InjectionAgent][SCHEMA_FETCH] Fetched %d template fields for template_id=%s",
            len(fields_schema), template_id,
        )
    except Exception as e:
        logger.exception("[InjectionAgent][SCHEMA_FETCH] Failed to fetch template fields")
        _safe_update_status(template_id, user_id, draft_session_id, "failed", str(e))
        return _terminated(REASON_SCHEMA_MISSING, f"Failed to fetch template fields: {e}")

    if not fields_schema:
        logger.warning("[InjectionAgent][SCHEMA_FETCH] No fields found for template_id=%s → terminating", template_id)
        _safe_update_status(template_id, user_id, draft_session_id, "failed", "No template fields defined")
        return _terminated(REASON_SCHEMA_MISSING, "No template fields defined for this template")

    # Build the set of allowed field names for validation
    allowed_fields = {f.get("field_name") for f in fields_schema if f.get("field_name")}
    logger.info("[InjectionAgent][SCHEMA_FETCH] Allowed fields: %s", sorted(allowed_fields))

    # ------------------------------------------------------------------
    # Step 3: Fetch document text
    # ------------------------------------------------------------------
    document_text = _resolve_document_text(raw_text, source_document_id, user_id)

    if not document_text or not document_text.strip():
        logger.warning("[InjectionAgent][DOC_FETCH] Document text is empty → terminating")
        _safe_update_status(template_id, user_id, draft_session_id, "failed", "Document text is empty")
        return _terminated(REASON_DOCUMENT_EMPTY, "No document text available for extraction")

    logger.info(
        "[InjectionAgent][DOC_FETCH] Document text resolved: %d chars (preview: %s...)",
        len(document_text), document_text[:100].replace("\n", " "),
    )

    # ------------------------------------------------------------------
    # Step 4: Build Gemini prompt
    # ------------------------------------------------------------------
    prompt = _build_extraction_prompt(fields_schema, document_text)
    logger.info("[InjectionAgent][PROMPT] Prompt built: %d chars, %d fields", len(prompt), len(fields_schema))

    # ------------------------------------------------------------------
    # Step 5: Call Gemini
    # ------------------------------------------------------------------
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        logger.error("[InjectionAgent][GEMINI] No API key found (GEMINI_API_KEY / GOOGLE_API_KEY)")
        _safe_update_status(template_id, user_id, draft_session_id, "failed", "Gemini API key not configured")
        return _terminated(REASON_AI_FAILURE, "Gemini API key not configured")

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)

        # WHY JSON mode: Ensures Gemini returns parseable JSON instead of prose
        generate_config = types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(thinking_budget=0),
            response_mime_type="application/json",
        )

        logger.info("[InjectionAgent][GEMINI] Calling Gemini model=%s", DEFAULT_MODEL)
        response = client.models.generate_content(
            model=DEFAULT_MODEL,
            contents=[prompt],
            config=generate_config,
        )

        gemini_text = response.text if response and response.text else ""
        logger.info(
            "[InjectionAgent][GEMINI] Response received: %d chars (preview: %s...)",
            len(gemini_text), gemini_text[:200].replace("\n", " "),
        )

    except Exception as e:
        logger.exception("[InjectionAgent][GEMINI] Gemini call failed")
        _safe_update_status(template_id, user_id, draft_session_id, "failed", f"Gemini API error: {e}")
        return _terminated(REASON_AI_FAILURE, f"Gemini call failed: {e}")

    # ------------------------------------------------------------------
    # Step 6: Parse JSON response
    # ------------------------------------------------------------------
    parsed_fields = _parse_gemini_json(gemini_text)

    if parsed_fields is None:
        logger.error("[InjectionAgent][JSON_PARSE] Could not parse Gemini response as JSON")
        _safe_update_status(template_id, user_id, draft_session_id, "failed", "JSON parse error on Gemini response")
        return _terminated(REASON_JSON_PARSE_ERROR, "Could not parse Gemini response as JSON")

    # Validate: keep only keys that exist in the allowed field set
    validated_fields: Dict[str, Any] = {}
    discarded_keys: List[str] = []
    for key, value in parsed_fields.items():
        if key in allowed_fields:
            validated_fields[key] = value
        else:
            discarded_keys.append(key)

    if discarded_keys:
        logger.warning(
            "[InjectionAgent][JSON_PARSE] Discarded %d unknown keys: %s",
            len(discarded_keys), discarded_keys,
        )

    logger.info(
        "[InjectionAgent][JSON_PARSE] Validated %d fields from Gemini response",
        len(validated_fields),
    )

    # ------------------------------------------------------------------
    # Step 7: Field-level merge with existing user-edited fields
    # ------------------------------------------------------------------
    try:
        from services.draft_db import get_existing_user_field_values

        existing = get_existing_user_field_values(
            template_id=str(template_id),
            user_id=int(user_id),
            draft_session_id=str(draft_session_id) if draft_session_id else None,
        )
    except Exception as e:
        logger.warning("[InjectionAgent][MERGE] Could not fetch existing values (proceeding with full write): %s", e)
        existing = None

    skipped_fields: List[str] = []
    merged_fields: Dict[str, Any] = {}

    if existing and existing.get("user_edited_fields"):
        # WHY field-level merge: If user edited 2 of 12 fields, agent fills
        # the remaining 10. Only individually user-edited fields are protected.
        user_edited = set(existing["user_edited_fields"])
        existing_values = existing.get("field_values") or {}

        logger.info(
            "[InjectionAgent][MERGE] Found %d user-edited fields: %s",
            len(user_edited), sorted(user_edited),
        )

        for field_name, extracted_value in validated_fields.items():
            if field_name in user_edited:
                # Preserve user's value — do NOT overwrite
                skipped_fields.append(field_name)
                merged_fields[field_name] = existing_values.get(field_name)
                logger.info(
                    "[InjectionAgent][MERGE] SKIP field '%s' (user-edited, preserving value)",
                    field_name,
                )
            else:
                merged_fields[field_name] = extracted_value
                logger.info(
                    "[InjectionAgent][MERGE] FILL field '%s' = %s",
                    field_name, repr(extracted_value)[:80],
                )

        # Also preserve any user-edited fields that weren't in the extraction
        for uf in user_edited:
            if uf not in merged_fields and uf in existing_values:
                merged_fields[uf] = existing_values[uf]

    else:
        # No existing user edits — all extracted fields go through
        merged_fields = validated_fields
        logger.info("[InjectionAgent][MERGE] No existing user edits — using all %d extracted fields", len(merged_fields))

    # Determine status based on how many fields were extracted vs skipped
    if not validated_fields:
        status = "partial"
    elif skipped_fields:
        status = "partial"
    else:
        status = "completed"

    logger.info(
        "[InjectionAgent][MERGE] Merge complete: %d filled, %d skipped → status=%s",
        len(merged_fields) - len(skipped_fields), len(skipped_fields), status,
    )

    # ------------------------------------------------------------------
    # Step 8: Upsert to database
    # ------------------------------------------------------------------
    try:
        from services.draft_db import upsert_extracted_field_values

        upsert_extracted_field_values(
            template_id=str(template_id),
            user_id=int(user_id),
            draft_session_id=str(draft_session_id) if draft_session_id else None,
            source_document_id=str(source_document_id) if source_document_id else None,
            field_values=merged_fields,
            filled_by="agent",
            extraction_status=status,
        )

        logger.info(
            "[InjectionAgent][DB_UPSERT] Successfully upserted field values for "
            "template_id=%s, user_id=%s, draft_session_id=%s",
            template_id, user_id, draft_session_id,
        )

    except Exception as e:
        logger.exception("[InjectionAgent][DB_UPSERT] Database upsert failed")
        return {
            "status": "terminated",
            "reason": REASON_DB_FAILURE,
            "extracted_fields": validated_fields,
            "skipped_fields": skipped_fields,
            "errors": f"Database upsert failed: {e}",
        }

    # ------------------------------------------------------------------
    # Step 9: Return result
    # ------------------------------------------------------------------
    # WHY we return extracted_fields (not merged_fields): The caller needs to
    # know what the agent extracted. Skipped_fields tells them what was
    # protected. The merged result is already in the DB.
    result = {
        "status": status,
        "reason": None,
        "extracted_fields": validated_fields,
        "skipped_fields": skipped_fields,
        "errors": None,
    }

    logger.info(
        "[InjectionAgent][DONE] Agent terminated successfully: status=%s, "
        "extracted=%d, skipped=%d",
        status, len(validated_fields), len(skipped_fields),
    )

    return result


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _resolve_document_text(
    raw_text: Optional[str],
    source_document_id: Optional[str],
    user_id: Any,
) -> Optional[str]:
    """
    Resolve document text from either raw_text param or DB lookup.

    WHY: Callers may provide text directly (from a just-ingested document)
    or reference an already-stored document by ID.
    """
    # Prefer raw_text if provided
    if raw_text and raw_text.strip():
        logger.info("[InjectionAgent][DOC_FETCH] Using provided raw_text (%d chars)", len(raw_text))
        return raw_text.strip()

    # Fall back to DB lookup by source_document_id
    if source_document_id:
        try:
            from services.db import get_conn
            logger.info(
                "[InjectionAgent][DOC_FETCH] Looking up document text for file_id=%s",
                source_document_id,
            )
            with get_conn() as conn:
                from psycopg2.extras import RealDictCursor
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    # Fetch and concatenate chunk text for this document
                    cur.execute(
                        """
                        SELECT content
                        FROM file_chunks
                        WHERE file_id = %s::uuid
                        ORDER BY chunk_index ASC
                        """,
                        (str(source_document_id),),
                    )
                    rows = cur.fetchall()

            if rows:
                full_text = "\n".join(r["content"] for r in rows if r.get("content"))
                logger.info(
                    "[InjectionAgent][DOC_FETCH] Assembled %d chunks → %d chars",
                    len(rows), len(full_text),
                )
                return full_text
            else:
                logger.warning(
                    "[InjectionAgent][DOC_FETCH] No chunks found for file_id=%s",
                    source_document_id,
                )
                return None

        except Exception as e:
            logger.exception(
                "[InjectionAgent][DOC_FETCH] DB lookup failed for file_id=%s",
                source_document_id,
            )
            return None

    logger.warning("[InjectionAgent][DOC_FETCH] No raw_text and no source_document_id provided")
    return None


def _safe_update_status(
    template_id: str,
    user_id: Any,
    draft_session_id: Optional[str],
    status: str,
    error_msg: str,
) -> None:
    """
    Best-effort status update. If DB write fails, log and move on.

    WHY: When the agent terminates due to an error, we want the status
    in the DB to reflect that. But if the DB itself is down, we must not
    crash — just log.
    """
    try:
        from services.draft_db import update_extraction_status
        update_extraction_status(
            template_id=str(template_id),
            user_id=int(user_id),
            draft_session_id=str(draft_session_id) if draft_session_id else None,
            extraction_status=status,
            extraction_error=error_msg,
        )
    except Exception as e:
        logger.warning(
            "[InjectionAgent][STATUS_UPDATE] Could not update extraction status in DB: %s", e,
        )
