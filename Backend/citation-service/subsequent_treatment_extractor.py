"""
subsequent_treatment_extractor.py
──────────────────────────────────
Extracts "Subsequent Treatment" references from raw judgment text.

Two strategies (both called from extract_subsequent_treatment_combined):
  1. Regex / sentence-parsing  — fast, no LLM cost.
  2. Gemini LLM extraction     — higher recall, used when text is available.

Usage:
    from subsequent_treatment_extractor import extract_subsequent_treatment_combined
    result = extract_subsequent_treatment_combined(judgment_text)
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


def _env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return str(value).strip().lower() in ("1", "true", "yes", "on")


# ── Sentence splitter ────────────────────────────────────────────────────────

_SENT_SPLIT = re.compile(
    r'(?<!\bv\s)'
    r'(?<!\b(?:Mr|Ms|Dr|Jr|Sr|vs|no|cl|pp|ed|cf)\s)'
    r'(?<!\b(?:Mrs|etc|art|sec|vol)\s)'
    r'(?<!\b(?:para|ibid)\s)'
    r'(?<!\b(?:supra|infra)\s)'
    r'(?<!\b(?:op\.cit)\s)'
    r'(?<![A-Z]\.[A-Z])'          # don't split on initials like A.K.
    r'(?<!\d)'                    # don't split after digits (e.g. 1.)
    r'(?<=[.!?])\s+(?=[A-Z\("])',
    re.VERBOSE,
)

def _split_sentences(text: str) -> List[str]:
    """Split text into sentences, tolerant of legal citations."""
    # Normalise whitespace first
    text = re.sub(r'\s+', ' ', text).strip()
    sentences = _SENT_SPLIT.split(text)
    # Second pass: re-split on newlines that look like paragraph breaks
    out = []
    for s in sentences:
        parts = re.split(r'\n{2,}', s)
        out.extend(p.strip() for p in parts if p.strip())
    return out


# ── Case-name patterns ────────────────────────────────────────────────────────

# Primary: "ABC v. XYZ" / "ABC vs. XYZ" / "ABC versus XYZ"
_CASE_PATTERN = re.compile(
    r'(?:'
    r'(?:[A-Z][A-Za-z&\',\.\s]{1,60}?)'           # petitioner
    r'\s+(?:v\.|vs\.|versus)\s+'
    r'(?:[A-Z][A-Za-z&\',\.\s]{1,60}?)'           # respondent
    r')'
    r'(?=\s*(?:\(|,|\d|;|—|–|-|\.|$))',
    re.UNICODE,
)

# Optional year: (1995) or [1995] or AIR 1995
_YEAR_PATTERN = re.compile(r'[\(\[](1[5-9]\d{2}|20[0-2]\d)[\)\]]|(?:AIR|SCC|SCR|SCJ)\s+(1[5-9]\d{2}|20[0-2]\d)')

# Optional citation after case name: (1995) 3 SCC 248  /  AIR 2001 SC 100
_CITATION_INLINE = re.compile(
    r'[\(\[](1[5-9]\d{2}|20[0-2]\d)[\)\]]\s*[\d]*\s*(?:SCC|SCR|AIR|SCJ|DLT|BomCR|MLJ|CLT|HC|SC|All|Cal|Mad|Ker|Del|Bom|Guj|P&H|Raj|MP|AP|Ori)\s*[\d]+',
    re.IGNORECASE,
)


def _extract_case_ref(sentence: str) -> Optional[Dict[str, str]]:
    """Return the first {case_name, year, citation} found in sentence, or None."""
    m = _CASE_PATTERN.search(sentence)
    if not m:
        return None
    case_name = re.sub(r'\s+', ' ', m.group(0)).strip().rstrip('.,;:')

    # Try to grab inline citation right after the case name
    tail = sentence[m.end():]
    cit_m = _CITATION_INLINE.match(tail.strip())
    citation = cit_m.group(0).strip() if cit_m else None

    # Year
    year_m = _YEAR_PATTERN.search(sentence[m.start():m.end() + 40])
    year = (year_m.group(1) or year_m.group(2)) if year_m else None

    return {"case_name": case_name, "year": year or "", "citation": citation or ""}


# ── Treatment keyword definitions ─────────────────────────────────────────────

# Each entry: (canonical_key, list_of_regex_snippets)
# Ordered longest-match first to avoid "relied" matching before "relied on"
_TREATMENT_KEYWORDS: List[tuple] = [
    ("overruled",      [r'overrul(?:ed|ing|es)\s+(?:by|in)?',   r'overrul(?:ed|ing|es)']),
    ("reversed",       [r'revers(?:ed|ing|es)\s+(?:by|in)?',    r'revers(?:ed|ing|es)']),
    ("disapproved",    [r'disapprov(?:ed|ing|es)',               r'not\s+approved']),
    ("distinguished",  [r'distingui(?:shed|shing|shes)\s+(?:from|on\s+facts|in)?', r'distingui(?:shed|shing|shes)']),
    ("approved",       [r'approv(?:ed|ing|es)\s+(?:of|in)?',    r'approv(?:ed|ing|es)']),
    ("followed",       [r'follow(?:ed|ing|s)\s+(?:in|the)?',    r'follow(?:ed|ing|s)']),
    ("applied",        [r'appli(?:ed|es|cation\s+of)\s+(?:in|the)?', r'appli(?:ed|es)']),
    ("relied_on",      [r'reli(?:ed|ance)\s+(?:on|upon|was\s+placed)',  r'relying\s+on',  r'reliance\s+(?:was\s+)?placed\s+on']),
    ("referred",       [r'referr(?:ed|ing)\s+(?:to|in)?',       r'referr(?:ed|ing)']),
    ("cited",          [r'cit(?:ed|ing|ation)\s+(?:with\s+approval|in|the)?', r'cit(?:ed|ing)']),
]

# Pre-compile: (canonical_key, compiled_pattern)
_COMPILED: List[tuple] = []
for _key, _snippets in _TREATMENT_KEYWORDS:
    _combined = '|'.join(f'(?:{s})' for s in _snippets)
    _COMPILED.append((_key, re.compile(_combined, re.IGNORECASE)))


# ── Main extraction function ──────────────────────────────────────────────────

def extract_subsequent_treatment(
    judgment_text: str,
    max_chars: int = 500_000,
) -> Dict[str, Any]:
    """
    Scan judgment_text for sentences mentioning other cases being
    followed / distinguished / overruled etc.

    Returns:
        {
            "followed":     [{"case_name": ..., "year": ..., "citation": ..., "context": ...}, ...],
            "distinguished":[...],
            "overruled":    [...],
            "reversed":     [...],
            "relied_on":    [...],
            "applied":      [...],
            "cited":        [...],
            "referred":     [...],
            "approved":     [...],
            "disapproved":  [...],
            "summary": {
                "followed": 2, "distinguished": 1, ...   # counts
            }
        }
    """
    if not judgment_text:
        return _empty_result()

    text = judgment_text[:max_chars]
    sentences = _split_sentences(text)

    # One set per category to deduplicate by normalised case name
    seen: Dict[str, set] = {k: set() for k, _ in _COMPILED}
    result: Dict[str, List[Dict[str, str]]] = {k: [] for k, _ in _COMPILED}

    for sentence in sentences:
        sent_lower = sentence.lower()
        for key, pattern in _COMPILED:
            if not pattern.search(sent_lower):
                continue
            ref = _extract_case_ref(sentence)
            if not ref:
                continue
            norm = _normalise_name(ref["case_name"])
            if norm in seen[key]:
                continue
            seen[key].add(norm)
            result[key].append({
                "case_name": ref["case_name"],
                "year":      ref["year"],
                "citation":  ref["citation"],
                "context":   _trim_context(sentence, 250),
            })

    summary = {k: len(v) for k, v in result.items()}
    return {**result, "summary": summary}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _normalise_name(name: str) -> str:
    """Lower-case and strip noise for dedup comparison."""
    n = re.sub(r'\s+', ' ', name).lower().strip()
    n = re.sub(r'\b(the|a|an|in|of|and|&)\b', '', n)
    n = re.sub(r'[^a-z0-9 ]', '', n)
    return re.sub(r'\s+', ' ', n).strip()


def _trim_context(sentence: str, max_len: int) -> str:
    s = re.sub(r'\s+', ' ', sentence).strip()
    if len(s) <= max_len:
        return s
    return s[:max_len - 1] + '…'


def _empty_result() -> Dict[str, Any]:
    keys = [k for k, _ in _COMPILED]
    return {**{k: [] for k in keys}, "summary": {k: 0 for k in keys}}


# ── LLM-based extractor (Gemini) ──────────────────────────────────────────────

# Keyword scan: quickly find paragraphs most likely to contain treatment info
_TREATMENT_SCAN = re.compile(
    r'\b(?:follow(?:ed|ing)|distinguish(?:ed|ing)|overrul(?:ed|ing)|revers(?:ed|ing)|'
    r'reli(?:ed|ance)\s+on|appli(?:ed|cation)|cited?|referr(?:ed|ing)|approv(?:ed|ing)|'
    r'disapprov(?:ed|ing)|subsequent\s+(?:treatment|history)|treated?\s+(?:in|as)|'
    r'affirm(?:ed|ing)|upheld?\s+in|set\s+aside\s+(?:by|in))\b',
    re.IGNORECASE,
)

_CATEGORIES = [
    "followed", "distinguished", "overruled", "reversed",
    "relied_on", "applied", "cited", "referred", "approved", "disapproved",
]


def _extract_treatment_paragraphs(text: str, window: int = 600) -> str:
    """
    Find paragraphs / sentences containing treatment keywords and return
    a focused excerpt (≤ 6 000 chars) for the LLM prompt.
    """
    sentences = _split_sentences(text)
    hits: List[str] = []
    seen: set = set()
    for sent in sentences:
        if _TREATMENT_SCAN.search(sent):
            norm = re.sub(r'\s+', ' ', sent).strip()
            if norm not in seen:
                seen.add(norm)
                hits.append(norm)
    focused = " ".join(hits)
    # If focused is thin, fall back to first 4 000 chars of full text
    if len(focused) < 200:
        focused = text[:4000]
    return focused[:6000]


def extract_subsequent_treatment_llm(
    judgment_text: str,
    title: str = "",
    max_chars: int = 50_000,
) -> Dict[str, Any]:
    """
    Use Gemini 2.0 Flash to extract subsequent treatment from judgment text.
    Returns same dict format as extract_subsequent_treatment().
    Falls back gracefully to _empty_result() on any error.
    """
    api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        logger.warning("[TREATMENT_LLM] GOOGLE_API_KEY not set — skipping LLM extraction")
        return _empty_result()

    text = (judgment_text or "")[:max_chars].strip()
    if not text:
        return _empty_result()

    focused = _extract_treatment_paragraphs(text)

    # Default prompt kept as fallback for when DB has no row for "TreatmentExtractor"
    _default_treatment_prompt = """You are a senior Indian legal researcher analysing a court judgment.

