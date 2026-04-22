"""
Proposition-Based Citation Pipeline (ported from citation-service-v1).

Flow:
  1. extract_all_legal_points  — Claude extracts every legal issue from the case document
  2. generate_ik_queries       — Claude generates IK keyword queries per issue
  3. search_ik_parallel        — IK API searches in parallel (ThreadPoolExecutor)
  4. fetch_full_texts_parallel — IK full-doc fetch in parallel
  5. deep_validate_and_score   — Claude scores each result 1-10, extracts ratio/headnote/excerpt
  6. build_report_format       — frontend-compatible report

No Serper. No Elasticsearch. No Qdrant. IK API only.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from html.parser import HTMLParser
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_IK_SEARCH_WORKERS = 8
_IK_FETCH_WORKERS  = 6
_SCORE_WORKERS     = 6

_QUERY_STOPWORDS = {
    "the", "and", "with", "without", "from", "into", "that", "this", "there", "their",
    "have", "has", "had", "were", "was", "are", "for", "against", "under", "over",
    "between", "through", "after", "before", "being", "case", "matter", "petitioner",
    "respondent", "appellant", "appellants", "petitioners", "respondents", "another",
    "others", "anr", "ors", "ltd", "pvt", "private", "limited", "company",
}
_LEGAL_QUERY_TERMS = {
    "section", "sections", "article", "articles", "act", "code", "rule", "rules", "order",
    "ipc", "crpc", "cpc", "ni", "ndps", "gst", "vat", "arbitration", "insolvency",
    "bail", "anticipatory", "quash", "quashing", "fir", "writ", "mandamus", "certiorari",
    "injunction", "specific", "performance", "acquisition", "compensation", "tenancy",
    "eviction", "mutation", "limitation", "jurisdiction", "arrest", "detention", "cheating",
    "fraud", "breach", "contract", "negligence", "service", "termination", "dismissal",
    "seniority", "promotion", "tender", "procurement", "constitutional", "property",
    "liberty", "equality", "criminal", "civil", "tribunal", "high", "supreme",
}
_COURT_HINTS = (
    "supreme court",
    "high court",
    "district court",
    "sessions court",
    "tribunal",
)


def _stable_text(value: Any) -> str:
    return str(value or "").strip().lower()


# ─── Claude helper ────────────────────────────────────────────────────────────

def _repair_json(text: str) -> str:
    """Best-effort repair of common Claude JSON formatting errors."""
    # Remove trailing commas before } or ]
    text = re.sub(r",\s*([}\]])", r"\1", text)
    # Fix missing comma between } and { (objects in array)
    text = re.sub(r"}\s*\n\s*{", "},{", text)
    # Fix missing comma between } and " (field after object)
    text = re.sub(r"}\s*\n\s*\"", '},\n"', text)
    # Truncate at last complete object if JSON is cut off
    for closer in ("}\n]", "}]", "}\n  ]", "}  ]"):
        idx = text.rfind(closer)
        if idx != -1:
            candidate = text[: idx + len(closer)]
            # Try to close any open outer braces
            opens  = candidate.count("{") - candidate.count("}")
            closes = candidate.count("[") - candidate.count("]")
            candidate += "}" * max(opens, 0) + "]" * max(closes, 0)
            try:
                json.loads(candidate)
                return candidate
            except Exception:
                pass
    return text


def _claude_json(
    system: str,
    user: str,
    max_tokens: int = 1500,
    run_id: Optional[str] = None,
    user_id: Optional[str] = None,
    operation: str = "proposition",
) -> Optional[Any]:
    """Call Claude and return parsed JSON. Attempts JSON repair before giving up."""
    import os
    from claude_proxy import forward_to_claude

    model = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-6")
    body = {
        "model":       model,
        "max_tokens":  max_tokens,
        "temperature": 0.0,
        "system":      system,
        "messages":    [{"role": "user", "content": user}],
    }
    try:
        resp = forward_to_claude(body)
        blocks = resp.get("content") or []
        text = "\n".join(
            b.get("text", "") for b in blocks if isinstance(b, dict) and b.get("type") == "text"
        ).strip()
        # Track usage
        try:
            from utils.usage_tracker import record_claude
            usage = resp.get("usage") or {}
            record_claude(run_id, user_id or "anonymous", operation,
                          tokens_in=int(usage.get("input_tokens", 0)),
                          tokens_out=int(usage.get("output_tokens", 0)),
                          model=model)
        except Exception:
            pass
        # Strip markdown fences
        text = re.sub(r"^```(?:json)?\s*\n?", "", text, flags=re.M)
        text = re.sub(r"\n?```\s*$",           "", text, flags=re.M).strip()
        # Extract outermost JSON block
        m = re.search(r"(\{.*\}|\[.*\])", text, re.DOTALL)
        if m:
            text = m.group(0)
        # Try direct parse first
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass
        # Attempt repair
        repaired = _repair_json(text)
        try:
            return json.loads(repaired)
        except json.JSONDecodeError as exc:
            logger.warning("[PROP] JSON repair failed (%s): %s — raw[:200]: %s",
                           operation, exc, text[:200])
            return None
    except Exception as exc:
        logger.warning("[PROP] Claude call failed (%s): %s", operation, exc)
        return None


def _db_log(run_id, agent, stage, level, msg, meta=None):
    if not run_id:
        return
    try:
        from db.client import agent_log_insert
        agent_log_insert(run_id, None, agent, stage, level, msg, meta)
    except Exception:
        pass


# ─── HTML stripper ────────────────────────────────────────────────────────────

def _strip_html(html: str) -> str:
    if not html:
        return ""

    class _S(HTMLParser):
        def __init__(self):
            super().__init__()
            self.parts: List[str] = []
        def handle_data(self, data):
            self.parts.append(data)

    s = _S()
    s.feed(html)
    return re.sub(r"\s+", " ", " ".join(s.parts)).strip()


# ─── Fallback legal point builder ────────────────────────────────────────────

# Common legal keywords that indicate what kind of issue the query is about
_LEGAL_KEYWORD_MAP = [
    (r"\b(420|cheating)\b",                   "section 420 IPC cheating",          "IPC s420", ["Section 420 IPC"]),
    (r"\b(406|criminal breach|CBT)\b",         "section 406 IPC criminal breach trust", "IPC s406", ["Section 406 IPC"]),
    (r"\b(482|quash|FIR)\b",                   "section 482 CrPC quash FIR",        "CrPC s482", ["Section 482 CrPC"]),
    (r"\b(300A|property|acquisition)\b",       "article 300A property rights",      "Art 300A",  ["Article 300A"]),
    (r"\b(21|life|liberty|personal liberty)\b","article 21 right to life liberty",  "Art 21",    ["Article 21"]),
    (r"\b(14|equality|equal protection)\b",    "article 14 equality before law",    "Art 14",    ["Article 14"]),
    (r"\b(19|speech|expression|freedom)\b",    "article 19 freedom speech expression","Art 19",  ["Article 19"]),
    (r"\b(226|writ|mandamus|certiorari)\b",    "article 226 writ jurisdiction",     "Art 226",   ["Article 226"]),
    (r"\b(NDPS|narcotic|drug)\b",             "NDPS Act bail narcotic possession",  "NDPS Act",  ["NDPS Act"]),
    (r"\b(bail|anticipatory bail|ABail)\b",    "bail application criminal proceedings","bail",   ["CrPC s437", "CrPC s439"]),
    (r"\b(contract|breach|agreement)\b",       "contract breach specific performance","contract", ["Contract Act s73"]),
    (r"\b(service|termination|dismissal)\b",   "service law termination without hearing","service", ["Article 311"]),
    (r"\b(land|LARR|revenue|khasra)\b",        "land acquisition compensation LARR", "LARR Act", ["LARR Act 2013"]),
    (r"\b(tender|procurement|government contract)\b","government tender contract fairness","tender",["Article 14"]),
    (r"\b(election|voter|constituency)\b",     "election laws voter rights",        "RPA",       ["Representation People Act"]),
]

def _build_fallback_legal_points(query: str) -> Dict[str, Any]:
    """Build a minimal legal_points dict from the query text when Claude extraction fails."""
    q_lower = query.lower()
    issues = []

    for pattern, proposition, wrongdoing, acts in _LEGAL_KEYWORD_MAP:
        if re.search(pattern, query, re.I) and len(issues) < 3:
            title = acts[0].replace(" ", "_").replace(".", "")[:30]
            issues.append({
                "issue_title": acts[0],
                "proposition": proposition,
                "wrongdoing":  wrongdoing,
                "legal_right": acts[0],
                "acts_involved": acts,
                "remedy": "relief as prayed",
            })

    if not issues:
        # Generic fallback — strip party names, use meaningful words
        words = [w for w in re.split(r"\s+", query) if len(w) > 3
                 and w.lower() not in ("vs", "versus", "and", "the", "another",
                                        "others", "anr", "ors", "s/o", "w/o", "d/o")]
        key_terms = " ".join(words[:6])
        issues.append({
            "issue_title":  "Legal Issue",
            "proposition":  key_terms or query[:80],
            "wrongdoing":   key_terms or query[:40],
            "legal_right":  "Constitutional/statutory right",
            "acts_involved": [],
            "remedy":       "relief as prayed",
        })

    return {
        "parties":    {"petitioner": "Petitioner", "respondent": "Respondent"},
        "case_type":  "petition",
        "jurisdiction": "High Court",
        "issues":     issues,
    }


def _clean_query_text(text: str) -> str:
    text = re.sub(r"[^A-Za-z0-9\s./-]", " ", str(text or " "))
    return re.sub(r"\s+", " ", text).strip()


def _tokenize_query_terms(text: str) -> List[str]:
    raw_tokens = re.findall(r"[a-z0-9./-]+", _clean_query_text(text).lower())
    tokens: List[str] = []
    for token in raw_tokens:
        if not token or token in _QUERY_STOPWORDS:
            continue
        if len(token) < 3 and not token.isdigit():
            continue
        tokens.append(token)
    return tokens


def _extract_issue_keywords(issue: Dict[str, Any]) -> List[str]:
    parts: List[str] = []
    for key in ("issue_title", "proposition", "wrongdoing", "legal_right", "remedy"):
        value = issue.get(key)
        if value:
            parts.append(str(value))
    for act in issue.get("acts_involved", [])[:4]:
        if act:
            parts.append(str(act))
    tokens = _tokenize_query_terms(" ".join(parts))
    preferred = [t for t in tokens if t in _LEGAL_QUERY_TERMS or re.fullmatch(r"\d+[a-z]?", t)]
    fallback = [t for t in tokens if t not in preferred]
    return list(dict.fromkeys(preferred + fallback))


def _extract_court_hint(legal_points: Dict[str, Any], case_context: str = "") -> str:
    candidates = [
        str(legal_points.get("jurisdiction") or "").strip(),
        str(legal_points.get("case_type") or "").strip(),
        str(case_context[:500] if case_context else "").strip(),
    ]
    joined = " ".join(candidates).lower()
    for hint in _COURT_HINTS:
        if hint in joined:
            return hint
    return ""


def _normalize_ik_query(query: str, legal_points: Dict[str, Any], case_context: str = "") -> str:
    query = (query or "").strip()
    # Preserve Boolean queries (AND/OR with quoted phrases) as-is — only clean whitespace
    if re.search(r'\bAND\b|\bOR\b', query) and re.search(r'"[^"]{3,}"', query):
        return re.sub(r'\s+', ' ', query)
    # Plain keyword string: apply token-based normalization
    tokens = _tokenize_query_terms(query)
    preferred = [t for t in tokens if t in _LEGAL_QUERY_TERMS or re.fullmatch(r"\d+[a-z]?", t)]
    other = [t for t in tokens if t not in preferred]
    final_tokens = preferred[:5] + other[:3]
    court_hint = _extract_court_hint(legal_points, case_context)
    if court_hint:
        for hint_token in court_hint.split():
            if hint_token not in final_tokens:
                final_tokens.append(hint_token)
    return " ".join(list(dict.fromkeys(final_tokens))[:8]).strip()


def _build_structured_fallback_queries(
    issues: List[Dict[str, Any]],
    legal_points: Dict[str, Any],
    case_context: str = "",
) -> List[str]:
    court_hint = _extract_court_hint(legal_points, case_context)
    queries: List[str] = []
    for iss in issues[:6]:
        keywords = _extract_issue_keywords(iss)
        if not keywords:
            continue
        core = keywords[:6]
        if court_hint:
            for token in court_hint.split():
                if token not in core:
                    core.append(token)
        queries.append(" ".join(core[:8]).strip())
        statute_tokens = [
            t for t in keywords
            if t in _LEGAL_QUERY_TERMS or re.fullmatch(r"\d+[a-z]?", t)
        ]
        if statute_tokens:
            queries.append(" ".join(list(dict.fromkeys(statute_tokens))[:6]).strip())
    return [q for q in list(dict.fromkeys(queries)) if q]


def _compute_keyword_overlap_score(
    query: str,
    result: Dict[str, Any],
    legal_points: Optional[Dict[str, Any]] = None,
) -> int:
    issue_terms = _tokenize_query_terms(query)
    if legal_points:
        for issue in legal_points.get("issues", [])[:4]:
            issue_terms.extend(_extract_issue_keywords(issue)[:6])
    issue_terms = list(dict.fromkeys(issue_terms))
    if not issue_terms:
        return 0

    text_parts = [
        result.get("title", ""),
        result.get("snippet", ""),
        result.get("court", ""),
        result.get("date", ""),
        result.get("headnotes", ""),
        str(result.get("full_text", ""))[:1500],
    ]
    haystack = _clean_query_text(" ".join(str(p or "") for p in text_parts)).lower()
    if not haystack:
        return 0

    score = 0
    for token in issue_terms:
        if token and token in haystack:
            score += 3 if token in _LEGAL_QUERY_TERMS or re.fullmatch(r"\d+[a-z]?", token) else 1

    court = str(result.get("court") or "").lower()
    if "supreme court" in court:
        score += 2
    elif "high court" in court:
        score += 1
    return score


# ─── Step 1: Extract all legal points ─────────────────────────────────────────

def extract_all_legal_points(
    query: str,
    case_context: str,
    run_id: str,
    user_id: str = "anonymous",
) -> Dict[str, Any]:
    """Extract every distinct legal issue from the case document using Claude."""
    _db_log(run_id, "PropositionExtractor", "extract", "INFO",
            "Extracting all legal points from case document")

    system = (
        "You are a senior Indian advocate. Extract legal issues from the case document as compact JSON. "
        "Keep each field SHORT — issue_title ≤ 6 words, proposition ≤ 25 words, wrongdoing ≤ 15 words. "
        "Maximum 4 issues. Output ONLY valid JSON, no explanations."
    )
    user = f"""Case document:
{case_context[:5000] if case_context else 'Not provided.'}

