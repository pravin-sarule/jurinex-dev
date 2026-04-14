"""
Clerk agent: OCR / extract text, chunk, embed, and store in DB.
Uses Gemini to extract ALL structured fields from raw judgment text:
  - caseName, primaryCitation, alternateCitations, court, coram,
    benchType, dateOfJudgment, statutes, ratio, excerptPara, excerptText.
Stores chunks in judgement_chunks for semantic search.
"""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional
from google import genai

logger = logging.getLogger(__name__)

CHUNK_SIZE    = 1200
CHUNK_OVERLAP = 200
CLERK_DOC_WORKERS = max(1, min(12, int(os.environ.get("CITATION_CLERK_DOC_WORKERS", "6"))))
MAX_CHUNKS_PER_DOC = max(10, int(os.environ.get("CITATION_MAX_CHUNKS_PER_DOC", "80")))
_EXPECTED_CLERK_KEYS = {
    "caseName",
    "primaryCitation",
    "alternateCitations",
    "court",
    "coram",
    "benchType",
    "dateOfJudgment",
    "statutes",
    "ratio",
    "excerptPara",
    "excerptText",
    "subsequentTreatment",
    "verificationStatus",
    "officialSourceUrl",
}


class _SafeFormatDict(dict):
    def __missing__(self, key):
        return "{" + key + "}"


def _safe_prompt_format(template: str, **kwargs: Any) -> str:
    """
    Format only known placeholders and leave all other braces untouched.
    This avoids crashes when DB prompts contain example JSON objects.
    """
    try:
        return template.format_map(_SafeFormatDict(kwargs))
    except Exception:
        return template


def _extract_balanced_json_object(text: str) -> str:
    """Return the first balanced JSON object from model output when possible."""
    start = text.find("{")
    if start < 0:
        return text

    depth = 0
    in_string = False
    escape = False
    for idx in range(start, len(text)):
        ch = text[idx]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start:idx + 1]

    return text[start:]


def _repair_json_text(text: str) -> str:
    """Repair a few common LLM JSON issues before parsing."""
    repaired = (text or "").strip()
    repaired = re.sub(r"^```(?:json)?\s*", "", repaired, flags=re.I)
    repaired = re.sub(r"```\s*$", "", repaired)
    repaired = repaired.replace("\u201c", '"').replace("\u201d", '"')
    repaired = repaired.replace("\u2018", "'").replace("\u2019", "'")
    repaired = _extract_balanced_json_object(repaired)
    repaired = re.sub(r",(\s*[}\]])", r"\1", repaired)
    return repaired


def _parse_model_json(text: str) -> Optional[Dict[str, Any]]:
    repaired = _repair_json_text(text)
    if not repaired:
        return None
    try:
        parsed = json.loads(repaired)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError as exc:
        preview = repaired[:400].replace("\n", " ")
        logger.warning("[CLERK] Gemini JSON parse failed: %s | preview=%s", exc, preview)
        return _salvage_partial_clerk_payload(repaired)


def _salvage_partial_clerk_payload(text: str) -> Optional[Dict[str, Any]]:
    """
    Best-effort extraction when Gemini returns truncated/invalid JSON.
    Pulls core fields from partial text so pipeline can continue safely.
    """
    if not text:
        return None

    def _pick(key: str) -> str:
        m = re.search(rf'"{re.escape(key)}"\s*:\s*"([^"]*)', text, flags=re.I)
        return (m.group(1).strip() if m else "")

    def _pick_list(key: str) -> List[str]:
        m = re.search(rf'"{re.escape(key)}"\s*:\s*\[([^\]]*)', text, flags=re.I | re.S)
        if not m:
            return []
        chunk = m.group(1)
        vals = re.findall(r'"([^"]+)"', chunk)
        return [v.strip() for v in vals if v and v.strip()]

    out = {
        "caseName": _pick("caseName"),
        "primaryCitation": _pick("primaryCitation"),
        "alternateCitations": _pick_list("alternateCitations"),
        "court": _pick("court"),
        "coram": _pick("coram"),
        "benchType": _pick("benchType"),
        "dateOfJudgment": _pick("dateOfJudgment"),
        "statutes": _pick_list("statutes"),
        "ratio": _pick("ratio"),
        "excerptPara": _pick("excerptPara"),
        "excerptText": _pick("excerptText"),
        "subsequentTreatment": {"followed": [], "distinguished": [], "overruled": []},
        "verificationStatus": _pick("verificationStatus") or "Requires review",
        "officialSourceUrl": _pick("officialSourceUrl") or None,
    }
    return out if _is_expected_clerk_payload(out) else None


