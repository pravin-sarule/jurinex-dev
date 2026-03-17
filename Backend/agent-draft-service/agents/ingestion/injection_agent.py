"""
AutopopulationAgent v2: Auto-extract and synthesize ALL template form fields from case documents.

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

from concurrent.futures import ThreadPoolExecutor, as_completed
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
DEFAULT_MODEL = "claude-sonnet-4-5"

# Field types that should be strictly extracted (no synthesis)
# NOTE: "string" is the most common type in templates (maps from JSON "type": "string")
EXTRACTABLE_TYPES = {
    "text", "string", "date", "number", "integer", "float",
    "select", "email", "phone", "url", "address", "currency",
    "short_text", "single_line",
}
# Field types that should be synthesized / composed from context
SYNTHESIS_TYPES = {
    "textarea", "long_text", "text_long", "paragraph", "rich_text",
    "multiline", "text_area", "multi_line",
}

# When total chunks for all files is below this threshold, fetch ALL chunks
# instead of using RAG selection (ensures complete document coverage for short docs)
FULL_DOC_CHUNK_THRESHOLD = 80
FULL_TEXT_MAX_CHARS = 120000
FIELD_CONTEXT_MAX_CHARS = 24000
MAX_PARALLEL_FIELD_CALLS = 8

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


def _normalize_field_token(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")


def _safe_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (dict, list)):
        try:
            return json.dumps(value, ensure_ascii=True)
        except Exception:
            return str(value).strip()
    return str(value).strip()


def _truncate_text(value: str, max_chars: int) -> str:
    if not value:
        return ""
    return value[:max_chars] if len(value) > max_chars else value


def _field_lookup_keys(field: Dict[str, Any]) -> set[str]:
    keys = {
        _normalize_field_token(field.get("field_id")),
        _normalize_field_token(field.get("field_name")),
        _normalize_field_token(field.get("field_label")),
    }
    return {key for key in keys if key}


def _resolve_section_field_mappings(template_id: str, fields_schema: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """
    Build field_name -> section metadata using template_analysis_sections.section_prompts.
    """
    mapping: Dict[str, Dict[str, Any]] = {}
    if not template_id or not fields_schema:
        return mapping

    try:
        from services.draft_db import get_template_analysis_sections
        sections = get_template_analysis_sections(str(template_id))
    except Exception as e:
        logger.warning("[InjectionAgent][SECTION_MAP] Could not fetch section mappings: %s", e)
        return mapping

    token_to_field_names: Dict[str, List[str]] = {}
    for field in fields_schema:
        field_name = field.get("field_name")
        if not field_name:
            continue
        for token in _field_lookup_keys(field):
            token_to_field_names.setdefault(token, []).append(field_name)

    for section in sections:
        prompts = section.get("section_prompts") or []
        if isinstance(prompts, dict):
            prompts = [prompts]
        if not isinstance(prompts, list):
            continue

        default_prompt = ""
        for idx, prompt_item in enumerate(prompts):
            if not isinstance(prompt_item, dict):
                continue

            prompt_text = _safe_text(prompt_item.get("prompt"))
            if idx == 0 and prompt_text:
                default_prompt = prompt_text

            field_ref = (
                prompt_item.get("field_id")
                or prompt_item.get("field_name")
                or prompt_item.get("field_key")
            )
            matched_fields = token_to_field_names.get(_normalize_field_token(field_ref), []) if field_ref else []
            if not matched_fields:
                continue

            for field_name in matched_fields:
                mapping[field_name] = {
                    "section_key": _safe_text(section.get("section_key")) or _normalize_field_token(section.get("section_name")),
                    "section_name": _safe_text(section.get("section_name")) or "section",
                    "section_purpose": _safe_text(section.get("section_purpose")),
                    "section_intro": _safe_text(section.get("section_intro")),
                    "default_prompt": default_prompt,
                    "field_prompt": prompt_text,
                }

    return mapping


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

    # Build extractable field descriptions with description hints
    extractable_block = ""
    if extractable_fields:
        lines = []
        for f in extractable_fields:
            name = f.get("field_name", "")
            label = f.get("field_label", name)
            ftype = f.get("field_type", "text")
            req = " [REQUIRED]" if f.get("is_required") else ""
            hint = f.get("help_text") or f.get("placeholder") or ""
            hint_part = f" — {hint}" if hint else ""
            lines.append(f"  - {name} ({ftype}): {label}{req}{hint_part}")
        extractable_block = "\n".join(lines)

    # Build synthesis field descriptions with description hints
    synthesis_block = ""
    if synthesis_fields:
        lines = []
        for f in synthesis_fields:
            name = f.get("field_name", "")
            label = f.get("field_label", name)
            ftype = f.get("field_type", "textarea")
            req = " [REQUIRED]" if f.get("is_required") else ""
            hint = f.get("help_text") or f.get("placeholder") or ""
            hint_part = f" — {hint}" if hint else ""
            lines.append(f"  - {name} ({ftype}): {label}{req}{hint_part}")
        synthesis_block = "\n".join(lines)

    prompt = f"""You are an expert legal document analyst. Your task is to extract ALL field values from the document context below and return them as a single JSON object.

