"""
InjectionAgent: Auto-extract template form fields from uploaded documents.

Given a template_id and document, this agent:
1. Fetches the template's allowed field schema
2. Builds smart RAG queries from field labels and runs multi-query vector search
3. Deduplicates and ranks retrieved chunks (hybrid: vector + keyword scoring)
4. Uses LLM to extract ONLY the allowed fields from the retrieved context
5. Performs field-level merge (never overwrites user-edited fields)
6. Upserts extracted values into template_user_field_values

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

DEFAULT_MODEL = "gemini-flash-lite-latest"

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


def _parse_llm_json(raw_text: str) -> Optional[Dict[str, Any]]:
    """
    Parse JSON from LLM response, stripping markdown code blocks if present.

    WHY: LLMs sometimes wrap JSON in ```json ... ``` blocks despite
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
        
        # Handle case where LLM returns a list [ { ... } ]
        if isinstance(parsed, list):
            if len(parsed) > 0 and isinstance(parsed[0], dict):
                logger.info("[InjectionAgent][JSON_PARSE] LLM returned a list, using first element")
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
    document_text = _resolve_document_text(raw_text, source_document_id, user_id, fields_schema=fields_schema)

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
    # Step 5: Call LLM (Gemini or Claude)
    # ------------------------------------------------------------------
    try:
        from services.agent_config_service import get_agent_by_type
        from services.llm_service import call_llm

        # Injection agent usually doesn't have a specific prompt in DB, 
        # but we check anyway. If not found, _build_extraction_prompt is used.
        agent = get_agent_by_type("injection") or get_agent_by_type("extraction")
        model = agent.get("resolved_model") if agent else DEFAULT_MODEL
        db_system_prompt = (agent.get("prompt") or "").strip() if agent else ""

        # Build prompt using our template logic
        extraction_prompt = _build_extraction_prompt(fields_schema, document_text)
        
        logger.info("[InjectionAgent][LLM] Calling model=%s", model)
        gemini_text = call_llm(
            prompt=extraction_prompt,
            system_prompt=db_system_prompt,
            model=model,
            response_mime_type="application/json"
        )

        if not gemini_text:
            logger.error("[InjectionAgent][LLM] LLM returned no content")
            _safe_update_status(template_id, user_id, draft_session_id, "failed", "LLM returned no content")
            return _terminated(REASON_AI_FAILURE, "LLM returned no content")

        logger.info(
            "[InjectionAgent][LLM] Response received: %d chars",
            len(gemini_text)
        )

    except Exception as e:
        logger.exception("[InjectionAgent][LLM] LLM call failed")
        _safe_update_status(template_id, user_id, draft_session_id, "failed", f"LLM API error: {e}")
        return _terminated(REASON_AI_FAILURE, f"LLM call failed: {e}")

    # ------------------------------------------------------------------
    # Step 6: Parse JSON response
    # ------------------------------------------------------------------
    parsed_fields = _parse_llm_json(gemini_text)

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

def _build_rag_queries(fields_schema: List[Dict[str, Any]]) -> List[str]:
    """
    Build 3 complementary search queries from field labels.

    WHY: A single query can't surface all field types equally. Splitting by
    field category (parties, dates/amounts, location/property) covers more
    of the document in fewer vector calls than querying per-field.
    """
    # Collect all human-readable labels from the schema
    labels = [
        (f.get("field_label") or f.get("field_name") or "").strip()
        for f in fields_schema
        if f.get("field_label") or f.get("field_name")
    ]
    label_text = ", ".join(labels[:30]) if labels else ""

    queries = [
        # Global catch-all — surfaces the most content-dense chunks
        f"parties names addresses dates amounts payment agreement contract details {label_text}",
        # Party-focused
        "petitioner respondent applicant plaintiff defendant client name address contact",
        # Dates and financial
        "date of agreement execution payment amount fee consideration stamp duty registration",
    ]
    return queries