def _is_expected_clerk_payload(payload: Optional[Dict[str, Any]]) -> bool:
    if not isinstance(payload, dict) or not payload:
        return False
    if "content_html" in payload:
        return False
    return bool(_EXPECTED_CLERK_KEYS.intersection(payload.keys()))


# ─── Chunking ────────────────────────────────────────────────────────────────

def _chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    if not text or len(text) < chunk_size:
        return [text] if text else []
    chunks, start = [], 0
    while start < len(text):
        chunks.append(text[start:start + chunk_size])
        start += chunk_size - overlap
    if len(chunks) > MAX_CHUNKS_PER_DOC:
        logger.info(
            "[CLERK] Chunk cap applied: %d -> %d (set CITATION_MAX_CHUNKS_PER_DOC to tune)",
            len(chunks),
            MAX_CHUNKS_PER_DOC,
        )
        return chunks[:MAX_CHUNKS_PER_DOC]
    return chunks


# ─── Gemini extraction ────────────────────────────────────────────────────────

# Characters of judgment text to send for extraction — read full judgment for all 10 points (zero mistakes)
EXTRACT_TEXT_LENGTH = 40000


# Default prompt kept as fallback for when DB has no row for "Clerk"
_DEFAULT_CLERK_PROMPT = """You are a specialized legal document analyzer for Indian Court Judgments.
Extract ALL 10 mandatory citation points from the judgment. Read the FULL text provided — ratio and key holdings often appear in the middle or end.
Fix OCR errors (e.g. '1PC' → 'IPC'). Do NOT leave any point empty if the information appears anywhere in the text.
Use "Further research needed" ONLY when the information is genuinely absent from the document.

Return ONLY a single valid JSON object. No explanation.

10 Required Points (exact keys) — extract from the complete judgment:
{{
  "caseName": "Exact full case name: correct spelling, Appellant v. Respondent, no abbreviations (e.g. Maneka Gandhi v. Union of India).",
  "primaryCitation": "Recognized reporter citation: SCC, AIR, or equivalent (e.g. (1978) 1 SCC 248, AIR 1978 SC 597).",
  "alternateCitations": ["Other reporter citations found in the document."],
  "court": "Full court name (e.g. Supreme Court of India, Bombay High Court).",
  "coram": "Bench (Coram): names of judges, prefixed by Justice.",
  "benchType": "Bench strength (e.g. Division Bench, 3-Judge Bench, Constitution Bench, Single Judge).",
  "dateOfJudgment": "Date of judgment in DD Month YYYY (e.g. 25 January 1978).",
  "statutes": ["Sections/acts cited (e.g. Section 302 IPC; Article 21, Constitution of India)."],
  "ratio": "Ratio decidendi: the precise legal principle/holding in 2-4 sentences. Extract from the judgment body, not just the headnote.",
  "excerptPara": "Pinpoint citation paragraph number (e.g. Para 7, Para 42) for the key holding.",
  "excerptText": "Verbatim key paragraph(s) for that pinpoint (max 300 words).",
  "subsequentTreatment": {{
    "followed": ["Case names or citations where this judgment was followed, if in text."],
    "distinguished": ["Where distinguished, if in text."],
    "overruled": ["Case that overruled this, if in text."]
  }},
  "verificationStatus": "Verified and authentic" | "Requires review" | "Invalid / not found",
  "officialSourceUrl": "URL if stated in judgment (e.g. Supreme Court, eCourts). Otherwise null."
}}

Context Title: {title}
Original Query: {query}

Complete judgment text (read thoroughly for all 10 points):
{excerpt}

JSON:"""