User query: {query}

Return ONLY this JSON with up to 4 issues:
{{
  "parties": {{"petitioner": "Name", "respondent": "Name"}},
  "case_type": "writ petition",
  "jurisdiction": "Bombay High Court",
  "issues": [
    {{
      "issue_title": "Article 300A Violation",
      "proposition": "State took land without acquisition violating Article 300A",
      "wrongdoing": "possession without compensation",
      "legal_right": "Article 300A",
      "acts_involved": ["Article 300A", "LARR Act 2013 s11"],
      "remedy": "compensation"
    }}
  ]
}}"""

    result = _claude_json(system, user, max_tokens=1200, run_id=run_id,
                          user_id=user_id, operation="extract_legal_points")
    if not isinstance(result, dict) or not result.get("issues"):
        logger.warning("[PROP] Legal point extraction fallback — building from query")
        # Generate basic fallback IK queries from query words directly
        result = _build_fallback_legal_points(query)

    issues = result.get("issues", [])
    _db_log(run_id, "PropositionExtractor", "extract", "INFO",
            f"Extracted {len(issues)} legal point(s)",
            {"issues": [i.get("issue_title") for i in issues]})
    for i, iss in enumerate(issues):
        logger.info("[PROP] Issue [%d] %s — %s",
                    i + 1, iss.get("issue_title", ""), iss.get("proposition", "")[:100])

    result["primary_proposition"] = issues[0] if issues else {}
    return result


def _fallback_research_plan(
    query: str,
    case_context: str,
    legal_points: Dict[str, Any],
) -> Dict[str, Any]:
    issues = legal_points.get("issues", []) or [legal_points.get("primary_proposition", {})]
    statutes = list({
        str(act).strip()
        for issue in issues
        for act in (issue.get("acts_involved") or [])
        if str(act).strip()
    })[:8]
    doctrines = list({
        str(issue.get("legal_right") or issue.get("remedy") or issue.get("issue_title") or "").strip()
        for issue in issues
        if str(issue.get("legal_right") or issue.get("remedy") or issue.get("issue_title") or "").strip()
    })[:6]
    fact_patterns: List[str] = []
    seen_patterns: set[str] = set()
    for issue in issues[:4]:
        for value in (issue.get("proposition"), issue.get("wrongdoing")):
            text = _clean_query_text(value)[:80]
            key = text.lower()
            if text and key not in seen_patterns:
                seen_patterns.add(key)
                fact_patterns.append(text)
    return {
        "core_issue": str((issues[0] or {}).get("proposition") or query[:120]).strip(),
        "statutes": statutes,
        "doctrines": doctrines,
        "fact_patterns": fact_patterns[:6],
        "court_hint": _extract_court_hint(legal_points, case_context) or "high court",
        "validation_focus": [
            "Keep judgments only if they match at least one controlling statute or doctrine and one fact pattern.",
            "Reject judgments that match only court level, generic writ language, or unrelated banking disputes.",
        ],
        "reject_rules": [],
    }


def build_research_plan(
    query: str,
    case_context: str,
    legal_points: Dict[str, Any],
    run_id: str,
    user_id: str = "anonymous",
) -> Dict[str, Any]:
    """Create a compact research plan before keyword generation and grounding."""
    issues = legal_points.get("issues", []) or [legal_points.get("primary_proposition", {})]
    _db_log(run_id, "ResearchPlanner", "plan", "INFO",
            f"Building research plan for {len(issues)} legal issue(s)")

    system = (
        "You are a senior Indian legal research planner. "
        "Read the case context and extracted issues, then create a compact search-and-validation plan. "
        "Prefer statutes, article numbers, remedies, and distinctive facts. "
        "Avoid party names unless the matter is an explicit known-case search. "
        "Output ONLY valid JSON."
    )
    issues_text = "\n".join(
        f"- {iss.get('issue_title', '')}: {iss.get('proposition', '')} "
        f"[Acts: {', '.join(iss.get('acts_involved', [])[:4])}]"
        for iss in issues[:6]
    )
    user = f"""User query:
{query[:1200]}

Case context:
{case_context[:4500] if case_context else "Not provided."}

Extracted issues:
{issues_text}

Return ONLY this JSON:
{{
  "core_issue": "one-sentence legal controversy",
  "statutes": ["Article 226", "SARFAESI Act section 13"],
  "doctrines": ["writ maintainability", "loan restructuring guidelines"],
  "fact_patterns": ["co-operative bank", "renewal request pending", "recovery proceedings"],
  "court_hint": "Bombay High Court",
  "validation_focus": [
    "what must be present in a relevant judgment",
    "what should be rejected as irrelevant"
  ],
  "reject_rules": [
    "Reject if holding is on NI Act s.138 but our issue is SARFAESI s.13(2)",
    "Reject if parties/industry/transaction-type do not match the case at all",
    "Reject if judgment only mentions the statute in passing without a holding on it"
  ]
}}

`reject_rules` must be 3–6 short declarative sentences beginning with "Reject if ...".
They should encode concrete disqualifiers specific to THIS case (statute vs different statute,
correct fact pattern vs unrelated one), not generic advice."""

    result = _claude_json(
        system,
        user,
        max_tokens=900,
        run_id=run_id,
        user_id=user_id,
        operation="build_research_plan",
    )
    fallback = _fallback_research_plan(query, case_context, legal_points)
    if not isinstance(result, dict):
        result = fallback
    else:
        result = {
            "core_issue": str(result.get("core_issue") or fallback["core_issue"]).strip(),
            "statutes": list(result.get("statutes") or fallback["statutes"])[:8],
            "doctrines": list(result.get("doctrines") or fallback["doctrines"])[:8],
            "fact_patterns": list(result.get("fact_patterns") or fallback["fact_patterns"])[:8],
            "court_hint": str(result.get("court_hint") or fallback["court_hint"]).strip(),
            "validation_focus": list(result.get("validation_focus") or fallback["validation_focus"])[:4],
            "reject_rules": list(result.get("reject_rules") or fallback.get("reject_rules") or [])[:6],
        }

    _db_log(run_id, "ResearchPlanner", "plan", "INFO",
            f"Research plan ready with {len(result.get('statutes', []))} statutes, "
            f"{len(result.get('doctrines', []))} doctrines, "
            f"{len(result.get('fact_patterns', []))} fact patterns, "
            f"{len(result.get('reject_rules', []))} reject rules",
            {"research_plan": result})
    logger.info("[PROP] Plan core issue: %s", str(result.get("core_issue") or "")[:140])
    return result


def _plan_terms(research_plan: Optional[Dict[str, Any]]) -> List[str]:
    if not isinstance(research_plan, dict):
        return []
    parts: List[str] = []
    for key in ("core_issue", "court_hint"):
        value = research_plan.get(key)
        if value:
            parts.append(str(value))
    for key in ("statutes", "doctrines", "fact_patterns", "validation_focus", "reject_rules"):
        values = research_plan.get(key) or []
        if isinstance(values, list):
            parts.extend(str(v) for v in values if v)
    return _tokenize_query_terms(" ".join(parts))


def _score_query_against_plan(query: str, research_plan: Optional[Dict[str, Any]]) -> int:
    if not query:
        return 0
    query_tokens = set(_tokenize_query_terms(query))
    if not query_tokens:
        return 0
    score = 0
    for token in _plan_terms(research_plan):
        if token in query_tokens:
            score += 3 if (token in _LEGAL_QUERY_TERMS or re.fullmatch(r"\d+[a-z]?", token)) else 1
    joined = " ".join(sorted(query_tokens))
    if re.search(r"\b(section|article|act)\b", joined):
        score += 3
    if re.search(r"\b(writ|maintainability|recovery|restructuring|sarfaesi|guidelines|cooperative|co-operative)\b", joined):
        score += 2
    if len(query_tokens) <= 3:
        score -= 2
    return score


# ─── Step 2: Generate IK keyword queries per issue ────────────────────────────

def generate_ik_queries(
    legal_points: Dict[str, Any],
    run_id: str,
    user_id: str = "anonymous",
    case_context: str = "",
    research_plan: Optional[Dict[str, Any]] = None,
) -> List[str]:
    """Generate precise IK keyword queries grounded in extracted legal issues and case context."""
    issues = legal_points.get("issues", [])
    if not issues:
        issues = [legal_points.get("primary_proposition", {})]

    _db_log(
        run_id,
        "QueryGenerator",
        "generate",
        "INFO",
        f"Generating IK queries for {len(issues)} legal issue(s)",
    )

    court_hint = _extract_court_hint(legal_points, case_context)
    system = (
        "You are an Indian legal research specialist. "
        "Generate Boolean search queries for Indian Kanoon using exact phrase matching and AND/OR operators. "
        "Each query must: (1) wrap every multi-word legal phrase in double quotes, "
        "(2) connect phrases with AND (both required) or OR (synonyms), "
        "(3) always include the controlling statute or article number as a quoted phrase, "
        "(4) include the legal doctrine or remedy as a quoted phrase, "
        "(5) include a distinctive factual pattern where possible. "
        "Prioritise terminology used in Indian Supreme Court and High Court headnotes. "
        "Never use party names unless the user explicitly asks for a specific known case."
    )

    issues_text = "\n".join(
        f"- {iss.get('issue_title', '')}: {iss.get('proposition', '')} "
        f"[Acts: {', '.join(iss.get('acts_involved', [])[:3])}]"
        for iss in issues[:6]
    )
    case_ctx_block = (
        f"\nCase document (first 3000 chars):\n{case_context[:3000]}\n"
        if case_context
        else ""
    )
    user = f"""{case_ctx_block}
Legal issues extracted from the case:
{issues_text}

Research plan:
Core issue: {str((research_plan or {}).get('core_issue') or '')[:220]}
Statutes: {list((research_plan or {}).get('statutes') or [])[:6]}
Doctrines: {list((research_plan or {}).get('doctrines') or [])[:6]}
Fact patterns: {list((research_plan or {}).get('fact_patterns') or [])[:6]}

Generate 5–12 Boolean IK search queries covering all the legal issues above.
RULES:
- Wrap every multi-word legal phrase in double quotes: "section 138 NI Act"
- Use AND between required components, OR between synonyms/alternatives
- Prefer ratio decidendi language from Indian Supreme Court and High Court judgments
- Court hint (append if useful): {court_hint or "omit if unknown"}
- Never use plain unquoted keyword strings

STRICT OUTPUT FORMAT — every query must follow one of these patterns:
  "statute" AND "doctrine"
  "statute" AND ("doctrine1" OR "doctrine2")
  "statute" AND "doctrine" AND "factual pattern"
  "doctrine phrase" AND "factual pattern"

Examples (Indian Kanoon Boolean syntax):
  "section 138 NI Act" AND "dishonoured cheque" AND conviction
  "section 420 IPC" AND ("cheating" OR "criminal breach of trust") AND "civil dispute criminal cloak"
  "section 482 CrPC" AND ("quash FIR" OR "abuse of process") AND "civil dispute"
  "Article 300A" AND "deprivation of property" AND "without compensation"
  "LARR Act" AND ("just compensation" OR "solatium") AND acquisition
  "legally enforceable debt" AND "section 138 NI Act"
  "anticipatory bail" AND "section 438 CrPC" AND ("apprehension of arrest" OR "custodial interrogation")

