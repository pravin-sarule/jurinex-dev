"""
AutopopulationAgent v4: 5-stage pipeline targeting near-100% field coverage.

Pipeline:
  Stage 1 — Document → CanonicalData (LLM structured extraction)
  Stage 2 — Schema  → FieldGroups (9 semantic groups, ≤10 fields per chunk)
  Stage 3 — Parallel per-chunk LLM generation (strict ALL-fields prompt)
  Stage 4 — Missing-field retry (dedicated retry prompt for any null/missing keys)
  Stage 5 — Final fallback defaults + user-edit merge + DB upsert
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_MODEL = "claude-sonnet-4-5"

EXTRACTABLE_TYPES = {
    "text", "string", "date", "number", "integer", "float",
    "select", "email", "phone", "url", "address", "currency",
    "short_text", "single_line",
}

SYNTHESIS_TYPES = {
    "textarea", "long_text", "text_long", "paragraph", "rich_text",
    "multiline", "text_area", "multi_line",
}

FULL_DOC_CHUNK_THRESHOLD = 80
FULL_TEXT_MAX_CHARS = 120000
CANONICAL_DOC_MAX_CHARS = 40000
GROUP_DOC_MAX_CHARS = 28000
MAX_PARALLEL_CHUNKS = 6
MAX_FIELDS_PER_CHUNK = 10       # hard cap — never send more than this per LLM call

REASON_SCHEMA_MISSING = "schema_missing"
REASON_DOCUMENT_EMPTY = "document_empty"
REASON_AI_FAILURE = "ai_failure"
REASON_JSON_PARSE_ERROR = "json_parse_error"
REASON_DB_FAILURE = "db_failure"


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------

def _terminated(reason: str, error_msg: Optional[str] = None) -> Dict[str, Any]:
    return {
        "status": "terminated",
        "reason": reason,
        "extracted_fields": {},
        "skipped_fields": [],
        "errors": error_msg,
    }


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


def _parse_llm_json(raw_text: str) -> Optional[Dict[str, Any]]:
    if not raw_text:
        return None
    cleaned = raw_text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    cleaned = cleaned.strip()
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, list):
            return parsed[0] if parsed and isinstance(parsed[0], dict) else None
        if isinstance(parsed, dict):
            return parsed
        return None
    except json.JSONDecodeError:
        return None


def _safe_update_status(
    template_id: str,
    user_id: Any,
    draft_session_id: Optional[str],
    status: str,
    error_msg: str,
) -> None:
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
        logger.warning("[AutopopulationAgent][STATUS_UPDATE] Could not update status: %s", e)


# ---------------------------------------------------------------------------
# Default value fallbacks (Stage 5)
# ---------------------------------------------------------------------------

def _get_default_value(field: Dict[str, Any]) -> Any:
    """Return a sensible non-null placeholder for a field that couldn't be filled."""
    ftype = (field.get("field_type") or "text").lower().strip()
    fname = (field.get("field_name") or "").lower()
    flabel = (field.get("field_label") or "").lower()
    combined = fname + " " + flabel

    if ftype in ("number", "integer", "float"):
        return 0
    if ftype == "date":
        import datetime
        return datetime.date.today().strftime("%d/%m/%Y")
    if ftype in SYNTHESIS_TYPES or any(
        kw in combined for kw in ("facts", "grounds", "prayer", "detail", "description", "narrative")
    ):
        return "Not available at present."
    return "Not Available"


# ---------------------------------------------------------------------------
# Document fetching helpers
# ---------------------------------------------------------------------------