def _fetch_context_via_rag(
    fields_schema: List[Dict[str, Any]],
    source_document_id: Optional[str],
    user_id: Any,
    top_k_per_query: int = 15,
) -> Optional[str]:
    """
    Multi-query RAG retrieval: run 3 vector searches, deduplicate, rank.

    Strategy:
      1. Build 3 complementary queries from field labels (parties, dates, amounts, etc.)
      2. Embed each query and run vector search scoped to this document
      3. Deduplicate chunks by chunk_id; boost chunks appearing in multiple queries
      4. Take top-30 unique chunks ordered by combined score
      5. Return their content joined as context for the LLM

    WHY better than full-text dump:
      - Large documents (100+ pages) overflow the context window
      - Relevant field values are often in a small subset of pages
      - Multi-query covers different field types without per-field overhead
    """
    try:
        from services.db import find_nearest_chunks
        from services.embedding_service import generate_embeddings

        file_ids = [str(source_document_id)] if source_document_id else None
        queries = _build_rag_queries(fields_schema)

        # chunk_id → {"content": ..., "score": float, "hits": int}
        chunk_map: Dict[str, Any] = {}

        for q in queries:
            try:
                embeddings = generate_embeddings([q])
                if not embeddings or not embeddings[0]:
                    continue
                rows = find_nearest_chunks(
                    embedding=embeddings[0],
                    limit=top_k_per_query,
                    file_ids=file_ids,
                    user_id=int(user_id),
                )
                for row in rows:
                    cid = str(row.get("chunk_id") or "")
                    content = row.get("content") or ""
                    if not cid or not content.strip():
                        continue
                    similarity = float(row.get("similarity") or (1 - float(row.get("distance") or 1)))
                    if cid in chunk_map:
                        # Seen in multiple queries → boost score and increment hit count
                        chunk_map[cid]["score"] = max(chunk_map[cid]["score"], similarity)
                        chunk_map[cid]["hits"] += 1
                    else:
                        chunk_map[cid] = {
                            "content": content,
                            "score": similarity,
                            "hits": 1,
                            "page": row.get("page_start"),
                            "heading": row.get("heading") or "",
                        }
            except Exception as e:
                logger.warning("[InjectionAgent][RAG] Query failed (continuing): %s", e)

        if not chunk_map:
            logger.warning("[InjectionAgent][RAG] Vector search returned no chunks; falling back to ordered text")
            return _fetch_ordered_text(source_document_id, user_id)

        # Rank: primary = hit count (multi-query coverage), secondary = similarity score
        ranked = sorted(
            chunk_map.values(),
            key=lambda c: (c["hits"], c["score"]),
            reverse=True,
        )

        # Cap to top 30 chunks to stay within reasonable context size
        top_chunks = ranked[:30]
        logger.info(
            "[InjectionAgent][RAG] Retrieved %d unique chunks from %d queries (top %d used)",
            len(chunk_map), len(queries), len(top_chunks),
        )

        # Build context with optional heading/page labels for better LLM accuracy
        parts = []
        for c in top_chunks:
            header = ""
            if c.get("heading"):
                header = f"[{c['heading']}] "
            elif c.get("page") is not None:
                header = f"[Page {c['page']}] "
            parts.append(f"{header}{c['content'].strip()}")

        context = "\n\n---\n\n".join(parts)
        logger.info("[InjectionAgent][RAG] Context assembled: %d chars", len(context))
        return context

    except Exception as e:
        logger.exception("[InjectionAgent][RAG] RAG retrieval failed; falling back to ordered text")
        return _fetch_ordered_text(source_document_id, user_id)


def _fetch_ordered_text(
    source_document_id: Optional[str],
    user_id: Any,
    max_chars: int = 40000,
) -> Optional[str]:
    """
    Fallback: fetch chunks in page order, truncated to max_chars.
    Used when RAG/vector search is unavailable or returns no results.
    """
    if not source_document_id:
        return None
    try:
        from services.db import get_conn
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT content FROM file_chunks
                    WHERE file_id = %s::uuid
                    ORDER BY chunk_index ASC
                    LIMIT 100
                    """,
                    (str(source_document_id),),
                )
                rows = cur.fetchall()
        if rows:
            text = "\n".join(r[0] for r in rows if r[0])
            if len(text) > max_chars:
                text = text[:max_chars]
                logger.info("[InjectionAgent][FALLBACK] Text truncated to %d chars", max_chars)
            logger.info("[InjectionAgent][FALLBACK] Ordered text: %d chunks, %d chars", len(rows), len(text))
            return text
    except Exception as e:
        logger.exception("[InjectionAgent][FALLBACK] DB lookup failed for file_id=%s", source_document_id)
    return None


def _resolve_document_text(
    raw_text: Optional[str],
    source_document_id: Optional[str],
    user_id: Any,
    fields_schema: Optional[List[Dict[str, Any]]] = None,
) -> Optional[str]:
    """
    Resolve document context using RAG retrieval (primary) or raw_text (if provided directly).

    Priority:
      1. raw_text provided directly → use as-is (truncated to 40k chars if very large)
      2. source_document_id → multi-query RAG retrieval (vector search on file_chunks)
      3. Fallback → ordered chunk text (first 40k chars)
    """
    if raw_text and raw_text.strip():
        text = raw_text.strip()
        if len(text) > 40000:
            text = text[:40000]
            logger.info("[InjectionAgent][DOC_FETCH] raw_text truncated to 40000 chars")
        else:
            logger.info("[InjectionAgent][DOC_FETCH] Using provided raw_text (%d chars)", len(text))
        return text

    if source_document_id:
        logger.info("[InjectionAgent][DOC_FETCH] Running RAG retrieval for file_id=%s", source_document_id)
        return _fetch_context_via_rag(
            fields_schema=fields_schema or [],
            source_document_id=source_document_id,
            user_id=user_id,
        )

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
