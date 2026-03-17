"""
InjectionAgent v2: Auto-extract and synthesize ALL template form fields from case documents.

Key improvements over v1:
- Uses Claude claude-haiku-4-5-20251001 (or configured model from DB) — superior legal comprehension
- Fetches ALL case documents via get_file_ids_for_case (not just one best file)
- Per-field targeted RAG queries for precise, high-coverage chunk retrieval
- Dual-mode LLM prompt: strict extraction for short fields, intelligent synthesis for long-text
- Filters null/empty values — only stores actually populated fields
- Accepts case_id in payload for full multi-document case context
- Checks DB agent config for "injection"/"extraction"/"autopopulation" types first

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

# Default: Claude Haiku 4.5 — fast, cost-efficient, excellent at legal extraction
DEFAULT_MODEL = "claude-haiku-4-5-20251001"

# Field types that should be strictly extracted (no synthesis)
EXTRACTABLE_TYPES = {"text", "date", "number", "select", "email", "phone", "url", "integer", "float"}
# Field types that should be synthesized / composed from context
SYNTHESIS_TYPES = {"textarea", "long_text", "paragraph", "rich_text", "multiline", "text_area"}

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
# Field classification helpers
# ---------------------------------------------------------------------------

def _is_synthesis_field(field: Dict[str, Any]) -> bool:
    """Return True if field requires synthesis (long-text composition), not just extraction."""
    ftype = (field.get("field_type") or "text").lower().strip()
    fname = (field.get("field_name") or "").lower()
    flabel = (field.get("field_label") or "").lower()

    if ftype in SYNTHESIS_TYPES:
        return True

    # Name/label heuristic — these fields always need composed paragraphs
    synthesis_keywords = (
        "facts", "grounds", "prayer", "relief", "background", "detail",
        "description", "narrative", "statement", "information", "particulars",
        "summary", "submission", "argument", "cause", "reason", "question",
        "interim", "allegation", "charge", "complaint", "dispute",
    )
    combined = fname + " " + flabel
    return any(kw in combined for kw in synthesis_keywords)


def _classify_fields(fields_schema: List[Dict[str, Any]]) -> tuple[List[Dict], List[Dict]]:
    """Return (extractable_fields, synthesis_fields)."""
    extractable, synthesis = [], []
    for f in fields_schema:
        if _is_synthesis_field(f):
            synthesis.append(f)
        else:
            extractable.append(f)
    return extractable, synthesis


# ---------------------------------------------------------------------------
# LLM prompt builders
# ---------------------------------------------------------------------------

def _build_extraction_prompt(
    fields_schema: List[Dict[str, Any]],
    document_text: str,
) -> str:
    """
    Build a dual-mode extraction prompt:
    - Extractable fields (text/date/number/select): strict extraction from document
    - Synthesis fields (textarea/paragraph/long_text): intelligent composition from context

    WHY: A single "don't hallucinate" prompt causes the LLM to return null for every
    complex field like facts_of_case, grounds, prayer_reliefs. Those fields NEED
    synthesis — they cannot be extracted verbatim from a document.
    """
    extractable_fields, synthesis_fields = _classify_fields(fields_schema)

    # Build extractable field descriptions
    extractable_block = ""
    if extractable_fields:
        lines = []
        for f in extractable_fields:
            name = f.get("field_name", "")
            label = f.get("field_label", name)
            ftype = f.get("field_type", "text")
            req = " [REQUIRED]" if f.get("is_required") else ""
            lines.append(f"  - {name} ({ftype}): {label}{req}")
        extractable_block = "\n".join(lines)

    # Build synthesis field descriptions
    synthesis_block = ""
    if synthesis_fields:
        lines = []
        for f in synthesis_fields:
            name = f.get("field_name", "")
            label = f.get("field_label", name)
            ftype = f.get("field_type", "textarea")
            req = " [REQUIRED]" if f.get("is_required") else ""
            lines.append(f"  - {name} ({ftype}): {label}{req}")
        synthesis_block = "\n".join(lines)

    prompt = f"""You are an expert legal document analyst. Populate ALL the fields listed below for a legal document template by analyzing the provided document context.

DOCUMENT CONTEXT:
{document_text}