Your task: extract ALL "Subsequent Treatment" references from the text below.

Find cases where THIS judgment was:
  • FOLLOWED (cited as binding precedent in a later case)
  • DISTINGUISHED (courts said the facts were different)
  • OVERRULED (a higher court overturned this ruling)
  • REVERSED (appellate court reversed the decision)

Also find cases that THIS judgment itself:
  • RELIED ON / RELIED UPON
  • APPLIED
  • CITED
  • REFERRED TO
  • APPROVED
  • DISAPPROVED

Return ONLY a single valid JSON object — no explanation, no markdown fences:
{{
  "followed":      [{{"case_name": "...", "year": "...", "citation": "..."}}],
  "distinguished": [...],
  "overruled":     [...],
  "reversed":      [...],
  "relied_on":     [...],
  "applied":       [...],
  "cited":         [...],
  "referred":      [...],
  "approved":      [...],
  "disapproved":   [...]
}}

Rules:
- case_name  : full "Party v. Party" format (e.g. "State of Maharashtra v. Mayer Hans George")
- year       : 4-digit year if visible, else ""
- citation   : reporter citation if visible (e.g. "(1995) 3 SCC 248"), else ""
- Use [] for any category with no results
- Do NOT include the judgment itself in any list
- Deduplicate: each unique case appears once in the most specific category