def _gemini_extract(
    raw_text: str,
    title: str = "",
    query: str = "",
    dimension_context: str = "",
    run_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Use Gemini to extract ALL 10 mandatory citation points from the COMPLETE judgment text.
    Prompt and model are resolved dynamically from Draft_DB, with in-code fallback.
    """
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        logger.error("[CLERK] API key missing for Gemini extraction.")
        return None

    excerpt = raw_text[:EXTRACT_TEXT_LENGTH].strip()
    if not excerpt:
        return None

    # Build dimension context annotation for the prompt (injected after query line)
    dim_annotation = ""
    if dimension_context:
        dim_annotation = f"\nLegal Dimension Context: {dimension_context}\n"

    # Resolve prompt, model, temperature from DB → fallback to defaults
    default_model = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
    default_config_kw: Dict[str, Any] = {
        "temperature": 0.1,
        "maxOutputTokens": 4096,
        "responseMimeType": "application/json",
    }
    prompt = _safe_prompt_format(
        _DEFAULT_CLERK_PROMPT, title=title, query=query + dim_annotation, excerpt=excerpt
    )
    model = default_model
    config_kw: Dict[str, Any] = default_config_kw.copy()
    try:
        from utils.prompt_resolver import resolve_prompt
        pc = resolve_prompt(
            name="Clerk",
            agent_type="citation",
            default_prompt=_DEFAULT_CLERK_PROMPT,
            default_model=default_model,
            default_temperature=0.1,
            default_max_tokens=4096,
        )
        prompt = _safe_prompt_format(pc.prompt, title=title, query=query + dim_annotation, excerpt=excerpt)
        model = pc.model_name
        temperature = pc.temperature
        max_tokens = pc.max_tokens
        config_kw = pc.gemini_config.copy()
        config_kw["responseMimeType"] = "application/json"
        logger.info("[CLERK] Prompt source=%s model=%s temp=%.2f", pc.source, model, temperature)
    except Exception as exc:
        logger.warning("[CLERK] Prompt resolver failed (%s), using default", exc)
        prompt = _safe_prompt_format(
            _DEFAULT_CLERK_PROMPT, title=title, query=query + dim_annotation, excerpt=excerpt
        )
        model = default_model
        config_kw = default_config_kw.copy()

    try:
        client = genai.Client(api_key=api_key)
        config = genai.types.GenerateContentConfig(**config_kw)
        
        resp = client.models.generate_content(
            model=model,
            contents=prompt,
            config=config,
        )
        parsed = _parse_model_json(resp.text or "")
        try:
            um = getattr(resp, "usage_metadata", None)
            if um:
                ti = int(getattr(um, "prompt_token_count", 0) or 0)
                to = int(getattr(um, "response_token_count", 0) or 0)
                from utils.usage_tracker import record_gemini
                record_gemini(run_id, user_id or "anonymous", "clerk_extract", tokens_in=ti, tokens_out=to, model=model)
        except Exception:
            pass
        if _is_expected_clerk_payload(parsed):
            return parsed
        logger.warning("[CLERK] Gemini returned unexpected JSON shape; retrying with default Clerk prompt")

        fallback_resp = client.models.generate_content(
            model=default_model,
            contents=_safe_prompt_format(_DEFAULT_CLERK_PROMPT, title=title, query=query, excerpt=excerpt),
            config=genai.types.GenerateContentConfig(**default_config_kw),
        )
        fallback_parsed = _parse_model_json(fallback_resp.text or "")
        try:
            um = getattr(fallback_resp, "usage_metadata", None)
            if um:
                ti = int(getattr(um, "prompt_token_count", 0) or 0)
                to = int(getattr(um, "response_token_count", 0) or 0)
                from utils.usage_tracker import record_gemini
                record_gemini(run_id, user_id or "anonymous", "clerk_extract", tokens_in=ti, tokens_out=to, model=default_model)
        except Exception:
            pass
        if _is_expected_clerk_payload(fallback_parsed):
            return fallback_parsed

        logger.warning("[CLERK] Gemini returned non-parseable or mismatched JSON; falling back to default merge")
        return None
    except Exception as e:
        logger.warning("[CLERK] Gemini extraction failed: %s", e)
        return None


# ─── Merging & Ingestion ─────────────────────────────────────────────────────

def _normalize_subsequent_treatment(st: Any) -> Dict[str, List[str]]:
    if not st or not isinstance(st, dict):
        return {"followed": [], "distinguished": [], "overruled": []}
    return {
        "followed": [str(x).strip() for x in (st.get("followed") or []) if x],
        "distinguished": [str(x).strip() for x in (st.get("distinguished") or []) if x],
        "overruled": [str(x).strip() for x in (st.get("overruled") or []) if x],
    }


def _strip_html_css(text: str) -> str:
    """Remove HTML/CSS so excerpt is judgment prose only, not page styles."""
    if not text or not isinstance(text, str):
        return (text or "").strip()
    out = re.sub(r"<[^>]+>", " ", text)
    out = re.sub(r"\s+", " ", out).strip()
    if re.search(r"var\(--|}\s*;|\.\w+\s*\{|gradient|box-shadow|border-radius", out[:500]):
        return ""
    return out[:3000]


def _html_to_text(content: str) -> str:
    """
    Best-effort HTML to plain text for storing in DB:
    - drop script/style blocks
    - convert <br> and </p> to line breaks
    - strip remaining tags
    - collapse whitespace
    """
    if not isinstance(content, str):
        return str(content or "").strip()
    if "<" not in content and ">" not in content:
        return content.strip()
    text = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", content)
    text = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", text)
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</p\s*>", "\n\n", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _merge_extraction(gem: Optional[Dict], title: str) -> Dict[str, Any]:
    """Ensure all 10 report points are present (CHECK 6) while keeping unknowns empty."""
    gem = gem or {}
    ratio = (gem.get("ratio") or "").strip()
    citation = (gem.get("primaryCitation") or "").strip()
    if ratio.lower() in ("further research needed", "further research needed.", "not available", "unknown"):
        ratio = ""
    if not citation or citation in ("—", "null", "None", "Further research needed", "Further research needed."):
        citation = ""
    subsequent = _normalize_subsequent_treatment(gem.get("subsequentTreatment"))
    verification = (gem.get("verificationStatus") or "").strip() or "Requires review"
    if verification.lower() in ("null", "none", ""):
        verification = "Requires review"
    official_url = (gem.get("officialSourceUrl") or "").strip() or None
    if official_url and official_url.lower() in ("null", "none"):
        official_url = None
    # Use document title when Gemini returns "not found" / "not available" for case name
    case_name = (gem.get("caseName") or "").strip()
    if not case_name or case_name.lower() in (
        "case name not found in the provided text.",
        "not available in the provided text.",
        "n/a", "none", "null", "not found", "unknown",
    ):
        case_name = title or "Judgment"
    excerpt_raw = (gem.get("excerptText") or "").strip()
    excerpt_clean = _strip_html_css(excerpt_raw) if excerpt_raw else ""
    return {
        "title":                 case_name,
        "primary_citation":      citation,
        "alternate_citations":   gem.get("alternateCitations") or [],
        "court":                 gem.get("court") or "",
        "coram":                 gem.get("coram") or "",
        "bench_type":            gem.get("benchType") or "",
        "date_judgment":         gem.get("dateOfJudgment") or "",
        "statutes":              gem.get("statutes") or [],
        "ratio":                 ratio,
        "excerpt_para":          gem.get("excerptPara") or "",
        "excerpt_text":          excerpt_clean or excerpt_raw or "",
        "subsequent_treatment":  subsequent,
        "verification_status":   verification,
        "official_source_url":   official_url,
    }


def _looks_like_non_judgment(info: Dict[str, Any]) -> bool:
    blob = " ".join([
        str(info.get("title") or ""),
        str(info.get("primary_citation") or ""),
        str(info.get("court") or ""),
        str(info.get("ratio") or ""),
    ]).lower()
    if not blob.strip():
        return True
    blocked_markers = (
        "not applicable",
        "document is a manual",
        "manual",
        "constitution of india",
        "published vide",
        "rules,",
        " act,",
    )
    return any(m in blob for m in blocked_markers)


def _clean_date(value: str) -> Optional[str]:
    if not value:
        return None
    v = value.strip()
    if v in ("â€”", "-", "N/A", "Not available", "Unknown"):
        return None
    low = v.lower()
    if "further research" in low or "not found" in low or "not available" in low or "date not found" in low:
        return None
    if not re.search(r"\b(19\d{2}|20\d{2})\b", v):
        return None
    return v


def _parse_year(date_str: str) -> Optional[int]:
    if not date_str:
        return None
    m = re.search(r"\b(19\d{2}|20\d{2})\b", date_str)
    if not m:
        return None
    try:
        return int(m.group(1))
    except Exception:
        return None


def _split_judges(coram: str) -> List[str]:
    if not coram:
        return []
    cleaned = re.sub(r"\b(justice|hon'ble|honble)\b", "", coram, flags=re.I).strip()
    parts = re.split(r",|;| and ", cleaned)
    return [p.strip() for p in parts if p.strip()]


def _bench_size(bench_type: str) -> Optional[int]:
    if not bench_type:
        return None
    m = re.search(r"\b(\d+)\b", bench_type)
    if m:
        try:
            return int(m.group(1))
        except Exception:
            return None
    bench_type_lower = bench_type.lower()
    if "single" in bench_type_lower:
        return 1
    if "division" in bench_type_lower:
        return 2
    if "three" in bench_type_lower:
        return 3
    if "constitution" in bench_type_lower:
        return 5
    return None


def _court_code(court_name: str) -> str:
    if not court_name:
        return "Unknown"
    name = court_name.strip()
    low = name.lower()
    if "supreme court" in low:
        return "SC"
    if "high court" in low:
        return "HC"
    if len(name) <= 50:
        return name
    return name[:50]


def clerk_ingest_ik(
    doc_list: List[Dict[str, Any]],
    query: str = "",
    case_id: Optional[str] = None,
    run_id: Optional[str] = None,
    user_id: Optional[str] = None,
    dimensions: Optional[List[Dict[str, Any]]] = None,
) -> List[str]:
    """Ingest documents from Indian Kanoon API results. case_id = original case for report (for Qdrant payload)."""
    # Build dimension lookup: dimension_id → dimension dict (for context injection)
    _dim_lookup: Dict[int, Dict[str, Any]] = {}
    for d in (dimensions or []):
        did = d.get("dimension_id")
        if did is not None:
            _dim_lookup[did] = d

    def _process_doc(doc: Dict[str, Any]) -> Optional[str]:
        from agents.legal_citation_agent import LegalCitationAgent
        agent = LegalCitationAgent()
        # Fetcher returns raw_content and doc_html; support both for compatibility
        raw_text = (
            doc.get("raw_content")
            or doc.get("doc_html")
            or doc.get("content")
            or doc.get("content_html")
            or ""
        )
        raw_text = _html_to_text(raw_text)
        title = doc.get("title") or "Unknown IK Document"
        tid = doc.get("external_id") or doc.get("tid") or ""
        source_url = f"https://indiankanoon.org/doc/{tid}/" if tid else ""

        # Resolve dimension metadata attached by Watchdog/LDE
        dim_id   = doc.get("_dimension_id")
        dim_name = doc.get("_dimension_name") or ""
        q_type   = doc.get("_query_type") or ""
        dimension_context = ""
        if dim_id is not None and dim_id in _dim_lookup:
            d = _dim_lookup[dim_id]
            dimension_context = (
                f"{d.get('name', dim_name)} — {d.get('reasoning', '')}".strip(" —")
            )
        elif dim_name:
            dimension_context = dim_name

        # 1. Gemini Extraction (OCR + Structure). CHECK 6: re-extract once if ratio/citation empty.
        extracted = _gemini_extract(
            raw_text, title=title, query=query,
            dimension_context=dimension_context,
            run_id=run_id, user_id=user_id,
        )
        if extracted and not (extracted.get("ratio") or "").strip() and not (extracted.get("primaryCitation") or "").strip():
            extracted = _gemini_extract(
                raw_text, title=title, query=query,
                dimension_context=dimension_context,
                run_id=run_id, user_id=user_id,
            )
        info = _merge_extraction(extracted, title)
        if _looks_like_non_judgment(info):
            logger.info("[CLERK] Skipping non-judgment document: %s", title[:80])
            return None

        # 2. Chunking for ES/Qdrant
        chunks = _chunk_text(raw_text)
        paragraphs = [{"paragraph_id": i, "text": chk} for i, chk in enumerate(chunks)]

        # 3. Multi-DB ingest
        judgment_date = _clean_date(info["date_judgment"])
        court_name = info["court"]
        raw_data = {
            "case_name": info["title"],
            "court_code": _court_code(court_name),
            "court_name": court_name,
            "judgment_date": judgment_date,
            "year": _parse_year(judgment_date or "") or datetime.utcnow().year,
            "bench_size": _bench_size(info["bench_type"]),
            "bench_type": info["bench_type"],
            "summary_text": info["ratio"],
            "holding_text": info["ratio"],
            "facts_text": "",
            "full_text": raw_text,
            "paragraphs": paragraphs,
            "judges": _split_judges(info["coram"]),
            "statutes": info["statutes"],
            "primary_citation": info["primary_citation"],
            "alternate_citations": info["alternate_citations"],
            "citation_aliases": info["alternate_citations"],
            "excerpt_para": info["excerpt_para"],
            "excerpt_text": info["excerpt_text"],
            "subsequent_treatment": info.get("subsequent_treatment") or {"followed": [], "distinguished": [], "overruled": []},
            "verification_status": info.get("verification_status") or "Requires review",
            "official_source_url": info.get("official_source_url"),
            "source_type": "indian_kanoon",
            "source_url": source_url or info.get("official_source_url") or "",
            "case_id": case_id,
            # IK-specific enrichment fields from fetcher
            "ik_orig_doc_url":    doc.get("original_copy_url") or "",
            "ik_fragments":       {
                "headline": doc.get("ik_fragment_headline") or "",
                "headline_html": doc.get("ik_fragment_html") or "",
                "form_input": doc.get("ik_form_input") or "",
            },
            "ik_cite_list":       doc.get("cite_list") or [],
            "ik_cited_by_list":   doc.get("cited_by_list") or [],
            "ik_doc_meta":        doc.get("ik_doc_meta") or {},
            # Dimension tags (from LDE/Watchdog)
            "dimension_id":       dim_id,
            "dimension_name":     dim_name or None,
            "dimension_tags":     [dim_name] if dim_name else [],
            "query_type":         q_type or None,
        }

        try:
            out = agent.ingest_judgment(raw_data)
        except Exception as e:
            logger.warning("[CLERK] IK ingest failed for %s: %s", title[:60], e)
            return None
        # CHECK 7: only count as ingested if all stores succeeded (or skipped duplicate)
        if out.get("status") == "storage_failed":
            try:
                out = agent.ingest_judgment(raw_data)  # retry once
            except Exception as e2:
                logger.warning("[CLERK] IK ingest retry failed for %s: %s", title[:60], e2)
                return None
        if out.get("status") in ("success", "skipped") and out.get("canonical_id"):
            canonical_id = out["canonical_id"]
            # Persist IK asset data to ik_document_assets table
            if tid:
                try:
                    from db.client import ik_asset_upsert
                    ik_asset_upsert(
                        doc_id=tid,
                        canonical_id=out["canonical_id"],
                        meta=doc.get("ik_doc_meta") or {},
                        fragments={
                            "headline": doc.get("ik_fragment_headline") or "",
                            "headline_html": doc.get("ik_fragment_html") or "",
                            "form_input": doc.get("ik_form_input") or "",
                        },
                        cite_list=doc.get("cite_list") or [],
                        cited_by_list=doc.get("cited_by_list") or [],
                        orig_doc_url=doc.get("original_copy_url") or "",
                        orig_doc_gcs_path=doc.get("original_copy_gcs_path") or "",
                        orig_doc_content_type="application/pdf" if doc.get("is_original_copy_pdf") else "text/html",
                    )
                except Exception as _ae:
                    logger.warning("[CLERK] ik_asset_upsert failed for tid=%s: %s", tid, _ae)
            return canonical_id
        return None

    new_ids: List[str] = []
    with ThreadPoolExecutor(max_workers=min(CLERK_DOC_WORKERS, len(doc_list) or 1)) as pool:
        futs = [pool.submit(_process_doc, doc) for doc in doc_list]
        for fut in as_completed(futs):
            try:
                result = fut.result(timeout=180)
                if result:
                    new_ids.append(result)
            except Exception as exc:
                logger.warning("[CLERK] IK worker failed: %s", exc)
    return new_ids


def clerk_ingest_google(
    doc_list: List[Dict[str, Any]],
    query: str = "",
    case_id: Optional[str] = None,
    run_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> List[str]:
    """Ingest documents from Google / Serper / Web results. case_id = original case for report (for Qdrant payload)."""
    def _process_doc(doc: Dict[str, Any]) -> Optional[str]:
        from agents.legal_citation_agent import LegalCitationAgent
        agent = LegalCitationAgent()
        # Fetcher returns raw_content; fallback to snippet/legacy keys
        raw_text = (
            doc.get("raw_content")
            or doc.get("content")
            or doc.get("snippet")
            or ""
        )
        raw_text = _html_to_text(raw_text)
        title = doc.get("title") or "Web Result"
        url = doc.get("link") or doc.get("url") or ""

        # 1. Gemini Extraction. CHECK 6: re-extract once if ratio/citation empty.
        extracted = _gemini_extract(raw_text, title=title, query=query, run_id=run_id, user_id=user_id)
        if extracted and not (extracted.get("ratio") or "").strip() and not (extracted.get("primaryCitation") or "").strip():
            extracted = _gemini_extract(raw_text, title=title, query=query, run_id=run_id, user_id=user_id)
        info = _merge_extraction(extracted, title)
        if _looks_like_non_judgment(info):
            logger.info("[CLERK] Skipping non-judgment web document: %s", title[:80])
            return None

        # 2. Chunking for ES/Qdrant
        chunks = _chunk_text(raw_text)
        paragraphs = [{"paragraph_id": i, "text": chk} for i, chk in enumerate(chunks)]

        # 3. Multi-DB ingest
        judgment_date = _clean_date(info["date_judgment"])
        court_name = info["court"]
        raw_data = {
            "case_name": info["title"],
            "court_code": _court_code(court_name),
            "court_name": court_name,
            "judgment_date": judgment_date,
            "year": _parse_year(judgment_date or "") or datetime.utcnow().year,
            "bench_size": _bench_size(info["bench_type"]),
            "bench_type": info["bench_type"],
            "summary_text": info["ratio"],
            "holding_text": info["ratio"],
            "facts_text": "",
            "full_text": raw_text,
            "paragraphs": paragraphs,
            "judges": _split_judges(info["coram"]),
            "statutes": info["statutes"],
            "primary_citation": info["primary_citation"],
            "alternate_citations": info["alternate_citations"],
            "citation_aliases": info["alternate_citations"],
            "excerpt_para": info["excerpt_para"],
            "excerpt_text": info["excerpt_text"],
            "subsequent_treatment": info.get("subsequent_treatment") or {"followed": [], "distinguished": [], "overruled": []},
            "verification_status": info.get("verification_status") or "Requires review",
            "official_source_url": info.get("official_source_url"),
            "source_type": "google",
            "source_url": url or info.get("official_source_url") or "",
            "case_id": case_id,
        }

        try:
            out = agent.ingest_judgment(raw_data)
        except Exception as e:
            logger.warning("[CLERK] Google ingest failed for %s: %s", title[:60], e)
            return None
        # CHECK 7: only count as ingested if all stores succeeded (or skipped duplicate)
        if out.get("status") == "storage_failed":
            try:
                out = agent.ingest_judgment(raw_data)  # retry once
            except Exception as e2:
                logger.warning("[CLERK] Google ingest retry failed for %s: %s", title[:60], e2)
                return None
        if out.get("status") in ("success", "skipped") and out.get("canonical_id"):
            return out["canonical_id"]
        return None

    new_ids: List[str] = []
    with ThreadPoolExecutor(max_workers=min(CLERK_DOC_WORKERS, len(doc_list) or 1)) as pool:
        futs = [pool.submit(_process_doc, doc) for doc in doc_list]
        for fut in as_completed(futs):
            try:
                result = fut.result(timeout=180)
                if result:
                    new_ids.append(result)
            except Exception as exc:
                logger.warning("[CLERK] Google worker failed: %s", exc)
    return new_ids


def clerk_enrich_local_canonical_ids(
    canonical_ids: List[str],
    query: str = "",
    case_id: Optional[str] = None,
    run_id: Optional[str] = None,
    user_id: Optional[str] = None,
    dimensions: Optional[List[Dict[str, Any]]] = None,
    local_hints: Optional[Dict[str, Dict[str, Any]]] = None,
    pipeline_api_context: Optional[Dict[str, Any]] = None,
) -> List[str]:
    """
    For Qdrant-local judgments missing ``citation_data.analysis_report``, run the same
    Gemini extraction as IK ingest and merge into PG (JSONB) + Elasticsearch.

    ``pipeline_api_context`` is stored inside ``analysis_report`` so downstream
    ReportBuilder / auditors can see which external search routes ran alongside.
    """
    from db.client import judgement_get, judgement_merge_citation_data, _judgment_citation_data_has_analysis_report
    from db.connections import get_es_client

    ids = [str(c).strip() for c in (canonical_ids or []) if str(c).strip()]
    if not ids:
        return []

    _dim_lookup: Dict[int, Dict[str, Any]] = {}
    for d in (dimensions or []):
        did = d.get("dimension_id")
        if did is not None:
            _dim_lookup[did] = d
    hints = local_hints or {}

    def _one(cid: str) -> Optional[str]:
        j = judgement_get(cid)
        if not j:
            logger.warning("[CLERK_ENRICH] Unknown canonical_id=%s", cid)
            return None
        cd = j.get("citation_data") or {}
        if isinstance(cd, str):
            try:
                cd = json.loads(cd)
            except Exception:
                cd = {}
        if _judgment_citation_data_has_analysis_report(cd):
            return cid
        raw_text = _html_to_text(
            (j.get("full_text") or j.get("raw_content") or cd.get("full_text") or "").strip()
        )
        if len(raw_text) < 120:
            logger.info("[CLERK_ENRICH] Skip %s — insufficient full_text (%d chars)", cid, len(raw_text))
            return cid
        title = (j.get("title") or j.get("case_name") or "Judgment")[:500]
        hint = hints.get(cid) or {}
        dim_id = hint.get("_dimension_id")
        dim_name = hint.get("_dimension_name") or ""
        q_type = (hint.get("_query_types") or [None])[0] if hint.get("_query_types") else hint.get("_query_type")
        dimension_context = ""
        if dim_id is not None and dim_id in _dim_lookup:
            d = _dim_lookup[dim_id]
            dimension_context = f"{d.get('name', dim_name)} — {d.get('reasoning', '')}".strip(" —")
        elif dim_name:
            dimension_context = str(dim_name)

        extracted = _gemini_extract(
            raw_text, title=title, query=query,
            dimension_context=dimension_context,
            run_id=run_id, user_id=user_id,
        )
        if extracted and not (extracted.get("ratio") or "").strip() and not (extracted.get("primaryCitation") or "").strip():
            extracted = _gemini_extract(
                raw_text, title=title, query=query,
                dimension_context=dimension_context,
                run_id=run_id, user_id=user_id,
            )
        info = _merge_extraction(extracted, title)
        if _looks_like_non_judgment(info):
            logger.info("[CLERK_ENRICH] Skip non-judgment shape for %s", title[:70])
            return cid

        analysis_report: Dict[str, Any] = {
            "clerkModelExtraction": extracted or {},
            "mergedFields": info,
            "watchdogContext": {
                "qdrantSimilarity": float(hint.get("_similarity_score") or 0.0),
                "dimension_id": hint.get("_dimension_id"),
                "dimension_ids": hint.get("_dimension_ids"),
                "dimension_name": hint.get("_dimension_name"),
                "query_types": hint.get("_query_types"),
            },
            "pipelineApiContext": pipeline_api_context or {},
        }
        patch = {
            "analysis_report": analysis_report,
            "primary_citation": info.get("primary_citation") or cd.get("primary_citation"),
            "holding_text": info.get("ratio") or cd.get("holding_text"),
            "summary_text": info.get("ratio") or cd.get("summary_text"),
            "court_name": info.get("court") or cd.get("court_name"),
            "case_name": info.get("title") or cd.get("case_name"),
            "excerpt_para": info.get("excerpt_para") or cd.get("excerpt_para"),
            "excerpt_text": info.get("excerpt_text") or cd.get("excerpt_text"),
            "statutes": info.get("statutes") or cd.get("statutes") or [],
            "dimension_id": dim_id if dim_id is not None else cd.get("dimension_id"),
            "dimension_name": dim_name or cd.get("dimension_name"),
            "query_type": q_type or cd.get("query_type"),
        }
        if not judgement_merge_citation_data(cid, patch):
            logger.warning("[CLERK_ENRICH] PG merge failed for %s", cid)
            return None
        es = get_es_client()
        if es:
            try:
                es.update(
                    index="judgments",
                    id=cid,
                    body={
                        "doc": {
                            "primary_citation": patch.get("primary_citation"),
                            "holding_text": patch.get("holding_text"),
                            "summary_text": patch.get("summary_text"),
                            "case_name": patch.get("case_name"),
                            "court_name": patch.get("court_name"),
                            "excerpt_para": patch.get("excerpt_para"),
                            "excerpt_text": patch.get("excerpt_text"),
                            "statutes": patch.get("statutes"),
                        }
                    },
                    doc_as_upsert=True,
                )
            except Exception as exc:
                logger.warning("[CLERK_ENRICH] ES update failed for %s: %s", cid, exc)
        logger.info("[CLERK_ENRICH] Updated analysis_report for canonical_id=%s", cid)
        return cid

    done: List[str] = []
    with ThreadPoolExecutor(max_workers=min(CLERK_DOC_WORKERS, len(ids) or 1)) as pool:
        futs = [pool.submit(_one, c) for c in ids]
        for fut in as_completed(futs):
            try:
                r = fut.result(timeout=240)
                if r:
                    done.append(r)
            except Exception as exc:
                logger.warning("[CLERK_ENRICH] worker failed: %s", exc)
    return done