==============================
PART A — EXTRACTABLE FIELDS (text, date, number, select)
Extract exact values from the document. Use common legal synonyms:
  - petitioner = plaintiff = applicant = complainant = claimant
  - respondent = defendant = accused = opposite party
  - For dates: use DD/MM/YYYY format
  - For court/case numbers: extract exactly as written
  - Return null ONLY if absolutely no related information exists anywhere in the document

FIELDS TO EXTRACT:
{extractable_block if extractable_block else "(none)"}

==============================
PART B — SYNTHESIS FIELDS (textarea, paragraph, long_text)
Compose comprehensive, legally appropriate plain text content based on ALL available context.
These fields require intelligent synthesis — DO NOT return null for these.
Guidelines:
  - facts_of_case / case_facts / background: Write numbered paragraphs (1., 2., 3.) describing who the parties are, what happened, chronology of events, key dates, amounts, and relevant circumstances
  - grounds / legal_grounds: Write lettered grounds (a., b., c.) with legal arguments and basis for the claim
  - prayer_reliefs / relief_sought / prayers: Write what relief/orders/directions are being sought, e.g. "a. That... b. That..."
  - questions_of_law: Write the legal questions raised in the case
  - interim_relief: Write the urgent relief sought pending final disposal
  - For any other synthesis field: Compose a thorough, coherent paragraph drawn from the document context
  - Write in plain text only. No markdown, no bullet symbols (use letters/numbers instead).
  - If context is limited, write what can be reasonably inferred and composed from available information

FIELDS TO SYNTHESIZE:
{synthesis_block if synthesis_block else "(none)"}

==============================
OUTPUT FORMAT:
Return ONLY a valid JSON object. No markdown, no explanation, no code blocks.
Keys must exactly match the field names listed above.
Example: {{"field_name_1": "extracted value", "field_name_2": "Composed paragraph text..."}}