def _fetch_ordered_text(
    file_ids: Optional[List[str]],
    user_id: Any,
    max_chars: int = 60000,
    limit_per_file: int = 80,
) -> Optional[str]:
    """Fetch top `limit_per_file` chunks per file ordered by chunk_index (positional order)."""
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
                        LIMIT %s
                        """,
                        (str(fid), limit_per_file),
                    )
                    rows = cur.fetchall()
            if rows:
                all_parts.append("\n".join(r[0] for r in rows if r[0]))
        if all_parts:
            text = "\n\n---\n\n".join(all_parts)
            return text[:max_chars] if len(text) > max_chars else text
    except Exception:
        logger.exception("[AutopopulationAgent][FALLBACK] DB lookup failed for file_ids=%s", file_ids)
    return None


def _fetch_full_text_from_db(
    file_ids: Optional[List[str]],
    user_id: Any,
    max_chars: int = FULL_TEXT_MAX_CHARS,
) -> Optional[str]:
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
        return "\n\n---\n\n".join(parts) if parts else None
    except Exception as e:
        logger.warning("[AutopopulationAgent][DOC_FETCH] Could not fetch full_text_content: %s", e)
    return None


def _count_total_chunks(file_ids: List[str]) -> int:
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
        logger.warning("[AutopopulationAgent][CHUNK_COUNT] Could not count chunks: %s", e)
        return 9999


def _fetch_context_via_rag(
    fields_schema: List[Dict[str, Any]],
    file_ids: Optional[List[str]],
    user_id: Any,
    top_k_per_query: int = 80,
) -> Optional[str]:
    try:
        from services.db import find_nearest_chunks
        from services.embedding_service import generate_embeddings

        labels = [
            (f.get("field_label") or f.get("field_name") or "").strip()
            for f in fields_schema if f.get("field_label") or f.get("field_name")
        ]
        label_text = ", ".join(labels[:40]) if labels else ""
        queries = [
            f"parties names addresses dates amounts payment agreement contract details case facts {label_text}",
            "petitioner respondent applicant plaintiff defendant claimant name address contact occupation",
            "facts of case background dispute grievance cause of action legal grounds prayer relief sought",
            "date of agreement execution payment amount fee consideration stamp duty registration court case number",
            "property address description plot survey number district taluka state jurisdiction court",
        ]

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
                            "content": content, "score": similarity, "hits": 1,
                            "page": row.get("page_start"), "heading": row.get("heading") or "",
                        }
            except Exception as e:
                logger.warning("[AutopopulationAgent][RAG] Query failed: %s", e)

        if not chunk_map:
            return _fetch_ordered_text(file_ids, user_id)

        ranked = sorted(chunk_map.values(), key=lambda c: (c["hits"], c["score"]), reverse=True)
        parts = []
        for c in ranked[:80]:
            header = f"[{c['heading']}] " if c.get("heading") else (
                f"[Page {c['page']}] " if c.get("page") is not None else ""
            )
            parts.append(f"{header}{c['content'].strip()}")
        return "\n\n---\n\n".join(parts)
    except Exception:
        logger.exception("[AutopopulationAgent][RAG] RAG failed; falling back to ordered text")
        return _fetch_ordered_text(file_ids, user_id)


def _resolve_document_text(
    raw_text: Optional[str],
    file_ids: Optional[List[str]],
    user_id: Any,
    fields_schema: Optional[List[Dict[str, Any]]] = None,
) -> Optional[str]:
    """
    Resolve document text for field extraction.

    Strategy (same for both case documents and uploaded files):
      1. If raw_text supplied directly → use it (e.g. extract-fields API).
      2. Primary  — RAG top-80: fetch the 80 most relevant chunks per query
                    across ALL file_ids (works for multi-doc cases and single uploads).
      3. Fallback — Ordered top-80 per file: if RAG returns nothing (embedding
                    service unavailable), fall back to the first 80 chunks from
                    each file in chunk_index order.
      4. Last resort — full_text_content column on the files table.
    """
    if raw_text and raw_text.strip():
        text = raw_text.strip()
        return text[:60000] if len(text) > 60000 else text

    if not file_ids:
        return None

    # ── PRIMARY: RAG top-80 across all files (case OR upload) ────────────────
    rag_text = _fetch_context_via_rag(
        fields_schema=fields_schema or [],
        file_ids=file_ids,
        user_id=user_id,
        top_k_per_query=80,
    )
    if rag_text and rag_text.strip():
        logger.info(
            "[AutopopulationAgent][DOC_RESOLVE] RAG top-80 chunks fetched "
            "for %d file(s) (%d chars)", len(file_ids), len(rag_text),
        )
        return rag_text

    # ── FALLBACK: ordered top-80 per file ────────────────────────────────────
    ordered_text = _fetch_ordered_text(
        file_ids=file_ids,
        user_id=user_id,
        max_chars=80000,
        limit_per_file=80,
    )
    if ordered_text and ordered_text.strip():
        logger.info(
            "[AutopopulationAgent][DOC_RESOLVE] Ordered top-80 chunks per file "
            "for %d file(s) (%d chars)", len(file_ids), len(ordered_text),
        )
        return ordered_text

    # ── LAST RESORT: full_text_content from files table ───────────────────────
    db_text = _fetch_full_text_from_db(file_ids, user_id, max_chars=FULL_TEXT_MAX_CHARS)
    if db_text and db_text.strip():
        logger.info(
            "[AutopopulationAgent][DOC_RESOLVE] full_text_content fallback "
            "for %d file(s) (%d chars)", len(file_ids), len(db_text),
        )
        return db_text

    return None


# ---------------------------------------------------------------------------
# Stage 1 — Canonical Data Extraction
# ---------------------------------------------------------------------------

_CANONICAL_PROMPT_TEMPLATE = """\
You are a legal document analyst. Extract structured canonical data from the document below.