{case_title_line}

JUDGMENT TEXT (relevant excerpts):
{focused}

JSON:"""

    # Resolve prompt, model, temperature from DB → fallback to defaults
    try:
        from utils.prompt_resolver import resolve_prompt
        pc = resolve_prompt(
            name="TreatmentExtractor",
            agent_type="citation",
            default_prompt=_default_treatment_prompt,
            default_model=os.environ.get("GEMINI_MODEL", "gemini-2.0-flash"),
            default_temperature=0.0,
            default_max_tokens=1200,
        )
        case_title_line = f"Case being analysed: {title}" if title else ""
        prompt = pc.prompt.format(case_title_line=case_title_line, focused=focused)
        model = pc.model_name
        temperature = pc.temperature
        max_tokens = pc.max_tokens
        logger.info("[TREATMENT_LLM] Prompt source=%s model=%s temp=%.2f", pc.source, model, temperature)
    except Exception as exc:
        logger.warning("[TREATMENT_LLM] Prompt resolver failed (%s), using default", exc)
        case_title_line = f"Case being analysed: {title}" if title else ""
        prompt = _default_treatment_prompt.format(case_title_line=case_title_line, focused=focused)
        model = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
        temperature = 0.0
        max_tokens = 1200

    try:
        from google import genai as _genai
        client = _genai.Client(api_key=api_key)
        
        # Start with safelist config from PromptConfig, merge explicit settings
        config_kw: Dict[str, Any] = pc.gemini_config
        
        resp = client.models.generate_content(
            model=model,
            contents=prompt,
            config=_genai.types.GenerateContentConfig(**config_kw),
        )
        raw = (resp.text or "").strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"```\s*$", "", raw)
        parsed = json.loads(raw)
    except Exception as e:
        logger.warning("[TREATMENT_LLM] Gemini call/parse failed: %s", e)
        return _empty_result()

    # Normalise into the same format as extract_subsequent_treatment()
    result: Dict[str, List[Dict[str, str]]] = {k: [] for k in _CATEGORIES}
    seen_norm: Dict[str, set] = {k: set() for k in _CATEGORIES}

    for cat in _CATEGORIES:
        raw_list = parsed.get(cat) or []
        if not isinstance(raw_list, list):
            continue
        for item in raw_list:
            if isinstance(item, str):
                item = {"case_name": item, "year": "", "citation": ""}
            if not isinstance(item, dict):
                continue
            name = re.sub(r'\s+', ' ', str(item.get("case_name") or "")).strip()
            if not name or len(name) < 4:
                continue
            norm = _normalise_name(name)
            if norm in seen_norm[cat]:
                continue
            seen_norm[cat].add(norm)
            result[cat].append({
                "case_name": name,
                "year":      str(item.get("year") or "").strip(),
                "citation":  str(item.get("citation") or "").strip(),
                "context":   f"[LLM-extracted] {name}",
            })

    summary = {k: len(v) for k, v in result.items()}
    total = sum(summary.values())
    logger.info("[TREATMENT_LLM] Extracted %d total treatment references (followed=%d distinguished=%d overruled=%d)",
                total, summary.get("followed", 0), summary.get("distinguished", 0), summary.get("overruled", 0))
    return {**result, "summary": summary}


def extract_subsequent_treatment_combined(
    judgment_text: str,
    title: str = "",
    max_chars: int = 50_000,
) -> Dict[str, Any]:
    """
    Run regex extraction first, then LLM extraction.
    Merge results: LLM entries that are not already in regex output are appended.
    Returns same format as extract_subsequent_treatment().
    """
    regex_result = extract_subsequent_treatment(judgment_text, max_chars=max_chars)
    regex_total  = sum(regex_result.get("summary", {}).values())

    if not _env_bool("CITATION_ENABLE_TREATMENT_LLM", False):
        logger.info("[TREATMENT_COMBINED] LLM extraction disabled; using regex-only result=%d", regex_total)
        return regex_result

    llm_result = extract_subsequent_treatment_llm(judgment_text, title=title, max_chars=max_chars)
    llm_total  = sum(llm_result.get("summary", {}).values())

    if llm_total == 0:
        return regex_result  # Nothing new from LLM

    # Merge: for each category, add LLM entries not already seen in regex output
    merged: Dict[str, List] = {}
    for cat in _CATEGORIES:
        regex_entries = regex_result.get(cat, [])
        llm_entries   = llm_result.get(cat, [])
        seen = {_normalise_name(e["case_name"]) for e in regex_entries}
        combined = list(regex_entries)
        for entry in llm_entries:
            if _normalise_name(entry["case_name"]) not in seen:
                seen.add(_normalise_name(entry["case_name"]))
                combined.append(entry)
        merged[cat] = combined

    summary = {k: len(v) for k, v in merged.items()}
    logger.info("[TREATMENT_COMBINED] regex=%d llm=%d merged_total=%d",
                regex_total, llm_total, sum(summary.values()))
    return {**merged, "summary": summary}


# ── Merge with Neo4j / DB data ────────────────────────────────────────────────

def merge_treatment(
    text_extracted: Dict[str, Any],
    db_treatment: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Merge text-extracted treatment with DB/Neo4j treatment.
    DB data wins for names that already exist there; text fills gaps.
    Returns the enriched treatment dict in the legacy format expected by
    report_builder (_build_citation_entry).
    """
    def _names(lst):
        return [e if isinstance(e, str) else e.get("case_name", "") for e in lst]

    def _merge_list(db_list: List, text_list: List[Dict]) -> List[str]:
        db_set = {_normalise_name(n) for n in _names(db_list)}
        merged = list(_names(db_list))
        for entry in text_list:
            if _normalise_name(entry["case_name"]) not in db_set:
                label = entry["case_name"]
                if entry.get("year"):
                    label += f" ({entry['year']})"
                merged.append(label)
        return merged

    followed     = _merge_list(db_treatment.get("followed", []),     text_extracted.get("followed", []))
    distinguished = _merge_list(db_treatment.get("distinguished", []), text_extracted.get("distinguished", []))
    overruled    = _merge_list(db_treatment.get("overruled", []),     text_extracted.get("overruled", []))
    # Extra categories not in legacy format — attach as extras
    relied_on    = [e["case_name"] + (f" ({e['year']})" if e.get("year") else "") for e in text_extracted.get("relied_on", [])]
    applied      = [e["case_name"] + (f" ({e['year']})" if e.get("year") else "") for e in text_extracted.get("applied", [])]
    cited        = [e["case_name"] + (f" ({e['year']})" if e.get("year") else "") for e in text_extracted.get("cited", [])]
    referred     = [e["case_name"] + (f" ({e['year']})" if e.get("year") else "") for e in text_extracted.get("referred", [])]
    approved     = [e["case_name"] + (f" ({e['year']})" if e.get("year") else "") for e in text_extracted.get("approved", [])]
    reversed_    = [e["case_name"] + (f" ({e['year']})" if e.get("year") else "") for e in text_extracted.get("reversed", [])]

    return {
        "followed":          followed,
        "distinguished":     distinguished,
        "overruled":         overruled,
        "reversed":          reversed_,
        "relied_on":         relied_on,
        "applied":           applied,
        "cited":             cited,
        "referred":          referred,
        "approved":          approved,
        # full detail entries for API / report
        "detail": {
            "followed":     text_extracted.get("followed", []),
            "distinguished":text_extracted.get("distinguished", []),
            "overruled":    text_extracted.get("overruled", []),
            "reversed":     text_extracted.get("reversed", []),
            "relied_on":    text_extracted.get("relied_on", []),
            "applied":      text_extracted.get("applied", []),
            "cited":        text_extracted.get("cited", []),
            "referred":     text_extracted.get("referred", []),
            "approved":     text_extracted.get("approved", []),
            "disapproved":  text_extracted.get("disapproved", []),
        },
        "summary": text_extracted.get("summary", {}),
    }


