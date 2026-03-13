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
from typing import Any, Dict, List, Optional
from google import genai

logger = logging.getLogger(__name__)

CHUNK_SIZE    = 1200
CHUNK_OVERLAP = 200


# ─── Chunking ────────────────────────────────────────────────────────────────

def _chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    if not text or len(text) < chunk_size:
        return [text] if text else []
    chunks, start = [], 0
    while start < len(text):
        chunks.append(text[start:start + chunk_size])
        start += chunk_size - overlap
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


def _gemini_extract(raw_text: str, title: str = "", query: str = "") -> Optional[Dict[str, Any]]:
    """
    Use Gemini to extract ALL 10 mandatory citation points from the COMPLETE judgment text.
    Prompt and model are resolved dynamically from Draft_DB, with in-code fallback.
    """
    api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        logger.error("[CLERK] API key missing for Gemini extraction.")
        return None

    excerpt = raw_text[:EXTRACT_TEXT_LENGTH].strip()
    if not excerpt:
        return None

    # Resolve prompt, model, temperature from DB → fallback to defaults
    try:
        from utils.prompt_resolver import resolve_prompt
        pc = resolve_prompt(
            name="Clerk",
            agent_type="citation",
            default_prompt=_DEFAULT_CLERK_PROMPT,
            default_model=os.environ.get("GEMINI_MODEL", "gemini-2.0-flash"),
            default_temperature=0.1,
            default_max_tokens=1536,
        )
        prompt = pc.prompt.format(title=title, query=query, excerpt=excerpt)
        model = pc.model_name
        temperature = pc.temperature
        max_tokens = pc.max_tokens
        logger.info("[CLERK] Prompt source=%s model=%s temp=%.2f", pc.source, model, temperature)
    except Exception as exc:
        logger.warning("[CLERK] Prompt resolver failed (%s), using default", exc)
        prompt = _DEFAULT_CLERK_PROMPT.format(title=title, query=query, excerpt=excerpt)
        model = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
        temperature = 0.1
        max_tokens = 1536

    try:
        client = genai.Client(api_key=api_key)
        # Start with safelist config from PromptConfig, merge explicit settings
        config_kw: Dict[str, Any] = pc.gemini_config.copy()
        config_kw["responseMimeType"] = "application/json"
        
        config = genai.types.GenerateContentConfig(**config_kw)
        
        resp = client.models.generate_content(
            model=model,
            contents=prompt,
            config=config,
        )
        text = (resp.text or "").strip()
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"```\s*$", "", text)
        return json.loads(text)
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
    """Ensure all 10 report points are present (CHECK 6: holding, ratio, citation). Use placeholder if missing."""
    gem = gem or {}
    ratio = (gem.get("ratio") or "").strip()
    citation = (gem.get("primaryCitation") or "").strip()
    if not ratio:
        ratio = "Further research needed."
    if not citation or citation in ("—", "null", "None"):
        citation = "—"
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
        "primary_citation":      citation or "—",
        "alternate_citations":   gem.get("alternateCitations") or [],
        "court":                 gem.get("court") or "Court not specified",
        "coram":                 gem.get("coram") or "—",
        "bench_type":            gem.get("benchType") or "—",
        "date_judgment":         gem.get("dateOfJudgment") or "—",
        "statutes":              gem.get("statutes") or [],
        "ratio":                 ratio or "Ratio not available.",
        "excerpt_para":          gem.get("excerptPara") or "Para 1",
        "excerpt_text":          excerpt_clean or excerpt_raw or "—",
        "subsequent_treatment":  subsequent,
        "verification_status":   verification,
        "official_source_url":   official_url,
    }


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


def clerk_ingest_ik(doc_list: List[Dict[str, Any]], query: str = "", case_id: Optional[str] = None) -> List[str]:
    """Ingest documents from Indian Kanoon API results. case_id = original case for report (for Qdrant payload)."""
    from agents.legal_citation_agent import LegalCitationAgent
    new_ids = []
    agent = LegalCitationAgent()

    for doc in doc_list:
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

        # 1. Gemini Extraction (OCR + Structure). CHECK 6: re-extract once if ratio/citation empty.
        extracted = _gemini_extract(raw_text, title=title, query=query)
        if extracted and not (extracted.get("ratio") or "").strip() and not (extracted.get("primaryCitation") or "").strip():
            extracted = _gemini_extract(raw_text, title=title, query=query)
        info = _merge_extraction(extracted, title)

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
        }

        try:
            out = agent.ingest_judgment(raw_data)
        except Exception as e:
            logger.warning("[CLERK] IK ingest failed for %s: %s", title[:60], e)
            continue
        # CHECK 7: only count as ingested if all stores succeeded (or skipped duplicate)
        if out.get("status") == "storage_failed":
            try:
                out = agent.ingest_judgment(raw_data)  # retry once
            except Exception as e2:
                logger.warning("[CLERK] IK ingest retry failed for %s: %s", title[:60], e2)
                continue
        if out.get("status") in ("success", "skipped") and out.get("canonical_id"):
            new_ids.append(out["canonical_id"])
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
    return new_ids


def clerk_ingest_google(doc_list: List[Dict[str, Any]], query: str = "", case_id: Optional[str] = None) -> List[str]:
    """Ingest documents from Google / Serper / Web results. case_id = original case for report (for Qdrant payload)."""
    from agents.legal_citation_agent import LegalCitationAgent
    new_ids = []
    agent = LegalCitationAgent()

    for doc in doc_list:
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
        extracted = _gemini_extract(raw_text, title=title, query=query)
        if extracted and not (extracted.get("ratio") or "").strip() and not (extracted.get("primaryCitation") or "").strip():
            extracted = _gemini_extract(raw_text, title=title, query=query)
        info = _merge_extraction(extracted, title)

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
            continue
        # CHECK 7: only count as ingested if all stores succeeded (or skipped duplicate)
        if out.get("status") == "storage_failed":
            try:
                out = agent.ingest_judgment(raw_data)  # retry once
            except Exception as e2:
                logger.warning("[CLERK] Google ingest retry failed for %s: %s", title[:60], e2)
                continue
        if out.get("status") in ("success", "skipped") and out.get("canonical_id"):
            new_ids.append(out["canonical_id"])
    return new_ids