Return ONLY a valid JSON object with exactly these keys:
{{
  "persons": [
    {{
      "role": "petitioner|respondent|witness|other",
      "name": "Full Name",
      "address": "Full Address",
      "occupation": "Occupation or null",
      "contact": "Phone/Email or null",
      "age": "Age or null",
      "designation": "Designation/title or null"
    }}
  ],
  "property": {{
    "description": "Full property description or null",
    "address": "Property address or null",
    "survey_number": "Survey/plot number or null",
    "district": "District or null",
    "taluka": "Taluka or null",
    "state": "State or null",
    "area": "Area in sqft/sqmt/acres or null"
  }},
  "transaction": {{
    "date": "Transaction date or null",
    "amount": "Amount/consideration or null",
    "currency": "Currency or null",
    "agreement_type": "Type of agreement or null",
    "registration_number": "Registration/case number or null",
    "execution_date": "Date of execution or null"
  }},
  "utility": {{
    "court_name": "Court name or null",
    "jurisdiction": "Jurisdiction details or null",
    "case_number": "Case number or null",
    "filing_date": "Filing date or null",
    "cause_of_action": "Brief cause of action or null",
    "relief_sought": "Primary relief sought or null",
    "act_violated": "Primary act/statute violated or null",
    "section_violated": "Section number or null"
  }},
  "respondents": [
    "Respondent 1 name/designation",
    "Respondent 2 name/designation"
  ]
}}