DOCUMENT CONTEXT:
{document_text}

==============================
PART A — EXTRACT THESE FIELDS (text, string, date, number, address, currency)
Read the document carefully and extract the exact values for each field.
Important extraction rules:
  - licensor = property owner = landlord = party of the first part
  - licensee = tenant = occupant = party of the second part = person paying rent
  - For agreement_date_in_words: convert the date to words, e.g. "First day of January, Two Thousand Twenty-Four"
  - For dates: use DD/MM/YYYY format
  - For currency/amounts: extract the numeric value only (e.g., 25000)
  - For amounts in words: e.g., "Twenty-Five Thousand Only"
  - For addresses: include the complete address as one string
  - For parentage (S/o, D/o, W/o): look for "son of", "daughter of", "wife of" or abbreviations S/o, D/o, W/o
  - For PAN: look for a 10-character alphanumeric code (e.g., ABCDE1234F)
  - For Aadhaar: look for a 12-digit number
  - For boundaries (North/South/East/West): look in the schedule or boundary table
  - Return null ONLY if the value is genuinely absent from the entire document

FIELDS TO EXTRACT:
{extractable_block if extractable_block else "(none)"}

==============================
PART B — SYNTHESIZE THESE FIELDS (textarea, paragraph, long_text)
Compose well-written plain text content from the available document context.
DO NOT return null for these — always compose something meaningful.
  - Write in plain text only (no markdown, no special symbols)
  - Use numbered lists (1., 2., 3.) for facts/background
  - Use lettered items (a., b., c.) for grounds and prayers

FIELDS TO SYNTHESIZE:
{synthesis_block if synthesis_block else "(none)"}

==============================
OUTPUT FORMAT:
Return ONLY a valid JSON object. No markdown fences, no explanation text.
Use exactly the field names shown above as JSON keys.
Example: {{"licensor_name": "Ramesh Kumar", "licensor_age": 45, "agreement_date_in_words": "First day of January, Two Thousand Twenty-Four"}}

    CRITICAL: Extract values for ALL fields listed. Missing nothing.
"""
    return prompt


def _build_field_extraction_prompt(
    field: Dict[str, Any],
    field_context: str,
    full_document_text: str,
    section_meta: Optional[Dict[str, Any]] = None,
) -> str:
    field_name = field.get("field_name", "")
    field_label = field.get("field_label") or field_name
    field_type = (field.get("field_type") or "text").lower().strip()
    is_synthesis = _is_synthesis_field(field)
    instructions = []

    hint = _safe_text(field.get("help_text") or field.get("placeholder"))
    if hint:
        instructions.append(f"Field hint: {hint}")
    validation_rules = _safe_text(field.get("validation_rules"))
    if validation_rules:
        instructions.append(f"Validation rules: {validation_rules}")
    options = _safe_text(field.get("options"))
    if options:
        instructions.append(f"Allowed options: {options}")
    if section_meta:
        section_name = _safe_text(section_meta.get("section_name"))
        section_purpose = _safe_text(section_meta.get("section_purpose"))
        section_prompt = _safe_text(section_meta.get("field_prompt") or section_meta.get("default_prompt"))
        if section_name:
            instructions.append(f"Template section: {section_name}")
        if section_purpose:
            instructions.append(f"Section purpose: {section_purpose}")
        if section_prompt:
            instructions.append(f"Section prompt: {section_prompt}")

    extraction_rule = (
        "Extract the exact supported value. Return null only if the value is genuinely absent."
        if not is_synthesis else
        "Compose the value from supported facts in the database text. Return null only if there is truly no support."
    )
    formatting_rule = (
        "Return plain scalar text with no markdown."
        if field_type in EXTRACTABLE_TYPES else
        "Return plain text only. Use clean numbering only when the field naturally needs multiple points."
    )

    instruction_block = "\n".join(f"- {item}" for item in instructions) if instructions else "- Use the field label and field type carefully."
    return f"""You are filling exactly one legal template field from case documents stored in the database.