Return ONLY this JSON (queries must include quotes and AND/OR):
{{"ik": ["query1", "query2", "query3"]}}"""

    r = _claude_json(
        system,
        user,
        max_tokens=800,
        run_id=run_id,
        user_id=user_id,
        operation="generate_queries",
    )
    all_ik: List[str] = []
    seen: set = set()
    iq = (r.get("ik", []) if isinstance(r, dict) else [])
    if not iq:
        iq = _build_structured_fallback_queries(issues, legal_points, case_context=case_context)

    ranked_candidates: List[tuple[int, str]] = []
    for q in iq[:12]:
        q_clean = q.strip()
        normalized = _normalize_ik_query(q_clean, legal_points, case_context=case_context)
        if normalized and len(normalized) >= 5 and normalized not in seen:
            seen.add(normalized)
            ranked_candidates.append((_score_query_against_plan(normalized, research_plan), normalized))

    if not ranked_candidates:
        for q in _build_structured_fallback_queries(issues, legal_points, case_context=case_context):
            normalized = _normalize_ik_query(q, legal_points, case_context=case_context)
            if normalized and normalized not in seen:
                seen.add(normalized)
                ranked_candidates.append((_score_query_against_plan(normalized, research_plan), normalized))

    ranked_candidates.sort(key=lambda item: (-item[0], item[1]))
    for score, normalized in ranked_candidates:
        if score < 2 and len(ranked_candidates) > 6:
            continue
        all_ik.append(normalized)
        if len(all_ik) >= 10:
            break

    ik_queries = all_ik[:12]
    _db_log(
        run_id,
        "QueryGenerator",
        "generate",
        "INFO",
        f"Generated {len(ik_queries)} IK queries",
        {"queries": ik_queries},
    )
    for i, q in enumerate(ik_queries):
        logger.info("[PROP] IK query [%d]: %s", i + 1, q)
    return ik_queries


# ─── Step 3: IK parallel search ───────────────────────────────────────────────

def _ik_search_one(query: str) -> List[Dict[str, Any]]:
    """Single IK API search. Returns list of result dicts."""
    from services.indian_kanoon import ik_search
    try:
        resp = ik_search(query, pagenum=0, doctypes="judgments")
        docs = (resp or {}).get("docs") or []
        results = []
        for d in docs[:8]:
            tid = str(d.get("tid", "")).strip()
            if not tid:
                continue
            results.append({
                "tid":     tid,
                "title":   d.get("title", ""),
                "snippet": d.get("headline", ""),
                "court":   d.get("docsource", ""),
                "date":    d.get("publishdate", ""),
                "url":     f"https://indiankanoon.org/doc/{tid}/",
                "source":  "indian_kanoon",
                "_query":  query,
            })
        logger.info("[PROP] IK search %r → %d result(s)", query[:60], len(results))
        return results
    except Exception as exc:
        logger.warning("[PROP] IK search failed %r: %s", query[:60], exc)
        return []


def search_ik_parallel(
    ik_queries: List[str],
    run_id: str,
) -> List[Dict[str, Any]]:
    """Run all IK searches in parallel. Returns deduplicated results (IK-quality first)."""
    if not ik_queries:
        return []

    _db_log(run_id, "SearchAgent", "search", "INFO",
            f"🔍 Running {len(ik_queries)} IK searches in parallel",
            {"query_count": len(ik_queries)})

    all_results: List[Dict] = []
    with ThreadPoolExecutor(max_workers=_IK_SEARCH_WORKERS) as pool:
        fut_map = {pool.submit(_ik_search_one, q): q for q in ik_queries}
        for fut in as_completed(fut_map):
            try:
                all_results.extend(fut.result(timeout=25))
            except Exception as exc:
                logger.warning("[PROP] IK search future error: %s", exc)

    # Deduplicate by tid
    seen_tids: set = set()
    deduped: List[Dict] = []
    for r in all_results:
        tid = r.get("tid", "")
        if tid and tid not in seen_tids:
            seen_tids.add(tid)
            deduped.append(r)

    _db_log(run_id, "SearchAgent", "search", "INFO",
            f"✅ IK search: {len(deduped)} unique results from {len(ik_queries)} queries",
            {"result_count": len(deduped)})
    logger.info("[PROP] IK search done — %d unique results", len(deduped))
    return deduped


def _google_validate_candidate(
    item: Dict[str, Any],
    legal_points: Dict[str, Any],
    research_plan: Optional[Dict[str, Any]],
    run_id: Optional[str],
    user_id: str,
) -> Optional[Dict[str, Any]]:
    """
    Use Gemini grounding as a second-pass validator for a candidate judgment.
    It considers the case issues plus the candidate source URL/title and returns
    the item only when the grounded validator says it is relevant enough.
    """
    import os

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        return None

    source_url = str(item.get("sourceUrl") or item.get("url") or "").strip()
    if not source_url:
        return None

    try:
        from google import genai
        from google.genai import types
    except Exception:
        return None

    issues = legal_points.get("issues", [legal_points.get("primary_proposition", {})])
    issue_text = " | ".join(
        str(iss.get("proposition") or iss.get("issue_title") or "").strip()
        for iss in issues[:4]
        if (iss.get("proposition") or iss.get("issue_title"))
    )
    acts = list({a for iss in issues for a in (iss.get("acts_involved") or [])})[:6]
    title = str(item.get("caseName") or item.get("title") or "").strip()
    excerpt = str(item.get("excerptText") or item.get("snippet") or item.get("headnote") or "").strip()[:500]
    model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
    plan_core_issue = str((research_plan or {}).get("core_issue") or "").strip()
    plan_statutes = list((research_plan or {}).get("statutes") or [])[:6]
    plan_doctrines = list((research_plan or {}).get("doctrines") or [])[:6]
    plan_fact_patterns = list((research_plan or {}).get("fact_patterns") or [])[:6]
    plan_validation_focus = list((research_plan or {}).get("validation_focus") or [])[:4]
    plan_reject_rules = list((research_plan or {}).get("reject_rules") or [])[:6]

    prompt = f"""You are validating whether a judgment is actually relevant to a legal research query.
Use Google grounding to verify the source URL and surrounding web evidence if needed.

Case issues:
{issue_text[:700]}

Acts/sections:
{acts}

Research plan:
Core issue: {plan_core_issue[:240]}
Statutes: {plan_statutes}
Doctrines: {plan_doctrines}
Fact patterns: {plan_fact_patterns}
Validation focus: {plan_validation_focus}
Reject rules (hard): {plan_reject_rules}

Candidate judgment:
Title: {title}
Source URL: {source_url}
Excerpt: {excerpt}

Return ONLY strict JSON:
{{
  "relevant": true,
  "confidence": 0.0,
  "reason": "short reason"
}}

Rules:
- Mark relevant=true only if the judgment appears to address at least one of the case issues in a meaningful legal way.
- It should also align with the research plan on statute/doctrine and on factual pattern, not just on court level.
- If ANY reject rule above applies to this candidate, mark relevant=false.
- If the URL/title looks mismatched, irrelevant, or only loosely related, mark relevant=false.
- Confidence must be between 0 and 1.
"""

    grounding_tool = types.Tool(google_search=types.GoogleSearch())
    config = types.GenerateContentConfig(
        tools=[grounding_tool],
        max_output_tokens=512,
        temperature=0.0,
    )
    client = genai.Client(api_key=api_key)

    try:
        response = None
        for attempt in range(3):
            try:
                response = client.models.generate_content(model=model, contents=prompt, config=config)
                break
            except Exception as exc:
                msg = str(exc)
                if ("429" in msg or "RESOURCE_EXHAUSTED" in msg.upper()) and attempt < 2:
                    time.sleep(5 * (attempt + 1))
                    continue
                raise
        if response is None:
            return None

        resp_text = (getattr(response, "text", None) or "").strip()
        # Strip markdown fences
        cleaned = re.sub(r"^```(?:json)?\s*\n?", "", resp_text, flags=re.M)
        cleaned = re.sub(r"\n?```\s*$", "", cleaned, flags=re.M).strip()
        # Extract the outermost JSON object
        m = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if m:
            cleaned = m.group(0)
        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError:
            parsed = json.loads(_repair_json(cleaned))
        if not isinstance(parsed, dict):
            return None

        relevant = bool(parsed.get("relevant"))
        confidence = float(parsed.get("confidence") or 0.0)
        reason = str(parsed.get("reason") or "").strip()[:240]
        validated = {
            **item,
            "groundingValidated": relevant,
            "groundingConfidence": confidence,
            "groundingReason": reason,
        }
        if relevant and confidence >= 0.55:
            return validated
        return None
    except Exception as exc:
        logger.warning("[PROP] Google grounding validation failed for %r: %s", source_url[:100], exc)
        return None


def _grounding_available() -> bool:
    import os
    return bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))


def _strict_scored_fallback(scored: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Keep only very strong scored matches if grounding is too strict or unavailable."""
    strong: List[Dict[str, Any]] = []
    for item in scored:
        relevance = float(item.get("relevanceScore") or 0.0)
        legal_match = bool(item.get("legal_match"))
        factual_match = bool(item.get("factual_match"))
        keyword_score = int(item.get("_keyword_score") or 0)
        source_url = str(item.get("sourceUrl") or item.get("url") or "").strip()
        if not source_url:
            continue
        if relevance >= 0.9 and (legal_match or factual_match):
            strong.append(item)
            continue
        if relevance >= 0.8 and legal_match and (factual_match or keyword_score >= 6):
            strong.append(item)
    return strong


def google_validate_candidates(
    items: List[Dict[str, Any]],
    legal_points: Dict[str, Any],
    research_plan: Optional[Dict[str, Any]],
    run_id: str,
    user_id: str = "anonymous",
    max_validate: int = 12,
) -> List[Dict[str, Any]]:
    """
    Sequentially validate the top candidates with Gemini grounding to reduce
    false-positive IK judgments before they reach the user.
    """
    if not items:
        return []

    top = items[:max_validate]
    kept: List[Dict[str, Any]] = []
    for idx, item in enumerate(top):
        if idx > 0:
            time.sleep(2)
        try:
            validated = _google_validate_candidate(item, legal_points, research_plan, run_id, user_id)
            if validated:
                kept.append(validated)
        except Exception as exc:
            logger.warning("[PROP] Grounding validation error for %r: %s", item.get("sourceUrl") or item.get("url"), exc)

    logger.info("[PROP] Grounding validation kept %d/%d top candidates", len(kept[:max_validate]), len(top))
    return kept