DOCUMENT:
{document_text}
"""


def _extract_canonical_data(
    document_text: str,
    model: str,
    temperature: float,
) -> Dict[str, Any]:
    """Stage 1: Extract CanonicalData (persons, property, transaction, utility, respondents)."""
    from services.llm_service import call_llm

    default: Dict[str, Any] = {
        "persons": [], "property": {}, "transaction": {}, "utility": {}, "respondents": []
    }
    try:
        raw = call_llm(
            prompt=_CANONICAL_PROMPT_TEMPLATE.format(
                document_text=_truncate_text(document_text, CANONICAL_DOC_MAX_CHARS)
            ),
            system_prompt=(
                "You are a legal document analyst. Extract structured data only. "
                "Return valid JSON with no markdown, no commentary."
            ),
            model=model,
            temperature=temperature,
            response_mime_type="application/json",
        )
        parsed = _parse_llm_json(raw or "")
        if not isinstance(parsed, dict):
            logger.warning("[AutopopulationAgent][STAGE1] Canonical parse failed — using empty defaults")
            return default
        for key in ("persons", "property", "transaction", "utility", "respondents"):
            if key not in parsed:
                parsed[key] = [] if key in ("persons", "respondents") else {}

        # Auto-generate 4 standard respondents if none were found
        respondents = parsed.get("respondents") or []
        if not respondents:
            parsed["respondents"] = [
                "State Government",
                "District Collector / Local Authority",
                "Registration / Revenue Office",
                "Union of India (Central Government)",
            ]
            logger.info("[AutopopulationAgent][STAGE1] No respondents found — injected 4 default authorities")

        logger.info(
            "[AutopopulationAgent][STAGE1] Canonical: %d persons, %d respondents, "
            "property=%s, transaction=%s, utility=%s",
            len(parsed.get("persons") or []),
            len(parsed.get("respondents") or []),
            bool(parsed.get("property")),
            bool(parsed.get("transaction")),
            bool(parsed.get("utility")),
        )
        return parsed
    except Exception as e:
        logger.warning("[AutopopulationAgent][STAGE1] Canonical extraction failed (non-fatal): %s", e)
        return default


# ---------------------------------------------------------------------------
# Stage 2 — Field Grouping (9 semantic groups, ≤ MAX_FIELDS_PER_CHUNK each)
# ---------------------------------------------------------------------------

def _group_fields(
    fields_schema: List[Dict[str, Any]],
) -> List[Tuple[str, List[Dict[str, Any]]]]:
    """
    Stage 2: Partition fields into 9 semantic groups, then split any group
    larger than MAX_FIELDS_PER_CHUNK into equal sub-chunks.

    Returns a flat list of (chunk_label, fields) tuples — each tuple is one
    LLM call in Stage 3.
    """
    buckets: Dict[str, List[Dict[str, Any]]] = {
        "identity":     [],
        "respondents":  [],
        "facts":        [],
        "grounds":      [],
        "jurisdiction": [],
        "dates":        [],
        "annexures":    [],
        "verification": [],
        "others":       [],
    }

    for field in fields_schema:
        fname = (field.get("field_name") or "").lower()
        flabel = (field.get("field_label") or "").lower()
        ftype  = (field.get("field_type") or "text").lower()
        combined = fname + " " + flabel

        if any(kw in combined for kw in ("respondent", "defendant", "opposite", "authority")):
            buckets["respondents"].append(field)
        elif any(kw in combined for kw in ("fact", "background", "narrative", "dispute", "complaint", "cause_of_action", "allegation")):
            buckets["facts"].append(field)
        elif any(kw in combined for kw in ("ground", "reason", "basis", "prayer", "relief", "argument", "submission")):
            buckets["grounds"].append(field)
        elif any(kw in combined for kw in ("jurisdiction", "court", "tribunal", "bench", "forum", "alternative_remedy", "remedy")):
            buckets["jurisdiction"].append(field)
        elif any(kw in combined for kw in ("date", "year", "month", "period", "duration", "day")):
            buckets["dates"].append(field)
        elif any(kw in combined for kw in ("annexure", "exhibit", "schedule", "appendix", "attachment")):
            buckets["annexures"].append(field)
        elif any(kw in combined for kw in ("verification", "affidavit", "deponent", "oath", "sworn", "notary")):
            buckets["verification"].append(field)
        elif any(kw in combined for kw in (
            "name", "address", "age", "occupation", "father", "husband", "son",
            "daughter", "spouse", "guardian", "petitioner", "applicant",
            "plaintiff", "claimant", "appellant", "party", "client",
        )):
            buckets["identity"].append(field)
        else:
            buckets["others"].append(field)

    # Split oversized groups into ≤ MAX_FIELDS_PER_CHUNK chunks
    chunks: List[Tuple[str, List[Dict[str, Any]]]] = []
    for group_name, group_fields in buckets.items():
        if not group_fields:
            continue
        if len(group_fields) <= MAX_FIELDS_PER_CHUNK:
            chunks.append((group_name, group_fields))
        else:
            for i in range(0, len(group_fields), MAX_FIELDS_PER_CHUNK):
                sub = group_fields[i: i + MAX_FIELDS_PER_CHUNK]
                label = f"{group_name}_{i // MAX_FIELDS_PER_CHUNK + 1}"
                chunks.append((label, sub))

    total_fields = sum(len(c[1]) for c in chunks)
    logger.info(
        "[AutopopulationAgent][STAGE2] %d chunks created from %d fields: %s",
        len(chunks), total_fields,
        {label: len(fields) for label, fields in chunks},
    )
    return chunks


# ---------------------------------------------------------------------------
# Stage 3 — Per-chunk LLM generation (strict ALL-fields prompt)
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT_STRICT = """\
You MUST return ALL fields listed.

STRICT RULES:
- Output MUST include EVERY key provided in the FIELDS list
- DO NOT omit any field
- DO NOT return partial JSON
- If value is unknown → generate the best possible inferred value from the data
- NEVER return null or empty string for any field
- For legal narrative fields: write complete, court-ready text
- For respondent fields: use the respondent authorities listed in the canonical data

FAILURE CONDITION: If ANY key is missing from your output → the response is INVALID."""

_RETRY_SYSTEM_PROMPT = """\
You previously failed to fill some fields. Fill ALL of the missing fields below.

RULES:
- No field can be empty or null
- Generate the best possible value from the canonical data provided
- Maintain legal correctness and formal tone
- For text/narrative fields: write complete sentences
- For name/address fields: use the party information in the canonical data