IMPORTANT:
- Fill EVERY field to the best of your ability using the document context
- For synthesis fields, always provide composed content — never return null
- Only return null for extractable fields where the value genuinely cannot be found
"""
    return prompt


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
    Run the InjectionAgent. Extracts and synthesizes ALL template field values from case documents.

    Payload:
        - template_id: str (required) — which template's fields to extract
        - user_id: int (required) — owner of the field values
        - draft_session_id: str (optional) — links to a specific draft session
        - case_id: str (optional) — case ID to fetch ALL case documents from DB
        - file_ids: list[str] (optional) — explicit list of file IDs to search
        - source_document_id: str (optional) — single document fallback
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
    case_id = payload.get("case_id")
    file_ids_from_payload = payload.get("file_ids") or []
    raw_text = payload.get("raw_text")

    if not template_id:
        logger.error("[InjectionAgent][VALIDATE] template_id is missing or empty")
        return _terminated("validation_error", "template_id is required")

    if not user_id:
        logger.error("[InjectionAgent][VALIDATE] user_id is missing or empty")
        return _terminated("validation_error", "user_id is required")

    logger.info(
        "[InjectionAgent][VALIDATE] Inputs valid: template_id=%s, user_id=%s, "
        "draft_session_id=%s, case_id=%s, source_document_id=%s, file_ids=%s, raw_text_len=%s",
        template_id, user_id, draft_session_id, case_id,
        source_document_id, file_ids_from_payload,
        len(raw_text) if raw_text else 0,
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
    logger.info("[InjectionAgent][SCHEMA_FETCH] Allowed fields (%d): %s", len(allowed_fields), sorted(allowed_fields))

    # ------------------------------------------------------------------
    # Step 3: Resolve all file IDs for context fetching
    # ------------------------------------------------------------------
    resolved_file_ids: List[str] = list(file_ids_from_payload)

    # If case_id provided, get ALL files in that case (primary source)
    if case_id and not resolved_file_ids:
        try:
            from services.db import get_file_ids_for_case
            case_file_ids = get_file_ids_for_case(str(case_id), int(user_id))
            if case_file_ids:
                resolved_file_ids = case_file_ids
                logger.info(
                    "[InjectionAgent][FILE_RESOLVE] Resolved %d files from case_id=%s",
                    len(case_file_ids), case_id,
                )
            else:
                logger.warning("[InjectionAgent][FILE_RESOLVE] case_id=%s returned no files", case_id)
        except Exception as e:
            logger.warning("[InjectionAgent][FILE_RESOLVE] Could not fetch case files: %s", e)

    # Fall back to single source_document_id if still no file_ids
    if not resolved_file_ids and source_document_id:
        resolved_file_ids = [str(source_document_id)]
        logger.info("[InjectionAgent][FILE_RESOLVE] Using source_document_id as single file: %s", source_document_id)

    logger.info("[InjectionAgent][FILE_RESOLVE] Final file_ids for RAG: %s", resolved_file_ids)

    # ------------------------------------------------------------------
    # Step 4: Fetch document text via multi-doc RAG
    # ------------------------------------------------------------------
    document_text = _resolve_document_text(
        raw_text=raw_text,
        file_ids=resolved_file_ids,
        user_id=user_id,
        fields_schema=fields_schema,
    )

    if not document_text or not document_text.strip():
        logger.warning("[InjectionAgent][DOC_FETCH] Document text is empty → terminating")
        _safe_update_status(template_id, user_id, draft_session_id, "failed", "Document text is empty")
        return _terminated(REASON_DOCUMENT_EMPTY, "No document text available for extraction")

    logger.info(
        "[InjectionAgent][DOC_FETCH] Document text resolved: %d chars (preview: %s...)",
        len(document_text), document_text[:120].replace("\n", " "),
    )

    # ------------------------------------------------------------------
    # Step 5: Build dual-mode LLM prompt
    # ------------------------------------------------------------------
    prompt = _build_extraction_prompt(fields_schema, document_text)
    logger.info("[InjectionAgent][PROMPT] Prompt built: %d chars, %d fields", len(prompt), len(fields_schema))

    # ------------------------------------------------------------------
    # Step 6: Resolve model — DB config → default Claude Haiku 4.5
    # ------------------------------------------------------------------
    model = DEFAULT_MODEL
    db_system_prompt = ""
    temperature = 0.3

    try:
        from services.agent_config_service import get_agent_by_type

        # Try injection-specific agent types in priority order
        agent = (
            get_agent_by_type("injection")
            or get_agent_by_type("extraction")
            or get_agent_by_type("autopopulation")
        )
        if agent:
            model = agent.get("resolved_model") or DEFAULT_MODEL
            db_system_prompt = (agent.get("prompt") or "").strip()
            temperature = float(agent.get("temperature") or 0.3)
            logger.info("[InjectionAgent][CONFIG] Using DB agent config: model=%s, temp=%s", model, temperature)
        else:
            logger.info("[InjectionAgent][CONFIG] No DB agent config found, using default model=%s", model)
    except Exception as e:
        logger.warning("[InjectionAgent][CONFIG] Could not fetch agent config: %s — using default", e)

    # ------------------------------------------------------------------
    # Step 7: Call LLM
    # ------------------------------------------------------------------
    try:
        from services.llm_service import call_llm

        logger.info("[InjectionAgent][LLM] Calling model=%s, temperature=%s", model, temperature)
        llm_response = call_llm(
            prompt=prompt,
            system_prompt=db_system_prompt,
            model=model,
            temperature=temperature,
        )

        if not llm_response:
            logger.error("[InjectionAgent][LLM] LLM returned no content")
            _safe_update_status(template_id, user_id, draft_session_id, "failed", "LLM returned no content")
            return _terminated(REASON_AI_FAILURE, "LLM returned no content")

        logger.info("[InjectionAgent][LLM] Response received: %d chars", len(llm_response))

    except Exception as e:
        logger.exception("[InjectionAgent][LLM] LLM call failed")
        _safe_update_status(template_id, user_id, draft_session_id, "failed", f"LLM API error: {e}")
        return _terminated(REASON_AI_FAILURE, f"LLM call failed: {e}")

    # ------------------------------------------------------------------
    # Step 8: Parse JSON response
    # ------------------------------------------------------------------
    parsed_fields = _parse_llm_json(llm_response)

    if parsed_fields is None:
        logger.error("[InjectionAgent][JSON_PARSE] Could not parse LLM response as JSON")
        _safe_update_status(template_id, user_id, draft_session_id, "failed", "JSON parse error on LLM response")
        return _terminated(REASON_JSON_PARSE_ERROR, "Could not parse LLM response as JSON")

    # Validate: keep only allowed field keys; filter out nulls and empty strings
    validated_fields: Dict[str, Any] = {}
    discarded_keys: List[str] = []
    null_keys: List[str] = []

    for key, value in parsed_fields.items():
        if key not in allowed_fields:
            discarded_keys.append(key)
            continue
        # Filter out nulls and empty values — don't pollute DB with blanks
        if value is None:
            null_keys.append(key)
            continue
        if isinstance(value, str) and not value.strip():
            null_keys.append(key)
            continue
        validated_fields[key] = value

    if discarded_keys:
        logger.warning(
            "[InjectionAgent][JSON_PARSE] Discarded %d unknown keys: %s",
            len(discarded_keys), discarded_keys,
        )
    if null_keys:
        logger.info(
            "[InjectionAgent][JSON_PARSE] Filtered %d null/empty fields: %s",
            len(null_keys), null_keys,
        )

    logger.info(
        "[InjectionAgent][JSON_PARSE] Validated %d non-null fields from %d total LLM fields",
        len(validated_fields), len(parsed_fields),
    )

    # ------------------------------------------------------------------
    # Step 9: Field-level merge with existing user-edited fields
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

    # Determine status based on field coverage
    total_fields = len(fields_schema)
    filled_count = len(merged_fields) - len(skipped_fields)
    fill_ratio = filled_count / total_fields if total_fields > 0 else 0

    if not validated_fields:
        status = "partial"
    elif fill_ratio >= 0.7:
        status = "completed"
    elif skipped_fields or fill_ratio > 0:
        status = "partial"
    else:
        status = "partial"

    logger.info(
        "[InjectionAgent][MERGE] Merge complete: %d filled / %d total (%.0f%%), %d skipped → status=%s",
        filled_count, total_fields, fill_ratio * 100, len(skipped_fields), status,
    )

    # ------------------------------------------------------------------
    # Step 10: Upsert to database
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
    # Step 11: Return result
    # ------------------------------------------------------------------
    result = {
        "status": status,
        "reason": None,
        "extracted_fields": validated_fields,
        "skipped_fields": skipped_fields,
        "errors": None,
    }

    logger.info(
        "[InjectionAgent][DONE] Agent completed: status=%s, extracted=%d/%d (%.0f%%), skipped=%d",
        status, filled_count, total_fields, fill_ratio * 100, len(skipped_fields),
    )

    return result


# ---------------------------------------------------------------------------
# RAG helpers
# ---------------------------------------------------------------------------

def _build_rag_queries(fields_schema: List[Dict[str, Any]]) -> List[str]:
    """
    Build targeted search queries from field labels + global legal queries.

    WHY: A single query can't surface all field types equally. We build:
    - Global catch-all queries (parties, dates, amounts)
    - Per-field targeted queries for every field label
    This ensures every field has a good chance of finding relevant chunks.
    """
    labels = [
        (f.get("field_label") or f.get("field_name") or "").strip()
        for f in fields_schema
        if f.get("field_label") or f.get("field_name")
    ]
    label_text = ", ".join(labels[:40]) if labels else ""

    queries = [
        # Global catch-all — surfaces dense content chunks
        f"parties names addresses dates amounts payment agreement contract details case facts {label_text}",
        # Party identity and details
        "petitioner respondent applicant plaintiff defendant claimant name address contact occupation",
        # Legal case structure
        "facts of case background dispute grievance cause of action legal grounds prayer relief sought",
        # Dates, financial, and procedural details
        "date of agreement execution payment amount fee consideration stamp duty registration court case number",
        # Location and property details
        "property address description plot survey number district taluka state jurisdiction court",
    ]

    # Add per-field targeted queries for better coverage on specific fields
    for field in fields_schema:
        label = (field.get("field_label") or field.get("field_name") or "").strip()
        if label and len(label) > 3:
            queries.append(f"{label} details information")

    return queries


def _fetch_context_via_rag(
    fields_schema: List[Dict[str, Any]],
    file_ids: Optional[List[str]],
    user_id: Any,
    top_k_per_query: int = 20,
) -> Optional[str]:
    """
    Multi-query RAG retrieval across ALL case files: run queries, deduplicate, rank.

    Strategy:
      1. Build targeted queries from field labels + global legal queries
      2. Embed each query and run vector search scoped to all case file_ids
      3. Deduplicate chunks by chunk_id; boost chunks appearing in multiple queries
      4. Take top-50 unique chunks ordered by combined score
      5. Return their content joined as context for the LLM

    WHY: Multi-document, multi-query approach covers all case files and all
    field types, giving the LLM comprehensive context to fill every field.
    """
    try:
        from services.db import find_nearest_chunks
        from services.embedding_service import generate_embeddings

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
                    file_ids=file_ids if file_ids else None,
                    user_id=int(user_id),
                )
                for row in rows:
                    cid = str(row.get("chunk_id") or "")
                    content = row.get("content") or ""
                    if not cid or not content.strip():
                        continue
                    similarity = float(row.get("similarity") or (1 - float(row.get("distance") or 1)))
                    if cid in chunk_map:
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
            return _fetch_ordered_text(file_ids, user_id)

        # Rank: primary = hit count (multi-query coverage), secondary = similarity score
        ranked = sorted(
            chunk_map.values(),
            key=lambda c: (c["hits"], c["score"]),
            reverse=True,
        )

        # Top 50 chunks for comprehensive coverage
        top_chunks = ranked[:50]
        logger.info(
            "[InjectionAgent][RAG] Retrieved %d unique chunks from %d queries (top %d used) across %d files",
            len(chunk_map), len(queries), len(top_chunks), len(file_ids) if file_ids else 0,
        )

        # Build context with heading/page labels for better LLM accuracy
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
        return _fetch_ordered_text(file_ids, user_id)


def _fetch_ordered_text(
    file_ids: Optional[List[str]],
    user_id: Any,
    max_chars: int = 60000,
) -> Optional[str]:
    """
    Fallback: fetch chunks in page order for all file_ids, truncated to max_chars.
    Used when RAG/vector search is unavailable or returns no results.
    """
    if not file_ids:
        return None
    try:
        from services.db import get_conn
        all_parts = []
        for fid in file_ids:
            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT content FROM file_chunks
                        WHERE file_id = %s::uuid
                        ORDER BY chunk_index ASC
                        LIMIT 150
                        """,
                        (str(fid),),
                    )
                    rows = cur.fetchall()
            if rows:
                all_parts.append("\n".join(r[0] for r in rows if r[0]))
        if all_parts:
            text = "\n\n---\n\n".join(all_parts)
            if len(text) > max_chars:
                text = text[:max_chars]
                logger.info("[InjectionAgent][FALLBACK] Text truncated to %d chars", max_chars)
            logger.info("[InjectionAgent][FALLBACK] Ordered text: %d files, %d chars", len(file_ids), len(text))
            return text
    except Exception as e:
        logger.exception("[InjectionAgent][FALLBACK] DB lookup failed for file_ids=%s", file_ids)
    return None