FIELD:
- key: {field_name}
- label: {field_label}
- type: {field_type}
- required: {"yes" if field.get("is_required") else "no"}

RULES:
{instruction_block}
- {extraction_rule}
- {formatting_rule}
- Prefer the targeted context first, then use the complete database text to fill missing detail.
- Do not invent unsupported parties, dates, addresses, amounts, or legal claims.

TARGETED FIELD CONTEXT:
{field_context or "(none)"}

COMPLETE DATABASE TEXT:
{full_document_text or "(none)"}

OUTPUT:
Return ONLY valid JSON in this exact shape:
{{"field_name": "{field_name}", "value": <value or null>}}
"""


def _parse_single_field_result(raw_text: str, expected_field_name: str) -> Optional[Any]:
    parsed = _parse_llm_json(raw_text)
    if not isinstance(parsed, dict):
        return None
    actual_name = parsed.get("field_name")
    if actual_name and _normalize_field_token(actual_name) != _normalize_field_token(expected_field_name):
        logger.warning(
            "[InjectionAgent][FIELD_PARSE] Expected field %s but got %s",
            expected_field_name,
            actual_name,
        )
    return parsed.get("value")


def _build_field_query(field: Dict[str, Any], section_meta: Optional[Dict[str, Any]] = None) -> str:
    parts = [
        _safe_text(field.get("field_label")),
        _safe_text(field.get("field_name")),
        _safe_text(field.get("help_text")),
        _safe_text(field.get("placeholder")),
        _safe_text((section_meta or {}).get("section_name")),
        _safe_text((section_meta or {}).get("section_purpose")),
    ]
    query = " ".join(part for part in parts if part)
    return query or _safe_text(field.get("field_name")) or "legal field details"


def _fetch_targeted_field_context(
    file_ids: Optional[List[str]],
    user_id: Any,
    field: Dict[str, Any],
    section_meta: Optional[Dict[str, Any]] = None,
    max_chars: int = FIELD_CONTEXT_MAX_CHARS,
) -> str:
    if not file_ids:
        return ""
    try:
        from services.db import find_nearest_chunks
        from services.embedding_service import generate_embeddings

        query = _build_field_query(field, section_meta)
        embeddings = generate_embeddings([query])
        if not embeddings or not embeddings[0]:
            return ""

        rows = find_nearest_chunks(
            embedding=embeddings[0],
            limit=12,
            file_ids=file_ids,
            user_id=int(user_id),
        )
        parts: List[str] = []
        total_chars = 0
        for row in rows:
            content = _safe_text(row.get("content"))
            if not content:
                continue
            heading = _safe_text(row.get("heading"))
            page = row.get("page_start")
            prefix = f"[{heading}] " if heading else (f"[Page {page}] " if page is not None else "")
            block = f"{prefix}{content}"
            if total_chars + len(block) > max_chars:
                remaining = max_chars - total_chars
                if remaining > 0:
                    parts.append(block[:remaining])
                break
            parts.append(block)
            total_chars += len(block)
        return "\n\n---\n\n".join(parts)
    except Exception as e:
        logger.warning(
            "[InjectionAgent][FIELD_CONTEXT] Targeted retrieval failed for %s: %s",
            field.get("field_name"),
            e,
        )
        return ""


def _extract_field_with_llm(
    field: Dict[str, Any],
    file_ids: Optional[List[str]],
    user_id: Any,
    full_document_text: str,
    model: str,
    system_prompt: str,
    temperature: float,
    section_meta: Optional[Dict[str, Any]] = None,
) -> tuple[str, Any]:
    from services.llm_service import call_llm

    field_name = field.get("field_name") or ""
    targeted_context = _fetch_targeted_field_context(file_ids, user_id, field, section_meta)
    prompt = _build_field_extraction_prompt(
        field=field,
        field_context=targeted_context,
        full_document_text=_truncate_text(full_document_text, FULL_TEXT_MAX_CHARS),
        section_meta=section_meta,
    )

    response = call_llm(
        prompt=prompt,
        system_prompt=system_prompt,
        model=model,
        temperature=temperature,
        response_mime_type="application/json",
    )
    return field_name, _parse_single_field_result(response or "", field_name)


def _run_parallel_field_extraction(
    fields_schema: List[Dict[str, Any]],
    file_ids: Optional[List[str]],
    user_id: Any,
    full_document_text: str,
    template_id: str,
    model: str,
    system_prompt: str,
    temperature: float,
) -> Dict[str, Any]:
    extracted: Dict[str, Any] = {}
    if not fields_schema:
        return extracted

    section_map = _resolve_section_field_mappings(template_id, fields_schema)
    max_workers = max(1, min(MAX_PARALLEL_FIELD_CALLS, len(fields_schema)))
    logger.info(
        "[InjectionAgent][PARALLEL] Running parallel extraction for %d fields with %d workers",
        len(fields_schema),
        max_workers,
    )

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_map = {
            executor.submit(
                _extract_field_with_llm,
                field,
                file_ids,
                user_id,
                full_document_text,
                model,
                system_prompt,
                temperature,
                section_map.get(field.get("field_name") or ""),
            ): field
            for field in fields_schema
            if field.get("field_name")
        }

        for future in as_completed(future_map):
            field = future_map[future]
            field_name = field.get("field_name") or ""
            try:
                _, value = future.result()
                extracted[field_name] = value
                logger.info(
                    "[InjectionAgent][PARALLEL] Completed field '%s' (%s)",
                    field_name,
                    "filled" if value not in (None, "") else "empty",
                )
            except Exception as e:
                logger.exception("[InjectionAgent][PARALLEL] Field '%s' failed: %s", field_name, e)
                extracted[field_name] = None

    return extracted


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

def run_autopopulation_agent(payload: Dict[str, Any]) -> Dict[str, Any]:
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
    # Step 5: Parallel extraction uses per-field prompts, so no single monolithic prompt here
    # ------------------------------------------------------------------
    logger.info("[InjectionAgent][PROMPT] Using section-aware per-field prompts for %d fields", len(fields_schema))

    # ------------------------------------------------------------------
    # Step 6: Resolve model — DB config → default Claude Sonnet 4.5
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
    # Step 7: Call LLMs in parallel, one field at a time
    # ------------------------------------------------------------------
    try:
        parsed_fields = _run_parallel_field_extraction(
            fields_schema=fields_schema,
            file_ids=resolved_file_ids,
            user_id=user_id,
            full_document_text=document_text,
            template_id=str(template_id),
            model=model,
            system_prompt=db_system_prompt,
            temperature=temperature,
        )

    except Exception as e:
        logger.exception("[InjectionAgent][LLM] LLM call failed")
        _safe_update_status(template_id, user_id, draft_session_id, "failed", f"LLM API error: {e}")
        return _terminated(REASON_AI_FAILURE, f"LLM call failed: {e}")

    # ------------------------------------------------------------------
    # Step 8: Fallback to legacy single-shot extraction if parallel mode returned nothing
    # ------------------------------------------------------------------
    if not any(value not in (None, "") for value in parsed_fields.values()):
        try:
            from services.llm_service import call_llm

            prompt = _build_extraction_prompt(fields_schema, document_text)
            logger.info("[InjectionAgent][LLM] Parallel mode returned no values; retrying legacy single prompt")
            llm_response = call_llm(
                prompt=prompt,
                system_prompt=db_system_prompt,
                model=model,
                temperature=temperature,
                response_mime_type="application/json",
            )
            parsed_fields = _parse_llm_json(llm_response or "")
        except Exception as e:
            logger.warning("[InjectionAgent][LLM] Legacy fallback failed: %s", e)

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


# Backwards-compatible alias so existing "InjectionAgent" wiring keeps working
run_injection_agent = run_autopopulation_agent


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


def _fetch_full_text_from_db(
    file_ids: Optional[List[str]],
    user_id: Any,
    max_chars: int = FULL_TEXT_MAX_CHARS,
) -> Optional[str]:
    """
    Prefer the complete full_text_content already stored in Document DB before rebuilding
    context from chunks. This gives the extractor the most complete JSON/text payload available.
    """
    if not file_ids:
        return None
    try:
        from services.db import get_files_full_text

        rows = get_files_full_text(file_ids, user_id)
        if not rows:
            return None

        parts: List[str] = []
        total_chars = 0
        for row in rows:
            full_text = _safe_text(row.get("full_text_content"))
            if not full_text:
                continue
            title = _safe_text(row.get("originalname")) or str(row.get("id"))
            block = f"[FILE: {title}]\n{full_text}"
            if total_chars + len(block) > max_chars:
                remaining = max_chars - total_chars
                if remaining > 0:
                    parts.append(block[:remaining])
                break
            parts.append(block)
            total_chars += len(block)

        if parts:
            combined = "\n\n---\n\n".join(parts)
            logger.info(
                "[InjectionAgent][DOC_FETCH] Loaded full_text_content from DB for %d files (%d chars)",
                len(parts),
                len(combined),
            )
            return combined
    except Exception as e:
        logger.warning("[InjectionAgent][DOC_FETCH] Could not fetch full_text_content from DB: %s", e)
    return None


def _count_total_chunks(file_ids: List[str]) -> int:
    """Count total chunks across all given file IDs (used to decide full-doc vs RAG strategy)."""
    try:
        from services.db import get_conn
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT COUNT(*) FROM file_chunks WHERE file_id = ANY(%s::uuid[])",
                    (file_ids,),
                )
                row = cur.fetchone()
                return int(row[0]) if row else 0
    except Exception as e:
        logger.warning("[InjectionAgent][CHUNK_COUNT] Could not count chunks: %s", e)
        return 9999  # Unknown → assume large, use RAG


def _resolve_document_text(
    raw_text: Optional[str],
    file_ids: Optional[List[str]],
    user_id: Any,
    fields_schema: Optional[List[Dict[str, Any]]] = None,
) -> Optional[str]:
    """
    Resolve document context with smart strategy:

    Priority:
      1. raw_text provided directly → use as-is (truncated to 60k chars)
      2. file_ids with SMALL total chunk count (≤ FULL_DOC_CHUNK_THRESHOLD):
         → Fetch ALL chunks in page order (complete document coverage)
         This is critical for complete agreements/contracts where every section has fields
      3. file_ids with LARGE total chunk count:
         → Multi-query RAG retrieval (top-50 semantically relevant chunks)
      4. Fallback → ordered chunk text
    """
    if raw_text and raw_text.strip():
        text = raw_text.strip()
        if len(text) > 60000:
            text = text[:60000]
            logger.info("[InjectionAgent][DOC_FETCH] raw_text truncated to 60000 chars")
        else:
            logger.info("[InjectionAgent][DOC_FETCH] Using provided raw_text (%d chars)", len(text))
        return text

    if not file_ids:
        logger.warning("[InjectionAgent][DOC_FETCH] No raw_text and no file_ids provided")
        return None

    db_text = _fetch_full_text_from_db(file_ids, user_id, max_chars=FULL_TEXT_MAX_CHARS)
    if db_text and db_text.strip():
        return db_text

    # Check total chunk count to decide strategy
    total_chunks = _count_total_chunks(file_ids)
    logger.info(
        "[InjectionAgent][DOC_FETCH] Total chunks across %d files: %d (threshold=%d)",
        len(file_ids), total_chunks, FULL_DOC_CHUNK_THRESHOLD,
    )

    if total_chunks <= FULL_DOC_CHUNK_THRESHOLD:
        # Small document(s) — fetch ALL chunks for complete coverage
        # This ensures a complete Leave and Licence Agreement / Sale Deed gets ALL its fields extracted
        logger.info(
            "[InjectionAgent][DOC_FETCH] Small document(s) — fetching ALL %d chunks in page order",
            total_chunks,
        )
        full_text = _fetch_ordered_text(file_ids, user_id, max_chars=80000)
        if full_text and full_text.strip():
            return full_text

    # Large document(s) or fallback — use RAG for targeted retrieval
    logger.info(
        "[InjectionAgent][DOC_FETCH] Using RAG retrieval for %d files (%d chunks)",
        len(file_ids), total_chunks,
    )
    return _fetch_context_via_rag(
        fields_schema=fields_schema or [],
        file_ids=file_ids,
        user_id=user_id,
    )


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