def search_ik_parallel(
    ik_queries: List[str],
    run_id: str,
    legal_points: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Run all IK searches in parallel and rank candidates by legal-keyword overlap."""
    if not ik_queries:
        return []

    _db_log(
        run_id,
        "SearchAgent",
        "search",
        "INFO",
        f"Running {len(ik_queries)} IK searches in parallel",
        {"query_count": len(ik_queries)},
    )

    all_results: List[Dict] = []
    with ThreadPoolExecutor(max_workers=_IK_SEARCH_WORKERS) as pool:
        fut_map = {pool.submit(_ik_search_one, q): q for q in ik_queries}
        for fut in as_completed(fut_map):
            try:
                all_results.extend(fut.result(timeout=25))
            except Exception as exc:
                logger.warning("[PROP] IK search future error: %s", exc)

    seen_tids: set = set()
    deduped: List[Dict] = []
    for r in all_results:
        tid = r.get("tid", "")
        if tid and tid not in seen_tids:
            seen_tids.add(tid)
            r["_keyword_score"] = _compute_keyword_overlap_score(
                str(r.get("_query") or ""),
                r,
                legal_points=legal_points,
            )
            deduped.append(r)

    deduped.sort(
        key=lambda r: (
            -int(r.get("_keyword_score") or 0),
            -(
                2 if "supreme" in str(r.get("court") or "").lower() else
                1 if "high" in str(r.get("court") or "").lower() else 0
            ),
            _stable_text(r.get("title")),
            _stable_text(r.get("tid") or r.get("canonical_id") or r.get("url")),
        ),
    )

    _db_log(
        run_id,
        "SearchAgent",
        "search",
        "INFO",
        f"IK search: {len(deduped)} unique results from {len(ik_queries)} queries",
        {"result_count": len(deduped)},
    )
    logger.info("[PROP] IK search done - %d unique results", len(deduped))
    return deduped


# ─── Step 3b: Local ES keyword search ────────────────────────────────────────

_ES_APPROVED_STATUSES = ["APPROVED", "VERIFIED", "VERIFIED_WARN", "GREEN"]
_ES_LOW_HIERARCHY_PHRASES = [
    "district court", "district judge", "sessions court",
    "magistrate", "tribunal", "consumer forum", "consumer commission",
]
_ADMIN_SOURCE_TYPES = [
    "admin", "admin_upload", "admin-upload", "admin uploaded",
    "admin-uploaded", "adminupload", "manual_upload", "manual-upload",
    "judgment_upload", "judgement_upload",
]


def _normalize_es_hit(hit: Dict[str, Any], query: str) -> Optional[Dict[str, Any]]:
    """Convert a raw ES hit into the standard proposition-pipeline result dict."""
    src = hit.get("_source") or {}
    cid = str(src.get("canonical_id") or hit.get("_id") or "").strip()
    if not cid:
        return None
    src_type = str(src.get("source_type") or "").strip().lower()
    is_admin = src_type in _ADMIN_SOURCE_TYPES or src_type.startswith("admin")
    court = str(src.get("court_code") or src.get("court_name") or "").strip()

    # Extract IK tid from canonical_id
    tid = cid[3:] if cid.startswith("ik:") else ""

    full_text = str(src.get("full_text") or "")
    ratio = str(src.get("holding_text") or src.get("summary_text") or "")

    return {
        "tid":          tid,
        "canonical_id": cid,
        "title":        str(src.get("case_name") or src.get("title") or ""),
        "court":        court,
        "date":         str(src.get("judgment_date") or src.get("date") or ""),
        "snippet":      ratio[:300],
        "full_text":    full_text,
        "headnotes":    ratio[:1000],
        "bench":        str(src.get("bench") or src.get("coram") or ""),
        "ik_citation":  str(src.get("primary_citation") or ""),
        "url":          (str(src.get("source_url") or src.get("official_source_url") or "")
                         or (f"https://indiankanoon.org/doc/{tid}/" if tid else "")),
        "source":       "admin_upload" if is_admin else "local_db",
        "_es_score":    float(hit.get("_score") or 0.0),
        "ikCiteList":   [],
        "ikCitedByList": [],
        "_query":       query,
    }


def _pg_row_to_local_result(r: Dict[str, Any], query: str, es_score: float = 0.0) -> Optional[Dict[str, Any]]:
    """Normalise a PG judgment row to the proposition pipeline result format."""
    cid = str(r.get("canonical_id") or r.get("id") or "").strip()
    if not cid:
        return None
    src_type = str(r.get("source_type") or "").strip().lower()
    is_admin = src_type in _ADMIN_SOURCE_TYPES or src_type.startswith("admin")
    tid = cid[3:] if cid.startswith("ik:") else ""
    full_text = str(
        r.get("full_text") or r.get("raw_content") or
        r.get("merged_text") or r.get("text_content") or ""
    )
    ratio = str(r.get("ratio") or r.get("holding_text") or r.get("summary_text") or "")
    court = str(r.get("court") or r.get("court_code") or r.get("court_name") or "")
    url = (
        str(r.get("source_url") or r.get("official_source_url") or r.get("external_url") or "")
        or (f"https://indiankanoon.org/doc/{tid}/" if tid else "")
    )
    return {
        "tid":           tid,
        "canonical_id":  cid,
        "title":         str(r.get("title") or r.get("case_name") or ""),
        "court":         court,
        "date":          str(r.get("judgment_date") or r.get("date") or ""),
        "snippet":       ratio[:300] or full_text[:300],
        "full_text":     full_text,
        "headnotes":     str(r.get("headnote") or r.get("headnotes") or ratio[:1000]),
        "bench":         str(r.get("bench") or r.get("coram") or ""),
        "ik_citation":   str(r.get("primary_citation") or r.get("ik_citation") or ""),
        "url":           url,
        "source":        "admin_upload" if is_admin else "local_db",
        "_es_score":     es_score,
        "ikCiteList":    [],
        "ikCitedByList": [],
        "_query":        query,
    }


def _enrich_full_text(item: Dict[str, Any]) -> Dict[str, Any]:
    """
    Fetch full_text for a local result that came back from ES with empty text.
    Priority: ik_document_assets (for IK docs) → judgements_fetch_by_canonical_ids.
    """
    cid = item.get("canonical_id", "")
    tid = item.get("tid", "") or (cid[3:] if cid.startswith("ik:") else "")

    # IK-sourced docs: ik_document_assets has the raw full text
    if tid:
        try:
            from db.client import ik_asset_get
            asset = ik_asset_get(tid)
            if asset:
                raw = asset.get("raw_api_response") or {}
                if isinstance(raw, str):
                    import json as _j
                    try:
                        raw = _j.loads(raw)
                    except Exception:
                        raw = {}
                ft = (raw.get("raw_content") or raw.get("full_text") or
                      asset.get("raw_content") or asset.get("full_text") or "")
                if not ft:
                    doc_html = raw.get("doc") or asset.get("doc") or ""
                    ft = _strip_html(doc_html) if doc_html else ""
                if ft:
                    return {**item, "full_text": ft[:15000],
                            "title":  raw.get("title") or item.get("title", ""),
                            "court":  raw.get("docsource") or item.get("court", ""),
                            "date":   raw.get("publishdate") or item.get("date", ""),
                            "ik_citation": raw.get("citation") or item.get("ik_citation", "")}
        except Exception as exc:
            logger.debug("[PROP] ik_asset_get fallback failed tid=%s: %s", tid, exc)

    # Admin / non-IK: try judgements_fetch_by_canonical_ids for merged_text
    if cid:
        try:
            from db.client import judgements_fetch_by_canonical_ids
            rows = judgements_fetch_by_canonical_ids(
                [cid], approved_only=False, exclude_low_hierarchy=False
            )
            if rows:
                r = rows[0]
                cd = r.get("citation_data") or {}
                ft = (r.get("full_text") or r.get("raw_content") or
                      cd.get("full_text") or r.get("merged_text") or "")
                if ft:
                    return {**item, "full_text": str(ft)[:15000]}
        except Exception as exc:
            logger.debug("[PROP] judgements_fetch fallback failed cid=%s: %s", cid, exc)

    return item


def _search_local_one(query: str) -> List[Dict[str, Any]]:
    """
    ES multi_match keyword search. Returns results with full_text from ES _source.
    Falls back to judgement_search_local (PG) when ES is unavailable.
    """
    query = (query or "").strip()
    if not query:
        return []

    # ── Elasticsearch: keyword search + full_text in _source ─────────────────
    try:
        from db.connections import get_es_client, elasticsearch_init_failed
        es = get_es_client()
        if es and not elasticsearch_init_failed():
            resp = es.search(
                index="judgments",
                size=8,
                query={
                    "bool": {
                        "must": [{
                            "multi_match": {
                                "query":     query,
                                "fields":    [
                                    "case_name^4",
                                    "primary_citation^3",
                                    "summary_text^2",
                                    "holding_text^2",
                                    "facts_text",
                                    "full_text",
                                ],
                                "type":      "best_fields",
                                "fuzziness": "AUTO",
                                "operator":  "or",
                            }
                        }],
                        "filter": [{
                            "bool": {
                                "should": [
                                    {"terms": {"verification_status.keyword": _ES_APPROVED_STATUSES}},
                                    {"terms": {"source_type.keyword": _ADMIN_SOURCE_TYPES}},
                                ],
                                "minimum_should_match": 1,
                            }
                        }],
                        "must_not": [
                            {"match_phrase": {"court_code": ph}}
                            for ph in _ES_LOW_HIERARCHY_PHRASES
                        ],
                    }
                },
            )
            hits = resp.get("hits", {}).get("hits", [])
            results = []
            for h in hits:
                src = h.get("_source") or {}
                cid = str(src.get("canonical_id") or h.get("_id") or "").strip()
                if not cid:
                    continue
                src_type = str(src.get("source_type") or "").strip().lower()
                is_admin = src_type in _ADMIN_SOURCE_TYPES or src_type.startswith("admin")
                tid = cid[3:] if cid.startswith("ik:") else ""
                full_text = str(src.get("full_text") or "")
                ratio = str(src.get("holding_text") or src.get("summary_text") or "")
                url = (str(src.get("source_url") or "")
                       or (f"https://indiankanoon.org/doc/{tid}/" if tid else ""))
                item = {
                    "tid":           tid,
                    "canonical_id":  cid,
                    "title":         str(src.get("case_name") or src.get("title") or ""),
                    "court":         str(src.get("court_code") or src.get("court_name") or ""),
                    "date":          str(src.get("judgment_date") or ""),
                    "snippet":       ratio[:300] or full_text[:300],
                    "full_text":     full_text,
                    "headnotes":     ratio[:1000],
                    "bench":         str(src.get("bench") or src.get("coram") or ""),
                    "ik_citation":   str(src.get("primary_citation") or ""),
                    "url":           url,
                    "source":        "admin_upload" if is_admin else "local_db",
                    "_es_score":     float(h.get("_score") or 0.0),
                    "ikCiteList":    [],
                    "ikCitedByList": [],
                    "_query":        query,
                }
                # If ES didn't store full_text, fetch it now from asset/PG tables
                if len(full_text) < 100:
                    item = _enrich_full_text(item)
                results.append(item)

            results.sort(
                key=lambda r: (
                    -(
                        2 if "supreme" in r["court"].lower() else
                        1 if "high" in r["court"].lower() else 0
                    ),
                    -float(r.get("_es_score") or 0.0),
                    _stable_text(r.get("title")),
                    _stable_text(r.get("canonical_id") or r.get("tid") or r.get("url")),
                )
            )
            logger.info("[PROP] ES local search %r → %d result(s) (%d with full_text)",
                        query[:60], len(results),
                        sum(1 for r in results if len(r.get("full_text", "")) > 100))
            return results
    except Exception as exc:
        logger.warning("[PROP] ES search failed %r: %s — PG fallback", query[:60], exc)

    # ── PG fallback (no ES) ───────────────────────────────────────────────────
    try:
        from db.client import judgement_search_local
        rows = judgement_search_local(query, limit=6, approved_only=True,
                                      exclude_low_hierarchy=True)
        results = [r for r in (_pg_row_to_local_result(row, query) for row in rows) if r]
        # Enrich any with empty full_text
        results = [(_enrich_full_text(r) if len(r.get("full_text", "")) < 100 else r)
                   for r in results]
        results.sort(
            key=lambda r: (
                _stable_text(r.get("title")),
                _stable_text(r.get("canonical_id") or r.get("tid") or r.get("url")),
            )
        )
        logger.info("[PROP] PG fallback %r → %d result(s)", query[:60], len(results))
        return results
    except Exception as exc:
        logger.warning("[PROP] PG fallback failed %r: %s", query[:60], exc)
        return []


def search_local_parallel(
    queries: List[str],
    run_id: str,
) -> List[Dict[str, Any]]:
    """Run all queries against local DB in parallel. Returns deduplicated results."""
    if not queries:
        return []

    _db_log(run_id, "SearchAgent", "search_local", "INFO",
            f"🏛 Running {len(queries)} local DB searches in parallel",
            {"query_count": len(queries)})

    all_results: List[Dict] = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        fut_map = {pool.submit(_search_local_one, q): q for q in queries}
        for fut in as_completed(fut_map):
            try:
                all_results.extend(fut.result(timeout=15))
            except Exception as exc:
                logger.warning("[PROP] LocalDB search future error: %s", exc)

    seen: set = set()
    deduped: List[Dict] = []
    for r in all_results:
        key = r.get("canonical_id") or r.get("tid") or r.get("url") or ""
        if key and key not in seen:
            seen.add(key)
            deduped.append(r)

    deduped.sort(
        key=lambda r: (
            -(
                2 if "supreme" in str(r.get("court") or "").lower() else
                1 if "high" in str(r.get("court") or "").lower() else 0
            ),
            -float(r.get("_es_score") or 0.0),
            _stable_text(r.get("title")),
            _stable_text(r.get("canonical_id") or r.get("tid") or r.get("url")),
        )
    )

    _db_log(run_id, "SearchAgent", "search_local", "INFO",
            f"✅ Local DB: {len(deduped)} unique results",
            {"result_count": len(deduped)})
    logger.info("[PROP] LocalDB search done — %d unique results", len(deduped))
    return deduped


def search_local_semantic(
    case_context: str,
    query: str,
    run_id: str,
    limit: int = 20,
) -> List[Dict[str, Any]]:
    """
    Qdrant-backed semantic local search. Fails open (returns []) if Qdrant is
    unavailable or empty. Hydrated rows reuse `_pg_row_to_local_result` so the
    result shape matches `search_local_parallel`.
    """
    text_query = ((case_context or "")[:4000] + " " + (query or "")[:400]).strip()
    if not text_query:
        return []

    try:
        from db.client import judgement_search_semantic
    except Exception as exc:
        logger.warning("[PROP] judgement_search_semantic unavailable: %s", exc)
        return []

    collection = os.environ.get("QDRANT_COLLECTION", "legal_embeddings_v2")
    try:
        rows = judgement_search_semantic(
            text_query,
            limit=max(int(limit), 1),
            qdrant_collection=collection,
        ) or []
    except Exception as exc:
        logger.warning("[PROP] Semantic local search failed (collection=%s): %s",
                       collection, exc)
        return []

    if not rows:
        _db_log(run_id, "SearchAgent", "search_local_semantic", "INFO",
                "Qdrant empty/no matches — semantic local disabled for this run")
        return []

    normalized: List[Dict[str, Any]] = []
    for r in rows:
        norm = _pg_row_to_local_result(r, query, es_score=0.0)
        if not norm:
            continue
        sem = float(r.get("_semantic_score") or r.get("_similarity_score") or 0.0)
        norm["_semantic_score"] = sem
        norm["_from_qdrant"] = True
        normalized.append(norm)

    for item in normalized:
        if not item.get("full_text"):
            try:
                enriched = _enrich_full_text(item)
                if enriched:
                    item.update(enriched)
            except Exception as exc:
                logger.debug("[PROP] semantic enrich failed for %s: %s",
                             item.get("canonical_id"), exc)

    _db_log(run_id, "SearchAgent", "search_local_semantic", "INFO",
            f"🧭 Local semantic: {len(normalized)} result(s)",
            {"result_count": len(normalized)})
    logger.info("[PROP] Local semantic search — %d result(s)", len(normalized))
    return normalized


def merge_local(
    kw_results: List[Dict[str, Any]],
    sem_results: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Dedup keyword + semantic local results by canonical_id/tid/url."""
    merged: List[Dict[str, Any]] = []
    seen: set = set()
    for r in list(kw_results) + list(sem_results):
        key = r.get("canonical_id") or r.get("tid") or r.get("url") or ""
        if key and key in seen:
            # Preserve any semantic score from the other source if we skip this one.
            for existing in merged:
                ex_key = existing.get("canonical_id") or existing.get("tid") or existing.get("url") or ""
                if ex_key == key:
                    sem = float(r.get("_semantic_score") or 0.0)
                    if sem and sem > float(existing.get("_semantic_score") or 0.0):
                        existing["_semantic_score"] = sem
                        existing["_from_qdrant"] = True
                    break
            continue
        if key:
            seen.add(key)
        merged.append(r)
    return merged


# ─── Step 3c: Google grounding search ─────────────────────────────────────────

_IK_TID_RE = re.compile(r"indiankanoon\.org/doc/(\d+)")


def _search_google_one(
    query: str,
    run_id: Optional[str],
    user_id: str,
) -> List[Dict[str, Any]]:
    """Google search via Gemini grounding tool (GoogleSearch). Retries on 429."""
    import os
    import time as _time
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        logger.warning("[PROP] GEMINI_API_KEY not set — skipping Google grounding search")
        return []
    try:
        from google import genai
        from google.genai import types

        model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
        biased = f"{query} Indian court judgment site:indiankanoon.org"
        prompt = (
            "You are a legal search assistant. Use Google Search to find Indian court judgments. "
            "Return results ONLY as a strict JSON array with keys: title, url, snippet. "
            "No markdown, no explanatory text.\n\n"
            f"QUERY: {biased}"
        )
        grounding_tool = types.Tool(google_search=types.GoogleSearch())
        config = types.GenerateContentConfig(tools=[grounding_tool], max_output_tokens=1024)
        client = genai.Client(api_key=api_key)

        response = None
        for attempt in range(3):
            try:
                response = client.models.generate_content(
                    model=model, contents=prompt, config=config
                )
                break
            except Exception as exc:
                msg = str(exc)
                if ("429" in msg or "RESOURCE_EXHAUSTED" in msg.upper()) and attempt < 2:
                    wait = 10 * (attempt + 1)   # 10s, 20s
                    logger.warning("[PROP] Gemini 429 on %r — retrying in %ds (attempt %d/3)",
                                   query[:60], wait, attempt + 1)
                    _time.sleep(wait)
                    continue
                raise

        if response is None:
            return []

        items: List[Dict[str, Any]] = []

        # Primary: parse JSON array from model text
        resp_text = (getattr(response, "text", None) or "").strip()
        if resp_text:
            try:
                cleaned = re.sub(r"^```(?:json)?\s*", "", resp_text, flags=re.I)
                cleaned = re.sub(r"```\s*$", "", cleaned).strip()
                parsed = json.loads(cleaned)
                if isinstance(parsed, list):
                    for item in parsed[:6]:
                        if isinstance(item, dict):
                            u = str(item.get("url") or item.get("link") or "").strip()
                            if u and u.startswith("http"):
                                items.append({"link": u, "title": item.get("title", ""),
                                              "snippet": str(item.get("snippet", ""))[:400]})
            except Exception:
                pass

        # Fallback: grounding metadata chunks
        if not items and response.candidates:
            cand = response.candidates[0]
            gm = getattr(cand, "grounding_metadata", None) or getattr(cand, "groundingMetadata", None)
            if gm:
                chunks = getattr(gm, "grounding_chunks", None) or getattr(gm, "groundingChunks", None) or []
                for ch in chunks[:6]:
                    web = (getattr(ch, "web", None) if hasattr(ch, "web")
                           else (ch.get("web") if isinstance(ch, dict) else None))
                    if not web:
                        continue
                    uri = str(getattr(web, "uri", None) or (web.get("uri") if isinstance(web, dict) else "") or "").strip()
                    title = str(getattr(web, "title", None) or (web.get("title") if isinstance(web, dict) else "") or "")
                    if uri and uri.startswith("http"):
                        items.append({"link": uri, "title": title,
                                      "snippet": resp_text[:300] if resp_text else ""})

        results = []
        for item in items:
            url = item.get("link", "")
            m = _IK_TID_RE.search(url)
            tid = m.group(1) if m else ""
            results.append({
                "tid":           tid,
                "title":         item.get("title", ""),
                "snippet":       item.get("snippet", ""),
                "court":         "",
                "date":          "",
                "url":           url,
                "source":        "google",
                "ikCiteList":    [],
                "ikCitedByList": [],
                "_query":        query,
            })
        logger.info("[PROP] Gemini grounding %r → %d result(s)", query[:60], len(results))
        return results
    except Exception as exc:
        logger.warning("[PROP] Gemini grounding failed %r: %s", query[:60], exc)
        return []


def search_google_parallel(
    queries: List[str],
    run_id: str,
    user_id: str = "anonymous",
) -> List[Dict[str, Any]]:
    """Run Google grounding queries sequentially to avoid rate-limit bursts."""
    # Cap at 3 queries max; sequential to avoid simultaneous 429s
    top_queries = queries[:3]
    if not top_queries:
        return []

    _db_log(run_id, "SearchAgent", "search_google", "INFO",
            f"🌐 Running {len(top_queries)} Google searches (sequential)",
            {"query_count": len(top_queries)})

    import time as _time
    all_results: List[Dict] = []
    for i, q in enumerate(top_queries):
        if i > 0:
            _time.sleep(3)   # 3s gap between calls to avoid burst rate-limiting
        try:
            all_results.extend(_search_google_one(q, run_id, user_id))
        except Exception as exc:
            logger.warning("[PROP] Google search error for %r: %s", q[:60], exc)

    seen: set = set()
    deduped: List[Dict] = []
    for r in all_results:
        key = r.get("tid") or r.get("url") or ""
        if key and key not in seen:
            seen.add(key)
            deduped.append(r)

    _db_log(run_id, "SearchAgent", "search_google", "INFO",
            f"✅ Google: {len(deduped)} unique results",
            {"result_count": len(deduped)})
    logger.info("[PROP] Google search done — %d unique results", len(deduped))
    return deduped


# ─── Merge results from all sources ───────────────────────────────────────────

def _norm_key(r: Dict) -> str:
    """Canonical dedup key: always prefer bare numeric tid; strip 'ik:' prefix from canonical_id."""
    tid = (r.get("tid") or "").strip()
    if tid:
        return tid
    cid = (r.get("canonical_id") or "").strip()
    if cid.startswith("ik:"):
        return cid[3:]
    return cid or (r.get("url") or "").strip()


def merge_all_results(
    local_results: List[Dict],
    ik_results: List[Dict],
    google_results: List[Dict],
) -> List[Dict]:
    """Merge Local DB + IK + Google results while preserving stronger provenance on duplicates."""
    merged_by_key: Dict[str, Dict] = {}
    ordered_keys: List[str] = []

    def _key(r: Dict) -> str:
        return _norm_key(r)

    def _source_rank(r: Dict) -> int:
        src = str(r.get("source") or r.get("sourceType") or r.get("source_type") or "").lower()
        if "indian_kanoon" in src:
            return 3
        if "local" in src or "db" in src or src.startswith("admin"):
            return 2
        if "google" in src:
            return 1
        return 0

    def _merge_duplicate(existing: Dict, incoming: Dict) -> Dict:
        winner = dict(existing)
        incoming_rank = _source_rank(incoming)
        existing_rank = _source_rank(existing)

        # Prefer IK provenance when the same judgment is found in both local cache and IK.
        if incoming_rank > existing_rank:
            winner["source"] = incoming.get("source", winner.get("source"))
            winner["sourceType"] = (
                incoming.get("sourceType")
                or incoming.get("source")
                or winner.get("sourceType")
            )

        for field in ("url", "sourceUrl", "title", "court", "date", "bench", "ik_citation"):
            if not winner.get(field) and incoming.get(field):
                winner[field] = incoming.get(field)
        for field in ("snippet", "full_text", "headnotes", "ikCiteList", "ikCitedByList"):
            if incoming.get(field) and (not winner.get(field) or len(str(incoming.get(field))) > len(str(winner.get(field)))):
                winner[field] = incoming.get(field)

        provenance = []
        for value in (
            *(existing.get("sourceProvenance") or []),
            existing.get("source"),
            *(incoming.get("sourceProvenance") or []),
            incoming.get("source"),
        ):
            if value and value not in provenance:
                provenance.append(value)
        if provenance:
            winner["sourceProvenance"] = provenance
        return winner

    # Local DB first, then IK, then Google; duplicates are merged instead of discarded.
    for r in local_results + ik_results + google_results:
        k = _key(r)
        if not k:
            continue
        if k in merged_by_key:
            merged_by_key[k] = _merge_duplicate(merged_by_key[k], r)
        else:
            merged_by_key[k] = dict(r)
            ordered_keys.append(k)

    merged = [merged_by_key[k] for k in ordered_keys]

    logger.info("[PROP] Merged: %d local + %d IK + %d Google = %d unique",
                len(local_results), len(ik_results), len(google_results), len(merged))
    return merged


# ─── ES indexing helper ───────────────────────────────────────────────────────

def _index_to_es(item: Dict[str, Any]) -> None:
    """Index a fetched IK judgment into Elasticsearch for future local searches."""
    tid = item.get("tid", "")
    canonical_id = item.get("canonical_id") or (f"ik:{tid}" if tid else "")
    if not canonical_id:
        return
    full_text = item.get("full_text", "")
    if not full_text:
        return
    try:
        from db.connections import get_es_client, elasticsearch_init_failed
        es = get_es_client()
        if not es or elasticsearch_init_failed():
            return
        doc = {
            "canonical_id":        canonical_id,
            "case_name":           item.get("title", "") or item.get("caseName", ""),
            "court_code":          item.get("court", ""),
            "court_name":          item.get("court", ""),
            "primary_citation":    item.get("ik_citation", "") or item.get("primaryCitation", ""),
            "judgment_date":       item.get("date", "") or item.get("dateOfJudgment", ""),
            "summary_text":        item.get("headnotes", "")[:4000],
            "holding_text":        item.get("headnotes", "")[:4000],
            "full_text":           full_text[:50000],
            "source_type":         "indian_kanoon",
            "verification_status": "VERIFIED",
            "source_url":          item.get("url", ""),
        }
        es.update(
            index="judgments",
            id=canonical_id,
            body={"doc": doc, "doc_as_upsert": True},
        )
        logger.info("[PROP] Indexed to ES: %s", canonical_id)
    except Exception as exc:
        logger.debug("[PROP] ES index skipped for %s: %s", canonical_id, exc)


# ─── Step 4: Fetch full texts in parallel ─────────────────────────────────────

def _fetch_one_doc(item: Dict[str, Any]) -> Dict[str, Any]:
    """Fetch full document text. Local DB items refetch from PG; IK items from IK API."""
    from services.indian_kanoon import ik_fetch_doc

    # Already have substantial text — nothing to do
    if len(item.get("full_text", "")) > 300:
        return item

    src = str(item.get("source") or "").lower()

    # Local DB / admin results: enrich from ik_document_assets or PG
    if src in ("local_db", "admin_upload") or src.startswith("admin"):
        enriched = _enrich_full_text(item)
        if len(enriched.get("full_text", "")) > 100:
            return enriched
        return {**item, "full_text": item.get("snippet", "")}

    tid = item.get("tid", "")
    if not tid:
        return {**item, "full_text": item.get("snippet", "")}
    try:
        doc = ik_fetch_doc(tid, maxcites=5, maxcitedby=5)
        if not doc:
            return {**item, "full_text": item.get("snippet", "")}
        doc_html = doc.get("doc") or ""
        full_text = _strip_html(doc_html)[:15000]
        raw_headnotes = doc.get("headnotes") or doc.get("headnote") or ""
        if isinstance(raw_headnotes, list):
            headnotes_text = "\n".join(str(h) for h in raw_headnotes if h)
        else:
            headnotes_text = str(raw_headnotes)
        if "<" in headnotes_text:
            headnotes_text = _strip_html(headnotes_text)
        bench        = doc.get("bench", "") or doc.get("coram", "")
        citation_str = doc.get("citation", "") or doc.get("primarycitation", "")
        cite_list    = doc.get("cites") or doc.get("citeList") or []
        citedby_list = doc.get("citedby") or doc.get("citedbyList") or []
        enriched = {
            **item,
            "full_text":       full_text,
            "headnotes":       headnotes_text[:2000],
            "bench":           bench,
            "ik_citation":     citation_str,
            "ikCiteList":      cite_list,
            "ikCitedByList":   citedby_list,
            "court":           doc.get("docsource", "") or item.get("court", ""),
            "date":            doc.get("publishdate", "") or item.get("date", ""),
            "title":           doc.get("title", "") or item.get("title", ""),
        }
        # Store in ES so future local searches can find this judgment
        _index_to_es(enriched)
        return enriched
    except Exception as exc:
        logger.warning("[PROP] fetch_one_doc failed tid=%s: %s", tid, exc)
        return {**item, "full_text": item.get("snippet", "")}


def fetch_full_texts_parallel(
    results: List[Dict[str, Any]],
    run_id: str,
    max_fetch: int = 20,
) -> List[Dict[str, Any]]:
    """Fetch full judgment text for top results in parallel."""
    top = results[:max_fetch]
    _db_log(run_id, "FetchAgent", "fetch", "INFO",
            f"📄 Fetching full text for {len(top)} results",
            {"count": len(top)})

    enriched: List[Dict] = [None] * len(top)
    with ThreadPoolExecutor(max_workers=_IK_FETCH_WORKERS) as pool:
        fut_map = {pool.submit(_fetch_one_doc, item): i for i, item in enumerate(top)}
        for fut in as_completed(fut_map):
            idx = fut_map[fut]
            try:
                enriched[idx] = fut.result(timeout=45)
            except Exception as exc:
                logger.warning("[PROP] fetch future error idx=%d: %s", idx, exc)
                enriched[idx] = {**top[idx], "full_text": top[idx].get("snippet", "")}

    result = [r for r in enriched if r]
    substantial = sum(1 for r in result if len(r.get("full_text", "")) > 200)
    _db_log(run_id, "FetchAgent", "fetch", "INFO",
            f"✅ Fetched {substantial}/{len(result)} with substantial text",
            {"substantial": substantial, "total": len(result)})
    return result


# ─── Step 5: Deep validate and score ──────────────────────────────────────────

def _score_one(
    item: Dict[str, Any],
    legal_points: Dict[str, Any],
    score_threshold: int,
    run_id: Optional[str],
    user_id: str,
    research_plan: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """Claude scores one judgment 1–10, extracts ratio/headnote/excerpt. Returns None if below threshold."""
    _FT_WIN = int(os.environ.get("CITATION_FULLTEXT_WINDOW", "8000"))
    full_text = item.get("full_text") or item.get("snippet", "")
    if not full_text or len(full_text) < 50:
        return None

    issues    = legal_points.get("issues", [legal_points.get("primary_proposition", {})])
    prop_text = " | ".join(i.get("proposition", "") for i in issues[:3])
    acts      = list({a for iss in issues for a in iss.get("acts_involved", [])})
    wrongdoing = " / ".join(i.get("wrongdoing", "") for i in issues[:3] if i.get("wrongdoing"))

    existing_headnotes = item.get("headnotes", "")
    headnotes_block = (f"\nHeadnotes from IK:\n{existing_headnotes[:800]}"
                       if existing_headnotes else "")

    plan_statutes      = list((research_plan or {}).get("statutes") or [])[:6]
    plan_fact_patterns = list((research_plan or {}).get("fact_patterns") or [])[:6]
    plan_validation    = list((research_plan or {}).get("validation_focus") or [])[:4]
    plan_reject_rules  = list((research_plan or {}).get("reject_rules") or [])[:6]
    plan_block = ""
    if research_plan:
        plan_block = f"""
Research validation criteria:
Controlling statutes/doctrines: {plan_statutes}
Required fact patterns: {plan_fact_patterns}
Validation focus: {plan_validation}
Reject rules (hard): {plan_reject_rules}
"""

    system = (
        "You are a senior Indian advocate and legal researcher. "
        "Evaluate whether a judgment is relevant to the SPECIFIC case described below — "
        "not just the broad area of law. A judgment that mentions the same statute but "
        "involves unrelated facts, different parties, or a different legal question "
        "must receive a LOW score (≤ 5). "
        "Scores 7–8 REQUIRE both factual_match AND legal_issue_match to be true. "
        "If the judgment discusses the same statute but in a factually unrelated "
        "transaction, score 1–4."
    )
    user = f"""My case legal issues:
{prop_text[:600]}

Acts/sections involved: {acts[:6]}
Wrongdoing/specific facts: {wrongdoing[:200]}
{plan_block}
Judgment to evaluate:
Title: {item.get('title', '')}
URL: {item.get('url', '')}
{headnotes_block}
Full text (first {_FT_WIN} chars):
{full_text[:_FT_WIN]}

Evaluate this judgment and extract its key legal points.

Return ONLY this JSON:
{{
  "case_name": "Full Party A v Party B",
  "citation": "AIR/SCC citation e.g. (2020) 2 SCC 569 — write Unknown if not visible",
  "relevance_score": 8,
  "factual_match": true,
  "legal_issue_match": true,
  "which_issue": "Which of the case legal issues does this judgment address?",
  "ratio_points": [
    "Point 1: Exact legal principle/holding stated by the court",
    "Point 2: Second distinct principle if any",
    "Point 3: Third distinct principle if any"
  ],
  "headnote": "A single concise paragraph summarising what this judgment decided — facts in 1 sentence, legal issue, holding, statute applied.",
  "excerpt": "The single most powerful sentence or passage from the judgment text that supports this case (verbatim, max 350 chars)"
}}

SCORING GUIDE (STRICT — both facts AND legal question must align):
10 = Landmark case — identical facts AND same legal issue
8-9 = Very similar facts AND directly decides the same legal question
7   = Related legal principle AND at least one overlapping factual pattern — clearly citable
5-6 = Tangentially related — same statute but different facts or different legal question
1-4 = Not relevant — mentions same area of law only by coincidence

IMPORTANT: Do NOT score 7+ if the case involves completely different parties, industry, or
transaction type. A SARFAESI case about an unrelated borrower is NOT relevant to a
specific co-operative bank loan renewal dispute unless it decides the exact same legal point."""

    v = _claude_json(system, user, max_tokens=1200,
                     run_id=run_id, user_id=user_id, operation="deep_score")
    if not isinstance(v, dict):
        return None

    score = int(v.get("relevance_score", 0))
    factual_match = bool(v.get("factual_match", False))
    legal_match   = bool(v.get("legal_issue_match", False))

    if score < score_threshold:
        return None
    # Borderline scores (7–8) must carry at least one real match signal.
    # (AND-match here rejected too aggressively — see 2025 hotfix.)
    if score_threshold <= score < 9:
        if not (factual_match or legal_match):
            return None

    ratio_points = v.get("ratio_points", [])
    ratio_text = "\n".join(f"{i+1}. {pt}" for i, pt in enumerate(ratio_points) if pt) if ratio_points else ""

    headnote_text = existing_headnotes or v.get("headnote", "")

    return {
        **item,
        "caseName":        v.get("case_name") or item.get("title", ""),
        "primaryCitation": v.get("citation") or item.get("ik_citation", ""),
        "court":           item.get("court", ""),
        "dateOfJudgment":  item.get("date", ""),
        "coram":           item.get("bench", ""),
        "ratio":           ratio_text,
        "headnote":        headnote_text[:1000],
        "headnotes":       existing_headnotes[:2000] if existing_headnotes else v.get("headnote", ""),
        "excerptText":     (v.get("excerpt") or item.get("snippet", ""))[:350],
        "relevanceScore":  round(score / 10.0, 2),
        "which_issue":     v.get("which_issue", ""),
        "factual_match":   v.get("factual_match", False),
        "legal_match":     v.get("legal_issue_match", False),
        "sourceUrl":       item.get("url", ""),
        "ikCiteList":      item.get("ikCiteList", []),
        "ikCitedByList":   item.get("ikCitedByList", []),
        "canonical_id":    (item.get("canonical_id") or
                           (f"ik:{item['tid']}" if item.get("tid") else "")),
    }


def _prefilter_with_gemini(
    candidates: List[Dict[str, Any]],
    legal_points: Dict[str, Any],
    research_plan: Optional[Dict[str, Any]],
    run_id: Optional[str],
    user_id: str,
) -> List[Dict[str, Any]]:
    """Per-candidate Gemini grounding pre-filter, parallelised (no 2s gap — this is pre-pass)."""
    kept: List[Dict[str, Any]] = []
    workers = max(1, int(os.environ.get("CITATION_PREFILTER_WORKERS", "4")))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        fut_map = {
            pool.submit(
                _google_validate_candidate,
                item, legal_points, research_plan, run_id, user_id,
            ): item
            for item in candidates
        }
        for fut in as_completed(fut_map):
            item = fut_map[fut]
            try:
                res = fut.result(timeout=45)
            except Exception as exc:
                logger.debug("[PROP] prefilter candidate failed: %s", exc)
                # Fail-open per-candidate: keep on error
                kept.append(item)
                continue
            if res is None:
                # Gemini unavailable or malformed — keep (fail-open)
                kept.append(item)
                continue
            relevant = bool(res.get("groundingValidated"))
            confidence = float(res.get("groundingConfidence") or 0.0)
            if relevant and confidence >= 0.45:
                kept.append(res)
    return kept


def _prefilter_with_claude(
    candidates: List[Dict[str, Any]],
    legal_points: Dict[str, Any],
    research_plan: Optional[Dict[str, Any]],
    run_id: Optional[str],
    user_id: str,
) -> List[Dict[str, Any]]:
    """Cheap Claude batch pre-filter: 10 candidates per call, title + snippet only."""
    issues = legal_points.get("issues", [legal_points.get("primary_proposition", {})])
    issue_text = " | ".join(
        str(iss.get("proposition") or iss.get("issue_title") or "").strip()
        for iss in issues[:4]
        if (iss.get("proposition") or iss.get("issue_title"))
    )[:700]
    plan_statutes      = list((research_plan or {}).get("statutes") or [])[:6]
    plan_fact_patterns = list((research_plan or {}).get("fact_patterns") or [])[:6]
    plan_reject_rules  = list((research_plan or {}).get("reject_rules") or [])[:6]

    kept: List[Dict[str, Any]] = []
    system = (
        "You are a senior Indian legal researcher. For each candidate judgment below, "
        "decide whether it is LIKELY relevant to the described case. Apply the reject "
        "rules strictly. Be conservative — when in doubt, mark likely_relevant=false. "
        "Return ONLY valid JSON."
    )
    batch_size = 10
    for start in range(0, len(candidates), batch_size):
        batch = candidates[start:start + batch_size]
        items_block = "\n".join(
            f"- id={(it.get('tid') or it.get('canonical_id') or it.get('url') or str(start+i))} | "
            f"title={str(it.get('title') or '')[:200]} | "
            f"snippet={str(it.get('snippet') or it.get('headnotes') or '')[:500]}"
            for i, it in enumerate(batch)
        )
        user = f"""Case issues:
{issue_text}

Controlling statutes: {plan_statutes}
Required fact patterns: {plan_fact_patterns}
Reject rules (hard): {plan_reject_rules}

Candidates:
{items_block}

Return ONLY this JSON:
{{
  "verdicts": [
    {{"id": "<same id>", "likely_relevant": true, "reason": "short"}}
  ]
}}"""
        result = _claude_json(
            system, user, max_tokens=800,
            run_id=run_id, user_id=user_id, operation="prefilter_batch",
        )
        if not isinstance(result, dict):
            # Fail-open: keep the whole batch if Claude fails
            kept.extend(batch)
            continue
        verdicts = result.get("verdicts") or []
        by_id: Dict[str, bool] = {}
        for v in verdicts:
            if isinstance(v, dict):
                vid = str(v.get("id") or "").strip()
                if vid:
                    by_id[vid] = bool(v.get("likely_relevant"))
        for i, it in enumerate(batch):
            iid = str(it.get("tid") or it.get("canonical_id") or it.get("url") or str(start + i))
            # Fail-open: if Claude didn't emit a verdict for this id, keep it.
            if by_id.get(iid, True):
                kept.append(it)
    return kept


def prefilter_candidates(
    candidates: List[Dict[str, Any]],
    legal_points: Dict[str, Any],
    research_plan: Optional[Dict[str, Any]],
    run_id: str,
    user_id: str = "anonymous",
) -> List[Dict[str, Any]]:
    """
    Relevance gate between full-text fetch and Claude deep scoring. Modes:
      - gemini (default): Gemini grounding per candidate (parallel)
      - claude: batched Claude JSON verdict (cheaper, no Gemini key needed)
      - off: returns candidates unchanged
    Curated sources (admin_upload / local_db) always bypass the filter.
    Fails open on any exception — returns the original list.
    """
    if not candidates:
        return []

    mode = (os.environ.get("CITATION_PREFILTER_MODE", "gemini") or "gemini").strip().lower()
    if mode == "off":
        return candidates

    cap = max(1, int(os.environ.get("CITATION_PREFILTER_MAX", "40")))

    curated: List[Dict[str, Any]] = []
    to_check: List[Dict[str, Any]] = []
    for it in candidates:
        src = str(it.get("source") or "").lower()
        if src in ("admin_upload", "local_db") or src.startswith("admin"):
            curated.append(it)
        else:
            to_check.append(it)

    inspect = to_check[:cap]
    pass_through = to_check[cap:]

    try:
        if mode == "gemini" and _grounding_available():
            kept = _prefilter_with_gemini(inspect, legal_points, research_plan, run_id, user_id)
        else:
            # mode == "claude", or gemini requested but key missing
            kept = _prefilter_with_claude(inspect, legal_points, research_plan, run_id, user_id)
    except Exception as exc:
        logger.warning("[PROP] prefilter_candidates failed (%s) — falling back to original list", exc)
        return candidates

    # Fail-safe: if the filter killed every non-curated candidate it likely has bad
    # signal for this case. Keep the original list and let Claude scoring decide.
    if inspect and not kept and not curated:
        _db_log(
            run_id, "PropositionPipeline", "prefilter", "WARNING",
            f"Prefilter ({mode}) rejected all {len(inspect)} candidates — bypassing filter",
            {"mode": mode, "before": len(inspect), "after_kept": 0, "bypassed": True},
        )
        return candidates

    final = curated + kept + pass_through
    _db_log(
        run_id, "PropositionPipeline", "prefilter", "INFO",
        f"Prefilter ({mode}): {len(to_check)} → {len(kept)} (curated: {len(curated)}, deferred: {len(pass_through)})",
        {"mode": mode, "before": len(to_check), "after_kept": len(kept),
         "curated": len(curated), "deferred": len(pass_through)},
    )
    return final


def deep_validate_and_score(
    legal_points: Dict[str, Any],
    results: List[Dict[str, Any]],
    run_id: str,
    user_id: str = "anonymous",
    score_threshold: int = 7,
    research_plan: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Validate and score all results in parallel. Returns only those scoring >= threshold."""
    _db_log(run_id, "DeepValidator", "validate", "INFO",
            f"Deep-validating {len(results)} results (threshold: {score_threshold}/10)")

    scored: List[Optional[Dict]] = []
    with ThreadPoolExecutor(max_workers=_SCORE_WORKERS) as pool:
        fut_map = {
            pool.submit(_score_one, item, legal_points, score_threshold, run_id, user_id, research_plan): item
            for item in results
        }
        for fut in as_completed(fut_map):
            try:
                r = fut.result(timeout=60)
                scored.append(r)
            except Exception as exc:
                logger.warning("[PROP] score future error: %s", exc)

    valid = [r for r in scored if r]
    valid.sort(
        key=lambda x: (
            -float(x.get("relevanceScore", 0) or 0.0),
            _stable_text(x.get("source") or x.get("sourceType")),
            _stable_text(x.get("caseName") or x.get("title")),
            _stable_text(x.get("canonical_id") or x.get("tid") or x.get("sourceUrl") or x.get("url")),
        )
    )

    _db_log(run_id, "DeepValidator", "validate", "INFO",
            f"✅ Deep validation: {len(results)} → {len(valid)} (score ≥ {score_threshold}/10)",
            {"valid_count": len(valid), "total": len(results)})
    for r in valid[:5]:
        logger.info("[PROP] ✓ [%.1f] %s", r.get("relevanceScore", 0), r.get("caseName", "")[:60])
    return valid


# ─── Step 6: Build report format ──────────────────────────────────────────────

def _resolve_source(c: Dict[str, Any]) -> tuple:
    """Return (source_key, sourceType, isLocalAdmin) from a citation dict."""
    raw = str(c.get("source") or c.get("sourceType") or c.get("source_type") or "").lower()
    is_admin = (
        raw in ("admin_upload", "admin", "manual_upload", "judgment_upload")
        or raw.startswith("admin")
    )
    if is_admin or "local" in raw or "db" in raw:
        return "local_db", "local_db", is_admin
    if "google" in raw:
        return "google", "google", False
    # Default: anything with a tid or indiankanoon url is IK
    tid = str(c.get("tid") or "")
    url = str(c.get("sourceUrl") or c.get("url") or "")
    if tid or "indiankanoon" in url:
        return "indian_kanoon", "indian_kanoon", False
    # If canonical_id is ik-prefixed
    cid = str(c.get("canonical_id") or "")
    if cid.startswith("ik:"):
        return "indian_kanoon", "indian_kanoon", False
    return "indian_kanoon", "indian_kanoon", False


def _court_to_dim(court: str) -> tuple:
    """Map court string to (dim_id, dim_name)."""
    c = (court or "").lower()
    if "supreme court" in c:
        name = "Supreme Court"
    elif "high court" in c:
        for hc in ("bombay", "delhi", "madras", "calcutta", "allahabad", "kerala",
                   "gujarat", "rajasthan", "punjab", "karnataka", "telangana",
                   "andhra", "orissa", "patna", "gauhati", "himachal"):
            if hc in c:
                name = f"{hc.title()} High Court"
                break
        else:
            name = "High Court"
    elif "tribunal" in c:
        name = "Tribunals"
    else:
        name = "Other Courts"
    return re.sub(r"[^a-z0-9]", "_", name.lower())[:30], name


def _keyword_group_label(citation: Dict[str, Any]) -> str:
    """Prefer the actual retrieval query for grouping; fall back to issue, then court."""
    query_label = str(
        citation.get("_query")
        or citation.get("search_query")
        or citation.get("query")
        or ""
    ).strip()
    if query_label:
        return query_label[:80]

    which = str(citation.get("which_issue") or "").strip()
    if which:
        return which[:80]

    _, court_label = _court_to_dim(citation.get("court", ""))
    return court_label


def _build_query_dimensions(
    ik_queries: List[str],
    raw_ik: List[Dict[str, Any]],
    final_citations: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Build sidebar-friendly metadata for every IK query, even if no citation survived."""
    dims: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for query in ik_queries:
        label = str(query or "").strip()
        if not label:
            continue
        dim_id = re.sub(r"[^a-z0-9]", "_", label.lower())[:30] or "keyword_group"
        key = f"{dim_id}::{label.lower()}"
        if key in seen:
            continue
        seen.add(key)
        ik_count = sum(1 for r in raw_ik if _stable_text(r.get("_query")) == _stable_text(label))
        approved_count = sum(
            1 for c in final_citations
            if _stable_text(c.get("searchQuery") or c.get("dimensionName")) == _stable_text(label)
        )
        dims.append({
            "dimension_id": dim_id,
            "name": label,
            "reasoning": f"IK query used for retrieval. IK hits: {ik_count}. Approved citations: {approved_count}.",
            "query": label,
            "ik_result_count": ik_count,
            "approved_count": approved_count,
            "citations": [],
        })
    return dims


def _cosine_sim(a: List[float], b: List[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    num = 0.0
    da = 0.0
    db = 0.0
    for x, y in zip(a, b):
        num += x * y
        da  += x * x
        db  += y * y
    if da <= 0.0 or db <= 0.0:
        return 0.0
    import math
    return num / (math.sqrt(da) * math.sqrt(db))


def semantic_rerank_survivors(
    survivors: List[Dict[str, Any]],
    case_context: str,
    legal_points: Dict[str, Any],
    run_id: str,
) -> List[Dict[str, Any]]:
    """
    Embedding-based tie-break on Claude survivors. Builds a single case vector
    from case_context + legal issues, then for each survivor either reuses a
    cached vector from `ik_document_assets.meta.embedding_v2` or embeds the
    judgment's title + headnote + excerpt + first 2000 chars of full_text.
    Drops survivors whose cosine < CITATION_SEMANTIC_MIN_COSINE (default 0.55)
    and re-sorts by (relevanceScore desc, cosine desc). Fails open on error.
    """
    if (os.environ.get("CITATION_SEMANTIC_RERANK", "on") or "on").strip().lower() != "on":
        return survivors
    if not survivors:
        return survivors

    try:
        from db.client import get_query_embedding, ik_asset_get, ik_asset_upsert
    except Exception as exc:
        logger.warning("[PROP] semantic_rerank_survivors: db.client import failed: %s", exc)
        return survivors

    min_cos = float(os.environ.get("CITATION_SEMANTIC_MIN_COSINE", "0.55"))

    issues = legal_points.get("issues", []) or []
    issues_blurb = " | ".join(
        str(iss.get("proposition") or iss.get("issue_title") or "").strip()
        for iss in issues[:4] if (iss.get("proposition") or iss.get("issue_title"))
    )
    case_text = ((case_context or "")[:3000] + " " + issues_blurb).strip()
    if not case_text:
        return survivors

    try:
        case_vec = get_query_embedding(case_text)
    except Exception as exc:
        logger.warning("[PROP] case embedding failed: %s", exc)
        return survivors
    if not case_vec:
        return survivors

    import hashlib
    run_cache: Dict[str, List[float]] = {}
    scored_pairs: List[tuple] = []

    for s in survivors:
        tid = str(s.get("tid") or "").strip()
        cid = str(s.get("canonical_id") or (f"ik:{tid}" if tid else "")).strip()
        cache_key = cid or tid or str(s.get("url") or "")

        judg_text = "\n".join(str(x or "") for x in (
            s.get("caseName") or s.get("title") or "",
            s.get("headnote") or s.get("headnotes") or "",
            s.get("excerptText") or s.get("snippet") or "",
            (s.get("full_text") or "")[:2000],
        )).strip()
        if not judg_text:
            continue

        text_sha1 = hashlib.sha1(judg_text.encode("utf-8", errors="ignore")).hexdigest()[:16]

        vec: List[float] = []
        # In-run cache
        if cache_key in run_cache:
            vec = run_cache[cache_key]
        # Persisted cache (IK only)
        if not vec and tid:
            try:
                asset = ik_asset_get(tid) or {}
                meta = asset.get("meta") or {}
                if isinstance(meta, dict):
                    cached_vec = meta.get("embedding_v2")
                    cached_sha = meta.get("embedding_text_sha1")
                    if isinstance(cached_vec, list) and cached_sha == text_sha1:
                        vec = [float(x) for x in cached_vec]
            except Exception as exc:
                logger.debug("[PROP] embedding cache read failed for %s: %s", tid, exc)

        # Non-IK rows that already carry a semantic score from search_local_semantic:
        if not vec and float(s.get("_semantic_score") or 0.0) > 0.0:
            cos = float(s.get("_semantic_score"))
            if cos >= min_cos:
                scored_pairs.append((s, cos))
            continue

        # Miss → embed now
        if not vec:
            try:
                vec = get_query_embedding(judg_text[:6000])
            except Exception as exc:
                logger.debug("[PROP] survivor embedding failed (%s): %s", cache_key, exc)
                vec = []
            if not vec:
                # Fail-open: keep without rerank contribution
                scored_pairs.append((s, 0.0))
                continue
            run_cache[cache_key] = vec

            # Persist embedding for IK docs — read-merge-write so we don't clobber other meta keys.
            if tid:
                try:
                    existing = ik_asset_get(tid) or {}
                    merged_meta = existing.get("meta") or {}
                    if not isinstance(merged_meta, dict):
                        merged_meta = {}
                    merged_meta["embedding_v2"] = vec
                    merged_meta["embedding_text_sha1"] = text_sha1
                    ik_asset_upsert(doc_id=tid, canonical_id=cid or None, meta=merged_meta)
                except Exception as exc:
                    logger.debug("[PROP] embedding cache write failed for %s: %s", tid, exc)

        cos = _cosine_sim(case_vec, vec)
        scored_pairs.append((s, cos))

    kept = [(s, cos) for s, cos in scored_pairs if cos >= min_cos]
    dropped = len(scored_pairs) - len(kept)
    if not kept and scored_pairs:
        # All below threshold — don't return an empty list; fall back to Claude's order.
        logger.info("[PROP] Semantic rerank: all %d survivors < min_cos=%.2f — fail-open",
                    len(scored_pairs), min_cos)
        _db_log(run_id, "PropositionPipeline", "semantic_rerank", "WARNING",
                f"Semantic rerank: 0/{len(scored_pairs)} survivors >= cosine {min_cos} — keeping Claude order")
        return survivors

    kept.sort(key=lambda p: (-float(p[0].get("relevanceScore") or 0.0), -p[1]))

    out: List[Dict[str, Any]] = []
    for s, cos in kept:
        s["_semantic_cosine"] = round(cos, 4)
        out.append(s)

    _db_log(run_id, "PropositionPipeline", "semantic_rerank", "INFO",
            f"Semantic rerank: kept {len(out)}/{len(scored_pairs)} (cosine >= {min_cos}), dropped {dropped}",
            {"kept": len(out), "total": len(scored_pairs), "dropped": dropped, "min_cosine": min_cos})
    return out


def _build_report_format(
    citations: List[Dict[str, Any]],
    query: str,
    legal_points: Dict[str, Any],
    user_id: str,
    case_id: Optional[str],
    run_id: str,
    perspective: str,
    dimensions_metadata: Optional[List[Dict[str, Any]]] = None,
    search_keywords_by_route: Optional[Dict[str, List[str]]] = None,
    research_plan: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    now = datetime.now(timezone.utc).strftime("%d %B %Y")
    issues = legal_points.get("issues", [])
    all_acts = list({a for iss in issues for a in iss.get("acts_involved", [])})

    if not citations:
        return {
            "citations": [],
            "generatedAt": now,
            "perspective": perspective,
            "dimensions": [],
            "dimensionGroups": [],
            "dimensions_metadata": dimensions_metadata or [],
            "researchPlan": research_plan or {},
            "status": "completed",
            "metadata": {
                "query": query,
                "user_id": user_id,
                "case_id": case_id,
                "run_id": run_id,
                "citation_count": 0,
                "generated_at": now,
                "service_version": "proposition-ik",
            },
        }

    dim_map: Dict[str, Dict] = {}
    final_cits: List[Dict] = []
    _seen_keys: set = set()
    _seen_titles: set = set()

    for c in citations:
        # Final dedup guard: normalise tid/"ik:"-prefixed canonical_id to same key
        _norm = _norm_key(c)
        _title_key = re.sub(r"\s+", " ", (c.get("caseName") or c.get("title") or "").lower().strip())
        if _norm and _norm in _seen_keys:
            continue
        if _title_key and len(_title_key) > 10 and _title_key in _seen_titles:
            continue
        if _norm:
            _seen_keys.add(_norm)
        if _title_key:
            _seen_titles.add(_title_key)
        cid = str(uuid.uuid4())
        dim_name = _keyword_group_label(c)
        dim_id = re.sub(r"[^a-z0-9]", "_", dim_name.lower())[:30] or "keyword_group"

        url = c.get("sourceUrl") or c.get("url", "")
        statutes = c.get("statutes") or all_acts
        src_key, src_type, is_admin = _resolve_source(c)

        entry = {
            "id":                cid,
            "caseName":          c.get("caseName") or c.get("title", ""),
            "primaryCitation":   c.get("primaryCitation") or c.get("ik_citation", ""),
            "court":             c.get("court", ""),
            "dateOfJudgment":    c.get("dateOfJudgment") or c.get("date", ""),
            "coram":             c.get("coram") or c.get("bench", ""),
            "statutes":          statutes,
            "ratio":             c.get("ratio", ""),
            "headnote":          c.get("headnote", "")[:1000],
            "headnotes":         c.get("headnotes", "")[:2000],
            "excerptText":       c.get("excerptText", c.get("snippet", ""))[:350],
            "fullText":          (c.get("full_text", ""))[:3000],
            "which_issue":       c.get("which_issue", ""),
            "searchQuery":       c.get("_query") or c.get("search_query") or c.get("query") or "",
            "relevanceScore":    float(c.get("relevanceScore", 0.7)),
            "relevanceBadge":    "High" if float(c.get("relevanceScore", 0.7)) >= 0.75 else "Medium",
            "argumentParty":     "neutral",
            "source":            src_key,
            "sourceType":        src_type,
            "isLocalAdmin":      is_admin,
            "sourceUrl":         url,
            "sourceUrls":        [url] if url else [],
            "canonical_id":      c.get("canonical_id") or f"ik:{c.get('tid', '')}",
            "dimensionId":       dim_id,
            "dimensionName":     dim_name,
            "verificationStatus": "GREEN",
            "auditStatus":       "VERIFIED",
            "partyArguments":    {"appellant": [], "respondent": [], "court": ""},
            "treatment":         {"followedList": [], "distinguishedList": [], "overruledList": []},
            "ikCiteList":        c.get("ikCiteList", []),
            "ikCitedByList":     c.get("ikCitedByList", []),
            "metadata": {
                "caseName":          c.get("caseName") or c.get("title", "Not Available"),
                "court":             c.get("court") or "Not Available",
                "bench":             c.get("coram") or c.get("bench") or "Not Available",
                "date":              c.get("dateOfJudgment") or c.get("date") or "Not Available",
                "official_citation": c.get("primaryCitation") or "Not Available",
                "source_url":        url or "Not Available",
                "source":            src_key,
            },
        }
        final_cits.append(entry)

        if dim_id not in dim_map:
            dim_map[dim_id] = {"dimension_id": dim_id, "name": dim_name,
                               "reasoning": "", "citations": []}
        dim_map[dim_id]["citations"].append(cid)

    dims = list(dim_map.values())
    return {
        "citations":       final_cits,
        "generatedAt":     now,
        "perspective":     perspective,
        "dimensions":      dims,
        "dimensionGroups": dims,
        "dimensions_metadata": dimensions_metadata or [],
        "searchKeywordsByRoute": search_keywords_by_route or {},
        "researchPlan": research_plan or {},
        "status":          "completed",
        "metadata": {
            "query":          query,
            "user_id":        user_id,
            "case_id":        case_id,
            "run_id":         run_id,
            "citation_count": len(final_cits),
            "generated_at":   now,
            "service_version": "proposition-ik",
            "legal_issues":   [i.get("issue_title", "") for i in issues],
        },
    }


# ─── Fallback: convert raw search results without scoring ────────────────────

def _results_to_citations(
    results: List[Dict[str, Any]],
    legal_points: Dict[str, Any],
) -> List[Dict[str, Any]]:
    all_acts = list({a for iss in legal_points.get("issues", [])
                     for a in iss.get("acts_involved", [])})
    cits = []
    for r in results:
        tid = r.get("tid", "")
        url = r.get("url", "")
        cid = r.get("canonical_id") or (f"ik:{tid}" if tid else url)
        cits.append({
            "caseName":        r.get("title", ""),
            "primaryCitation": r.get("ik_citation", ""),
            "court":           r.get("court", ""),
            "dateOfJudgment":  r.get("date", ""),
            "coram":           r.get("bench", ""),
            "statutes":        all_acts,
            "excerptText":     r.get("snippet", r.get("full_text", ""))[:350],
            "ratio":           r.get("snippet", "")[:200],
            "headnote":        r.get("headnotes", "")[:500],
            "relevanceScore":  0.6,
            "argumentParty":   "neutral",
            "source":          r.get("source", "indian_kanoon"),
            "sourceUrl":       url,
            "canonical_id":    cid,
            "tid":             tid,
            "ikCiteList":      r.get("ikCiteList", []),
            "ikCitedByList":   r.get("ikCitedByList", []),
        })
    return cits


# ─── Main entry point ─────────────────────────────────────────────────────────

def run_proposition_pipeline(
    query: str,
    case_context: str,
    run_id: str,
    perspective: str,
    user_id: str,
    case_id: Optional[str],
) -> Dict[str, Any]:
    """Run the full proposition-based citation pipeline. Sync — safe to call from a thread."""

    _db_log(run_id, "PropositionPipeline", "start", "INFO",
            f"Pipeline started — query: {query[:120]}")

    # 1. Extract all legal points
    legal_points = extract_all_legal_points(query, case_context, run_id, user_id)

    # 2. Build an explicit research plan, then generate IK keyword queries from it
    research_plan = build_research_plan(query, case_context, legal_points, run_id, user_id)
    ik_queries = generate_ik_queries(
        legal_points,
        run_id,
        user_id,
        case_context=case_context,
        research_plan=research_plan,
    )

    # Filter out party-name-only queries (long proper-noun strings with no legal terms)
    _legal_terms = re.compile(
        r"\b(section|article|act|CrPC|IPC|writ|petition|quash|bail|acquisition|"
        r"compensation|court|tribunal|rights|violation|breach|fraud|cheating)\b", re.I
    )
    ik_queries = [q for q in ik_queries if _legal_terms.search(q)]

    # Query-quality gate: drop queries that score poorly against the research plan,
    # but always keep at least 4 (top by plan-score) so retrieval has enough reach.
    if ik_queries:
        _scored_queries = sorted(
            ik_queries,
            key=lambda q: _score_query_against_plan(q, research_plan),
            reverse=True,
        )
        _before = len(_scored_queries)
        _strong = [
            q for q in _scored_queries
            if _score_query_against_plan(q, research_plan) >= 2 or _legal_terms.search(q)
        ]
        if len(_strong) < 4:
            _strong = _scored_queries[: min(4, _before)]
        ik_queries = _strong
        _db_log(run_id, "PropositionPipeline", "query_gate", "INFO",
                f"Query-quality gate: kept {len(ik_queries)}/{_before} queries")

    if not ik_queries:
        # Absolute fallback: use acts from extracted issues directly as IK queries
        all_acts = [a for iss in legal_points.get("issues", [])
                    for a in iss.get("acts_involved", [])]
        ik_queries = [
            _normalize_ik_query(a[:60], legal_points, case_context=case_context)
            for a in all_acts[:4]
        ] or [_normalize_ik_query(query[:80], legal_points, case_context=case_context)]

    # 3. Search sources in priority order: Local ES → Indian Kanoon → Google
    #    Each stage is only triggered if the previous didn't yield enough candidates.
    _ENOUGH = 10   # skip next source if we already have this many candidates

    # Stage A: Local keyword (ES/PG) + Local semantic (Qdrant) — run in parallel.
    # Semantic search fails open if Qdrant is unavailable or the collection is empty.
    with ThreadPoolExecutor(max_workers=2) as _local_pool:
        _fut_kw  = _local_pool.submit(search_local_parallel, ik_queries, run_id)
        _fut_sem = _local_pool.submit(search_local_semantic, case_context, query, run_id, 20)
        try:
            raw_local_kw = _fut_kw.result(timeout=30)
        except Exception as exc:
            logger.warning("[PROP] search_local_parallel failed: %s", exc)
            raw_local_kw = []
        try:
            raw_local_sem = _fut_sem.result(timeout=30)
        except Exception as exc:
            logger.warning("[PROP] search_local_semantic failed: %s", exc)
            raw_local_sem = []
    raw_local = merge_local(raw_local_kw, raw_local_sem)
    _db_log(run_id, "PropositionPipeline", "search_local", "INFO",
            f"🏛 Local: {len(raw_local)} result(s) (kw={len(raw_local_kw)}, sem={len(raw_local_sem)})")

    # Stage B: Indian Kanoon — always run, gives the bulk of case law
    raw_ik = search_ik_parallel(ik_queries, run_id, legal_points=legal_points)
    _db_log(run_id, "PropositionPipeline", "search_ik", "INFO",
            f"📚 Indian Kanoon: {len(raw_ik)} result(s)")

    # Stage C: Google grounding — only if combined local+IK is still thin
    combined_so_far = len({
        r.get("tid") or r.get("canonical_id") or r.get("url") or ""
        for r in raw_local + raw_ik if r.get("tid") or r.get("canonical_id") or r.get("url")
    })
    if combined_so_far < _ENOUGH:
        _db_log(run_id, "PropositionPipeline", "search_google", "INFO",
                f"🌐 Only {combined_so_far} so far — triggering Google grounding")
        raw_google = search_google_parallel(ik_queries, run_id, user_id)
    else:
        _db_log(run_id, "PropositionPipeline", "search_google", "INFO",
                f"🌐 Skipping Google — {combined_so_far} candidates already sufficient")
        raw_google = []

    # Merge: Local DB first (already has full_text), then IK, then Google
    raw_results = merge_all_results(raw_local, raw_ik, raw_google)

    if not raw_results:
        _db_log(run_id, "PropositionPipeline", "search", "WARNING",
                "⚠ No results from Local ES, IK, or Google grounding")
        return _build_report_format(
            [],
            query,
            legal_points,
            user_id,
            case_id,
            run_id,
            perspective,
            dimensions_metadata=_build_query_dimensions(ik_queries, raw_ik, []),
            search_keywords_by_route={
                "local": list(ik_queries),
                "indian_kanoon": list(ik_queries),
                "google": [],
            },
            research_plan=research_plan,
        )

    # 4. Fetch full judgment texts in parallel
    enriched = fetch_full_texts_parallel(raw_results, run_id, max_fetch=30)

    # 4b. Relevance pre-filter (Gemini grounding or cheap Claude batch) — removes
    # obvious junk before expensive _score_one() runs. Fails open on error.
    prefiltered = prefilter_candidates(
        enriched, legal_points, research_plan, run_id, user_id,
    )

    # 5. Deep validate + score — try threshold 7 first, then one-step relax to 6.
    # (We deliberately do NOT relax further to 5; 6 keeps "related principle + one
    # factual overlap" as a minimum so citations stay usefully on-point.)
    scored = deep_validate_and_score(legal_points, prefiltered, run_id, user_id,
                                     score_threshold=7, research_plan=research_plan)

    if not scored:
        _db_log(run_id, "PropositionPipeline", "validate", "WARNING",
                "Score ≥ 7 gave 0 — relaxing once to ≥ 6")
        scored = deep_validate_and_score(legal_points, prefiltered, run_id, user_id,
                                         score_threshold=6, research_plan=research_plan)
        if not scored:
            _db_log(run_id, "PropositionPipeline", "validate", "WARNING",
                    "Score ≥ 6 also gave 0 — continuing to empty-result path")

    if scored:
        grounding_pool = [
            item for item in scored
            if str(item.get("sourceUrl") or item.get("url") or "").strip()
        ]
        _db_log(run_id, "PropositionPipeline", "grounding_validate", "INFO",
                f"Validating top {min(len(grounding_pool), 12)} candidates via Google grounding")
        grounded = google_validate_candidates(
            grounding_pool,
            legal_points,
            research_plan,
            run_id,
            user_id,
            max_validate=12,
        )
        if grounded:
            scored = grounded
        else:
            if _grounding_available():
                strict_fallback = _strict_scored_fallback(scored)
                if strict_fallback:
                    _db_log(run_id, "PropositionPipeline", "grounding_validate", "WARNING",
                            f"Grounding rejected all candidates; using {len(strict_fallback)} strict scored fallback match(es)")
                    scored = strict_fallback
                else:
                    _db_log(run_id, "PropositionPipeline", "grounding_validate", "WARNING",
                            "Grounding validation rejected all candidates; returning no citations rather than weak matches")
                    scored = []
            else:
                _db_log(run_id, "PropositionPipeline", "grounding_validate", "WARNING",
                        "Grounding unavailable; keeping scored results")

    # 6. Semantic rerank on Claude survivors (tie-break + final relevance filter).
    if scored:
        scored = semantic_rerank_survivors(scored, case_context, legal_points, run_id)

    if not scored:
        if _grounding_available():
            _db_log(run_id, "PropositionPipeline", "validate", "WARNING",
                    "No judgments survived strict validation; returning empty result set")
            return _build_report_format(
                [],
                query,
                legal_points,
                user_id,
                case_id,
                run_id,
                perspective,
                dimensions_metadata=_build_query_dimensions(ik_queries, raw_ik, []),
                search_keywords_by_route={
                    "local": list(ik_queries),
                    "indian_kanoon": list(ik_queries),
                    "google": list(ik_queries[:3]) if raw_google else [],
                },
                research_plan=research_plan,
            )
        _db_log(run_id, "PropositionPipeline", "validate", "WARNING",
                "Deep validation returned 0 and grounding unavailable — using raw results without scoring")
        scored = _results_to_citations(enriched[:15], legal_points)

    _TOP_N = int(os.environ.get("CITATION_TOP_N", "12"))
    # Guarantee source diversity: always include top N from local DB and IK
    # even if their scores were below threshold (scored list is already sorted desc).
    _MIN_PER_SOURCE = 0 if _grounding_available() else 3
    top = scored[:_TOP_N]

    def _source_key(r: Dict) -> str:
        src = str(r.get("source") or r.get("sourceType") or r.get("source_type") or "").lower()
        if "local" in src or "db" in src or src.startswith("admin"):
            return "local_db"
        if "google" in src:
            return "google"
        return "indian_kanoon"

    # Count how many from each source already made it into top
    top_ids = {(r.get("tid") or r.get("canonical_id") or r.get("url") or ""): True for r in top}
    source_counts: Dict[str, int] = {}
    for r in top:
        k = _source_key(r)
        source_counts[k] = source_counts.get(k, 0) + 1

    # For each source that already has scored/validated results, ensure minimum representation
    for src_label in ("local_db", "indian_kanoon"):
        has_scored_source = any(_source_key(r) == src_label for r in scored)
        if not has_scored_source:
            continue
        deficit = _MIN_PER_SOURCE - source_counts.get(src_label, 0)
        if deficit <= 0:
            continue
        pool_scored = [
            r for r in scored
            if _source_key(r) == src_label
            and (r.get("tid") or r.get("canonical_id") or r.get("url") or "") not in top_ids
        ]
        for item in pool_scored[:deficit]:
            top.append(item)
            uid_key = item.get("tid") or item.get("canonical_id") or item.get("url") or ""
            if uid_key:
                top_ids[uid_key] = True
            deficit -= 1
            if deficit <= 0:
                break

    top = top[:_TOP_N]
    dimensions_metadata = _build_query_dimensions(ik_queries, raw_ik, top)
    _db_log(run_id, "PropositionPipeline", "done", "INFO",
            f"🎉 Pipeline complete — {len(top)} citations covering "
            f"{len(legal_points.get('issues', []))} legal issues",
            {"citation_count": len(top)})

    return _build_report_format(
        top,
        query,
        legal_points,
        user_id,
        case_id,
        run_id,
        perspective,
        dimensions_metadata=dimensions_metadata,
        search_keywords_by_route={
            "local": list(ik_queries),
            "indian_kanoon": list(ik_queries),
            "google": list(ik_queries[:3]) if raw_google else [],
        },
        research_plan=research_plan,
    )