# ── Report section formatter ──────────────────────────────────────────────────

def format_treatment_section(treatment: Dict[str, Any]) -> str:
    """
    Render a plain-text "II. Subsequent Treatment" section for inclusion
    in reports / exports.
    """
    def _fmt_list(items: List, label: str) -> str:
        if not items:
            return f"{label}: 0"
        lines = [f"{label}:"]
        for i, item in enumerate(items, 1):
            name = item if isinstance(item, str) else f"{item.get('case_name','')} ({item.get('year','')})"
            lines.append(f"  {i}. {name}")
        return "\n".join(lines)

    parts = [
        "II. Subsequent Treatment",
        "─" * 44,
        _fmt_list(treatment.get("followed", []),     "Followed In Cases"),
        _fmt_list(treatment.get("distinguished", []),"Distinguished In Cases"),
        _fmt_list(treatment.get("overruled", []),    "Overruled Cases"),
        _fmt_list(treatment.get("reversed", []),     "Reversed Cases"),
        _fmt_list(treatment.get("relied_on", []),    "Relied On Cases"),
        _fmt_list(treatment.get("applied", []),      "Applied Cases"),
        _fmt_list(treatment.get("cited", []),        "Cited Cases"),
        _fmt_list(treatment.get("referred", []),     "Referred To Cases"),
    ]
    return "\n".join(parts)