FAILURE CONDITION: Every field in MISSING FIELDS must appear in your output."""


def _build_canonical_summary(canonical_data: Dict[str, Any]) -> str:
    """Build a compact text summary of canonical data for inclusion in prompts."""
    lines: List[str] = []
    persons = canonical_data.get("persons") or []
    for p in persons:
        role = (p.get("role") or "party").upper()
        name = p.get("name") or "N/A"
        addr = p.get("address") or ""
        occ  = p.get("occupation") or ""
        age  = p.get("age") or ""
        desig= p.get("designation") or ""
        line = f"{role}: {name}"
        if age:   line += f", Age: {age}"
        if occ:   line += f", Occupation: {occ}"
        if desig: line += f", Designation: {desig}"
        if addr:  line += f"\n  Address: {addr}"
        lines.append(line)

    respondents = canonical_data.get("respondents") or []
    if respondents:
        lines.append("RESPONDENT AUTHORITIES:")
        for i, r in enumerate(respondents, 1):
            lines.append(f"  {i}. {r}")

    prop = canonical_data.get("property") or {}
    if any(prop.values()):
        lines.append(
            f"PROPERTY: {prop.get('description') or ''} | "
            f"Survey: {prop.get('survey_number') or ''} | "
            f"District: {prop.get('district') or ''}, {prop.get('state') or ''}"
        )

    trans = canonical_data.get("transaction") or {}
    if any(trans.values()):
        lines.append(
            f"TRANSACTION: Date={trans.get('date') or ''}, "
            f"Amount={trans.get('amount') or ''}, "
            f"Type={trans.get('agreement_type') or ''}, "
            f"Reg#={trans.get('registration_number') or ''}"
        )

    util = canonical_data.get("utility") or {}
    if any(util.values()):
        lines.append(
            f"COURT: {util.get('court_name') or ''} | "
            f"Jurisdiction: {util.get('jurisdiction') or ''} | "
            f"Case#: {util.get('case_number') or ''}"
        )
        lines.append(
            f"Cause of Action: {util.get('cause_of_action') or ''} | "
            f"Act: {util.get('act_violated') or ''} s.{util.get('section_violated') or ''}"
        )

    return "\n".join(lines) if lines else "(no canonical data extracted)"


def _build_chunk_prompt(
    chunk_label: str,
    fields: List[Dict[str, Any]],
    canonical_data: Dict[str, Any],
    document_text: str,
    is_retry: bool = False,
) -> str:
    """Build the strict extraction prompt for a single chunk."""
    canonical_summary = _build_canonical_summary(canonical_data)
    field_keys = [f.get("field_name", "") for f in fields]

    # Detailed field spec
    field_lines: List[str] = []
    for f in fields:
        name   = f.get("field_name", "")
        label  = f.get("field_label", name)
        ftype  = f.get("field_type", "text")
        req    = " [REQUIRED]" if f.get("is_required") else ""
        hint   = f.get("help_text") or f.get("placeholder") or ""
        opts   = f.get("options") or ""
        extras = []
        if hint: extras.append(f"hint: {hint}")
        if opts: extras.append(f"options: {opts}")
        extra_str = f" ({', '.join(extras)})" if extras else ""
        field_lines.append(f"  {name} ({ftype}): {label}{req}{extra_str}")

    prefix = "MISSING FIELDS TO FILL:" if is_retry else f"FIELDS (group: {chunk_label}):"
    return f"""{prefix}
{chr(10).join(field_lines)}

CANONICAL DATA:
{canonical_summary}

DOCUMENT TEXT:
{_truncate_text(document_text, GROUP_DOC_MAX_CHARS)}

==============================
OUTPUT FORMAT:
Return JSON with EXACTLY these keys — no more, no less:
{json.dumps(field_keys)}