def _resolve_document_text(
    raw_text: Optional[str],
    file_ids: Optional[List[str]],
    user_id: Any,
    fields_schema: Optional[List[Dict[str, Any]]] = None,
) -> Optional[str]:
    """
    Resolve document context using multi-doc RAG (primary) or raw_text (if provided directly).

    Priority:
      1. raw_text provided directly → use as-is (truncated to 60k chars if very large)
      2. file_ids → multi-query RAG retrieval across ALL files in the list
      3. Fallback → ordered chunk text from all files
    """
    if raw_text and raw_text.strip():
        text = raw_text.strip()
        if len(text) > 60000:
            text = text[:60000]
            logger.info("[InjectionAgent][DOC_FETCH] raw_text truncated to 60000 chars")
        else:
            logger.info("[InjectionAgent][DOC_FETCH] Using provided raw_text (%d chars)", len(text))
        return text

    if file_ids:
        logger.info(
            "[InjectionAgent][DOC_FETCH] Running multi-doc RAG retrieval for %d files",
            len(file_ids),
        )
        return _fetch_context_via_rag(
            fields_schema=fields_schema or [],
            file_ids=file_ids,
            user_id=user_id,
        )

    logger.warning("[InjectionAgent][DOC_FETCH] No raw_text and no file_ids provided")
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