Every key MUST be present. Every value MUST be non-null and non-empty.
Return ONLY valid JSON. No markdown fences. No explanation.
"""


def _call_chunk_llm(
    chunk_label: str,
    fields: List[Dict[str, Any]],
    canonical_data: Dict[str, Any],
    document_text: str,
    model: str,
    temperature: float,
    is_retry: bool = False,
) -> Dict[str, Any]:
    """Make a single LLM call for a chunk and return field_name → value dict."""
    from services.llm_service import call_llm

    system = _RETRY_SYSTEM_PROMPT if is_retry else _SYSTEM_PROMPT_STRICT
    prompt = _build_chunk_prompt(chunk_label, fields, canonical_data, document_text, is_retry)

    try:
        raw = call_llm(
            prompt=prompt,
            system_prompt=system,
            model=model,
            temperature=temperature,
            response_mime_type="application/json",
        )
        result = _parse_llm_json(raw or "") or {}
        filled = sum(1 for v in result.values() if v not in (None, ""))
        tag = "[RETRY]" if is_retry else ""
        logger.info(
            "[AutopopulationAgent][STAGE3%s] Chunk '%s': %d/%d fields filled",
            tag, chunk_label, filled, len(fields),
        )
        return result
    except Exception as e:
        tag = "RETRY" if is_retry else "STAGE3"
        logger.warning("[AutopopulationAgent][%s] Chunk '%s' failed: %s", tag, chunk_label, e)
        return {}


# ---------------------------------------------------------------------------
# Stage 4 — Missing-field retry
# ---------------------------------------------------------------------------

def _retry_missing_fields(
    all_fields_schema: List[Dict[str, Any]],
    current_results: Dict[str, Any],
    canonical_data: Dict[str, Any],
    document_text: str,
    model: str,
    temperature: float,
) -> Dict[str, Any]:
    """
    Stage 4: Collect any fields still null/missing after Stage 3 and send
    them in a single dedicated retry call (also chunked at MAX_FIELDS_PER_CHUNK).
    """
    missing = [
        f for f in all_fields_schema
        if f.get("field_name")
        and current_results.get(f["field_name"]) in (None, "")
    ]

    if not missing:
        logger.info("[AutopopulationAgent][STAGE4] No missing fields — retry skipped")
        return current_results

    missing_keys = [f.get("field_name") for f in missing]
    logger.info("[AutopopulationAgent][MISSING_FIELDS] %s", missing_keys)
    logger.info(
        "[AutopopulationAgent][STAGE4] Retrying %d missing fields in chunk(s) of %d",
        len(missing), MAX_FIELDS_PER_CHUNK,
    )

    retry_chunks = [
        missing[i: i + MAX_FIELDS_PER_CHUNK]
        for i in range(0, len(missing), MAX_FIELDS_PER_CHUNK)
    ]

    retry_results: Dict[str, Any] = {}
    workers = min(MAX_PARALLEL_CHUNKS, len(retry_chunks))
    with ThreadPoolExecutor(max_workers=workers) as executor:
        future_map = {
            executor.submit(
                _call_chunk_llm,
                f"retry_{idx + 1}",
                chunk,
                canonical_data,
                document_text,
                model,
                temperature,
                True,   # is_retry=True
            ): chunk
            for idx, chunk in enumerate(retry_chunks)
        }
        for future in as_completed(future_map):
            try:
                retry_results.update(future.result())
            except Exception as e:
                logger.warning("[AutopopulationAgent][STAGE4] Retry chunk future failed: %s", e)

    # Merge retry results into current (only fill genuinely missing slots)
    filled_by_retry = 0
    for field_name, value in retry_results.items():
        if value not in (None, "") and current_results.get(field_name) in (None, ""):
            current_results[field_name] = value
            filled_by_retry += 1

    logger.info(
        "[AutopopulationAgent][STAGE4] Retry filled %d additional fields",
        filled_by_retry,
    )
    return current_results


# ---------------------------------------------------------------------------
# Stage 5 helpers — final fallback defaults
# ---------------------------------------------------------------------------

def _apply_final_fallbacks(
    merged: Dict[str, Any],
    fields_schema: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Stage 5: For any field still null/missing, inject a typed placeholder."""
    fallback_count = 0
    for field in fields_schema:
        fname = field.get("field_name") or ""
        if not fname:
            continue
        if merged.get(fname) not in (None, ""):
            continue
        merged[fname] = _get_default_value(field)
        fallback_count += 1

    if fallback_count:
        logger.info(
            "[AutopopulationAgent][STAGE5] Final fallback applied to %d fields",
            fallback_count,
        )
    return merged


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def run_autopopulation_agent(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Run the 5-stage AutopopulationAgent pipeline targeting near-100% field coverage.

    Stage 1 — Document → CanonicalData
    Stage 2 — Schema  → Field chunks (9 groups, ≤10 fields each)
    Stage 3 — Parallel per-chunk LLM generation (strict ALL-fields prompt)
    Stage 4 — Missing-field retry (dedicated retry call)
    Stage 5 — Final fallback defaults + user-edit merge + DB upsert
    """
    logger.info(
        "[AutopopulationAgent][INIT] payload keys: %s", list(payload.keys())
    )

    template_id        = payload.get("template_id")
    user_id            = payload.get("user_id")
    draft_session_id   = payload.get("draft_session_id")
    source_document_id = payload.get("source_document_id")
    case_id            = payload.get("case_id")
    file_ids_from_payload = payload.get("file_ids") or []
    raw_text           = payload.get("raw_text")

    if not template_id:
        return _terminated("validation_error", "template_id is required")
    if not user_id:
        return _terminated("validation_error", "user_id is required")

    # ── Fetch template schema ─────────────────────────────────────────────────
    try:
        from services.draft_db import get_template_fields_with_fallback
        fields_schema = get_template_fields_with_fallback(str(template_id))
        logger.info(
            "[AutopopulationAgent][SCHEMA] %d fields for template_id=%s",
            len(fields_schema), template_id,
        )
    except Exception as e:
        logger.exception("[AutopopulationAgent][SCHEMA] Failed to fetch template fields")
        _safe_update_status(template_id, user_id, draft_session_id, "failed", str(e))
        return _terminated(REASON_SCHEMA_MISSING, f"Failed to fetch template fields: {e}")

    if not fields_schema:
        _safe_update_status(template_id, user_id, draft_session_id, "failed", "No template fields defined")
        return _terminated(REASON_SCHEMA_MISSING, "No template fields defined for this template")

    allowed_fields = {f.get("field_name") for f in fields_schema if f.get("field_name")}

    # ── Resolve file IDs ──────────────────────────────────────────────────────
    resolved_file_ids: List[str] = list(file_ids_from_payload)

    if case_id and not resolved_file_ids:
        try:
            from services.db import get_file_ids_for_case
            case_file_ids = get_file_ids_for_case(str(case_id), int(user_id))
            if case_file_ids:
                resolved_file_ids = case_file_ids
        except Exception as e:
            logger.warning("[AutopopulationAgent][FILE_RESOLVE] Could not fetch case files: %s", e)

    if not resolved_file_ids and source_document_id:
        resolved_file_ids = [str(source_document_id)]

    # ── Resolve document text ─────────────────────────────────────────────────
    document_text = _resolve_document_text(
        raw_text=raw_text,
        file_ids=resolved_file_ids,
        user_id=user_id,
        fields_schema=fields_schema,
    )

    if not document_text or not document_text.strip():
        _safe_update_status(template_id, user_id, draft_session_id, "failed", "Document text is empty")
        return _terminated(REASON_DOCUMENT_EMPTY, "No document text available for extraction")

    # ── Agent config ──────────────────────────────────────────────────────────
    model       = DEFAULT_MODEL
    temperature = 0.3
    try:
        from services.agent_config_service import get_agent_by_type
        agent = (
            get_agent_by_type("injection")
            or get_agent_by_type("extraction")
            or get_agent_by_type("autopopulation")
        )
        if agent:
            model       = agent.get("resolved_model") or DEFAULT_MODEL
            temperature = float(agent.get("temperature") or 0.3)
    except Exception as e:
        logger.warning("[AutopopulationAgent][CONFIG] Could not fetch agent config: %s — using default", e)

    # ══════════════════════════════════════════════════════════════════════════
    # STAGE 1: Extract CanonicalData
    # ══════════════════════════════════════════════════════════════════════════
    logger.info("[AutopopulationAgent] ══ Stage 1: Canonical Data Extraction ══")
    canonical_data = _extract_canonical_data(document_text, model, temperature)

    # ══════════════════════════════════════════════════════════════════════════
    # STAGE 2: Group and chunk fields
    # ══════════════════════════════════════════════════════════════════════════
    logger.info("[AutopopulationAgent] ══ Stage 2: Field Grouping ══")
    field_chunks = _group_fields(fields_schema)

    # ══════════════════════════════════════════════════════════════════════════
    # STAGE 3: Parallel per-chunk generation
    # ══════════════════════════════════════════════════════════════════════════
    logger.info(
        "[AutopopulationAgent] ══ Stage 3: Parallel Generation (%d chunks) ══",
        len(field_chunks),
    )
    all_results: Dict[str, Any] = {}

    with ThreadPoolExecutor(max_workers=min(MAX_PARALLEL_CHUNKS, len(field_chunks))) as executor:
        future_map = {
            executor.submit(
                _call_chunk_llm,
                chunk_label,
                chunk_fields,
                canonical_data,
                document_text,
                model,
                temperature,
                False,
            ): chunk_label
            for chunk_label, chunk_fields in field_chunks
        }
        for future in as_completed(future_map):
            chunk_label = future_map[future]
            try:
                all_results.update(future.result())
            except Exception as e:
                logger.warning(
                    "[AutopopulationAgent][STAGE3] Chunk '%s' future failed: %s", chunk_label, e
                )

    stage3_filled = sum(1 for v in all_results.values() if v not in (None, ""))
    logger.info(
        "[AutopopulationAgent][STAGE3] After parallel generation: %d/%d fields filled",
        stage3_filled, len(fields_schema),
    )

    # ══════════════════════════════════════════════════════════════════════════
    # STAGE 4: Missing-field retry
    # ══════════════════════════════════════════════════════════════════════════
    logger.info("[AutopopulationAgent] ══ Stage 4: Missing-Field Retry ══")
    all_results = _retry_missing_fields(
        all_fields_schema=fields_schema,
        current_results=all_results,
        canonical_data=canonical_data,
        document_text=document_text,
        model=model,
        temperature=temperature,
    )

    stage4_filled = sum(1 for v in all_results.values() if v not in (None, ""))
    logger.info(
        "[AutopopulationAgent][STAGE4] After retry: %d/%d fields filled",
        stage4_filled, len(fields_schema),
    )

    # ══════════════════════════════════════════════════════════════════════════
    # STAGE 5: Validate, final fallbacks, user-edit merge, upsert
    # ══════════════════════════════════════════════════════════════════════════
    logger.info("[AutopopulationAgent] ══ Stage 5: Fallback & Upsert ══")

    # Apply final typed fallbacks for anything still empty
    all_results = _apply_final_fallbacks(all_results, fields_schema)

    # Validate: keep only allowed fields
    validated_fields: Dict[str, Any] = {}
    skipped_fields:   List[str] = []
    discarded_keys:   List[str] = []

    for key, value in all_results.items():
        if key not in allowed_fields:
            discarded_keys.append(key)
            continue
        if value is None or (isinstance(value, str) and not value.strip()):
            continue
        validated_fields[key] = value

    if discarded_keys:
        logger.debug("[AutopopulationAgent][STAGE5] Discarded %d out-of-schema keys", len(discarded_keys))

    # Merge with existing user-edited values (user edits always win)
    try:
        from services.draft_db import get_existing_user_field_values
        existing = get_existing_user_field_values(
            template_id=str(template_id),
            user_id=int(user_id),
            draft_session_id=str(draft_session_id) if draft_session_id else None,
        )
    except Exception as e:
        logger.warning("[AutopopulationAgent][MERGE] Could not fetch existing values: %s", e)
        existing = None

    final_fields: Dict[str, Any] = {}
    if existing and existing.get("user_edited_fields"):
        user_edited    = set(existing["user_edited_fields"])
        existing_values = existing.get("field_values") or {}
        for field_name, extracted_value in validated_fields.items():
            if field_name in user_edited:
                skipped_fields.append(field_name)
                final_fields[field_name] = existing_values.get(field_name)
            else:
                final_fields[field_name] = extracted_value
        for uf in user_edited:
            if uf not in final_fields and uf in existing_values:
                final_fields[uf] = existing_values[uf]
    else:
        final_fields = validated_fields

    total_fields  = len(fields_schema)
    filled_count  = sum(1 for v in final_fields.values() if v not in (None, ""))
    fill_ratio    = filled_count / total_fields if total_fields > 0 else 0

    logger.info(
        "[AutopopulationAgent][STAGE5] FINAL: %d/%d fields filled (%.0f%%)",
        filled_count, total_fields, fill_ratio * 100,
    )

    status = "completed" if fill_ratio >= 0.7 else "partial"
    if not validated_fields:
        status = "partial"

    # Upsert to DB
    try:
        from services.draft_db import upsert_extracted_field_values
        upsert_extracted_field_values(
            template_id=str(template_id),
            user_id=int(user_id),
            draft_session_id=str(draft_session_id) if draft_session_id else None,
            source_document_id=str(source_document_id) if source_document_id else None,
            field_values=final_fields,
            filled_by="agent",
            extraction_status=status,
        )
    except Exception as e:
        logger.exception("[AutopopulationAgent][DB_UPSERT] Database upsert failed")
        return {
            "status": "terminated",
            "reason": REASON_DB_FAILURE,
            "extracted_fields": validated_fields,
            "skipped_fields": skipped_fields,
            "errors": f"Database upsert failed: {e}",
        }

    return {
        "status": status,
        "reason": None,
        "extracted_fields": validated_fields,
        "skipped_fields": skipped_fields,
        "errors": None,
    }
