"""Proposition-Based Citation Pipeline.

Flow:
  1. extract_all_legal_points — extract EVERY legal issue from the case document
  2. generate_queries         — 2 queries per issue across multiple legal databases
  3. search_domain_restricted — Serper (multi-site) + IK API in parallel
  4. quick_validate           — YES/NO filter per issue (removes noise)
  5. fetch_full_texts         — fetch full judgment text for top results
  6. deep_validate_and_score  — factual + legal issue match + score 1-10
  7. rank_and_select          — keep score ≥ 7, sorted by relevance
  8. build_report             — ReportFormat for frontend
"""
from __future__ import annotations

import asyncio
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from utils.claude_client import claude_complete_json, claude_complete
from utils.logger import pipeline_log


# ---------------------------------------------------------------------------
# Step 1 — Extract ALL Legal Points from the case document
# ---------------------------------------------------------------------------

async def extract_all_legal_points(
    query: str,
    case_context: str,
    run_id: str,
) -> Dict[str, Any]:
    """Extract EVERY distinct legal issue, argument, and constitutional point from the case.

    Returns a structured dict with:
      - issues: list of individual legal points (each with proposition, acts, wrongdoing)
      - parties: petitioner / respondent
      - case_type: writ / civil appeal / etc
      - primary_proposition: the single most important issue (for validation context)
    """
    pipeline_log(run_id, "PropositionExtractor", "Extracting all legal points from case document")

    system = (
        "You are a senior Indian advocate reading a case brief. "
        "Your task is to identify and articulate EVERY distinct legal issue in the case — "
        "constitutional points, statutory violations, procedural lapses, fundamental rights, "
        "and any other arguable legal point. "
        "Each issue must be a precise legal proposition a court can decide on."
    )

    user = f"""Case document:
{case_context[:6000] if case_context else 'Not provided.'}

User query: {query}

Read the entire case carefully and extract ALL distinct legal points.
A legal point is a specific arguable issue — not a general topic.

For EACH legal point provide:
- issue_title: short name (e.g. "Article 300A Violation", "Absence of Statutory Notice")
- proposition: ONE sentence — "When [authority] did [wrongdoing] without [procedure], it violates [right/statute]"
- wrongdoing: what the authority/party did wrong (specific act or omission)
- legal_right: which constitutional article or statutory right is violated
- acts_involved: exact Acts and sections (e.g. ["Article 300A", "LARR Act 2013 s11"])
- remedy: what relief is sought for this issue

Also extract:
- parties: petitioner name and respondent name
- case_type: "writ petition" / "civil appeal" / "criminal appeal" / "suit" etc
- jurisdiction: which court (Supreme Court / High Court name)

Return ONLY this JSON (extract 3–8 issues, covering EVERY distinct legal argument):
{{
  "parties": {{"petitioner": "...", "respondent": "..."}},
  "case_type": "...",
  "jurisdiction": "...",
  "issues": [
    {{
      "issue_title": "Article 300A Violation",
      "proposition": "When the State of X took possession of land without initiating acquisition under LARR Act 2013, it violated Article 300A of the Constitution",
      "wrongdoing": "Took possession of private land without acquisition proceedings or compensation",
      "legal_right": "Right to property under Article 300A",
      "acts_involved": ["Article 300A Constitution of India", "LARR Act 2013 s11"],
      "remedy": "Compensation and restoration of title"
    }},
    {{
      "issue_title": "Absence of Section 11 Notification",
      "proposition": "...",
      ...
    }}
  ]
}}"""

    try:
        result = await claude_complete_json(system=system, user=user, max_tokens=2000)
        if not isinstance(result, dict) or not result.get("issues"):
            raise ValueError("no issues extracted")
    except Exception as exc:
        pipeline_log(run_id, "PropositionExtractor", f"Extraction fallback: {exc}", "warning")
        result = {
            "parties": {"petitioner": "Petitioner", "respondent": "Respondent"},
            "case_type": "writ petition",
            "jurisdiction": "High Court",
            "issues": [{
                "issue_title": "Main Legal Issue",
                "proposition": query,
                "wrongdoing": query,
                "legal_right": "Constitutional right",
                "acts_involved": [],
                "remedy": "Relief as prayed",
            }],
        }

    issues = result.get("issues", [])
    pipeline_log(run_id, "PropositionExtractor",
                 f"Extracted {len(issues)} legal points:")
    for i, iss in enumerate(issues):
        pipeline_log(run_id, "PropositionExtractor",
                     f"  [{i+1}] {iss.get('issue_title', '')} — {iss.get('proposition', '')[:100]}")

    # Attach a primary_proposition (first / most important issue) for quick_validate context
    result["primary_proposition"] = issues[0] if issues else {}
    return result


# ---------------------------------------------------------------------------
# Step 2 — Generate Proposition-Based Queries
# ---------------------------------------------------------------------------

# Indian legal judgment sites — used in Serper site-restricted queries
_LEGAL_SITES_OR = (
    "site:indiankanoon.org OR site:sci.gov.in OR site:judis.nic.in "
    "OR site:casemine.com OR site:livelaw.in OR site:barandbench.com"
)
_IK_SITE = "site:indiankanoon.org"
_SC_SITE = "site:sci.gov.in OR site:judis.nic.in"
_CASEMINE = "site:casemine.com"
_NEWS_LEGAL = "site:livelaw.in OR site:barandbench.com"


async def generate_queries(
    legal_points: Dict[str, Any],
    run_id: str,
) -> Dict[str, List[str]]:
    """Generate search queries for EVERY legal issue extracted from the case.

    Produces 2 Serper queries per issue (across multiple legal sites) +
    1 IK keyword query per issue. All deduplicated.
    """
    pipeline_log(run_id, "QueryGenerator", "Generating queries for all legal points")

    issues = legal_points.get("issues", [])
    if not issues:
        issues = [legal_points.get("primary_proposition", {})]

    system = (
        "You are an Indian legal research specialist. "
        "Generate SIMPLE search queries — 3-6 keywords each, at most ONE quoted phrase. "
        "Do NOT chain multiple quoted phrases. They return zero results."
    )

    all_serper: List[str] = []
    all_ik: List[str] = []

    for iss in issues[:6]:  # cap at 6 issues
        prop      = iss.get("proposition", "")
        wrongdoing= iss.get("wrongdoing", "")
        right     = iss.get("legal_right", "")
        acts      = iss.get("acts_involved", [])
        title     = iss.get("issue_title", "")
        act_labels= [a.split(" s")[0].split(" §")[0].strip() for a in acts[:2]]
        key_act   = act_labels[0] if act_labels else right[:30]

        user = f"""Legal issue: {title}
Proposition: {prop}
Wrongdoing: {wrongdoing}
Right violated: {right}
Acts/sections: {act_labels}

Generate queries for this specific issue.

2 SERPER QUERIES — use different site prefixes:
  Options: "site:indiankanoon.org" | "site:sci.gov.in OR site:judis.nic.in" | "site:casemine.com" | "site:livelaw.in OR site:barandbench.com"
  Rules: 3-5 keywords after site prefix, at most ONE quoted phrase
  Examples:
    site:indiankanoon.org "Article 300A" acquisition compensation without notice
    site:sci.gov.in OR site:judis.nic.in land acquisition without compensation Supreme Court

2 IK API QUERIES — pure keywords, no operators:
  Rules: 3-7 words, natural language, NO site: or quotes
  Examples:
    Article 300A property acquisition without compensation
    land acquisition proceedings notice violation writ

Return ONLY this JSON:
{{"serper": ["query1", "query2"], "ik": ["kw1", "kw2"]}}"""

        try:
            r = await claude_complete_json(system=system, user=user, max_tokens=300)
            sq = r.get("serper", []) if isinstance(r, dict) else []
            iq = r.get("ik", []) if isinstance(r, dict) else []
        except Exception:
            sq = [f"{_IK_SITE} {key_act} {wrongdoing[:35]}", f"{_SC_SITE} {key_act} compensation judgment"]
            iq = [f"{key_act} {wrongdoing[:40]}", f"{right[:30]} compensation writ"]

        all_serper.extend(sq[:2])
        all_ik.extend(iq[:2])

    # Deduplicate preserving order
    seen: set = set()
    serper_queries = [q for q in all_serper if q and not (q in seen or seen.add(q))]  # type: ignore[func-returns-value]
    seen = set()
    ik_queries = [
        re.sub(r"site:\S+\s*", "", q).strip()
        for q in all_ik
        if q and not (q in seen or seen.add(q))  # type: ignore[func-returns-value]
    ]

    # Cap to avoid too many API calls; add a broad IK sweep as last resort
    serper_queries = serper_queries[:12]
    ik_queries     = ik_queries[:8]

    pipeline_log(run_id, "QueryGenerator",
                 f"Generated {len(serper_queries)} Serper + {len(ik_queries)} IK queries "
                 f"covering {len(issues)} legal issues")
    for i, q in enumerate(serper_queries):
        pipeline_log(run_id, "QueryGenerator", f"  S{i+1}: {q}")
    for i, q in enumerate(ik_queries):
        pipeline_log(run_id, "QueryGenerator", f"  IK{i+1}: {q}")

    return {"serper": serper_queries, "ik": ik_queries}


# ---------------------------------------------------------------------------
# Step 3 — Domain-Restricted Search
# ---------------------------------------------------------------------------

async def search_domain_restricted(
    query_sets: Dict[str, List[str]],
    run_id: str,
) -> List[Dict[str, Any]]:
    """Run Serper + IK queries in parallel using separate, appropriately simple query sets."""
    from tools.serper_search import search_google_serper
    from tools.ik_search import search_indian_kanoon

    serper_queries = query_sets.get("serper", [])
    ik_queries     = query_sets.get("ik", [])

    pipeline_log(run_id, "SearchAgent",
                 f"Running {len(serper_queries)} Serper + {len(ik_queries)} IK queries in parallel")

    serper_tasks = [search_google_serper(q, num_results=10) for q in serper_queries]
    ik_tasks     = [search_indian_kanoon(q, page_num=0) for q in ik_queries]

    all_results = await asyncio.gather(*serper_tasks, *ik_tasks, return_exceptions=True)

    raw: List[Dict[str, Any]] = []
    for r in all_results:
        if not isinstance(r, Exception):
            raw.extend(r.get("results", []))

    # Deduplicate; IK results first (higher quality)
    seen_urls: set = set()
    ik_results, other_results = [], []
    for item in raw:
        url = item.get("url", "")
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        if "indiankanoon.org" in url:
            ik_results.append(item)
        else:
            other_results.append(item)

    deduped = ik_results + other_results
    pipeline_log(run_id, "SearchAgent",
                 f"Found {len(deduped)} unique results "
                 f"({len(ik_results)} IK, {len(other_results)} other)")
    return deduped


# ---------------------------------------------------------------------------
# Step 4 — Quick YES/NO Validation Filter
# ---------------------------------------------------------------------------

async def quick_validate(
    legal_points: Dict[str, Any],
    results: List[Dict[str, Any]],
    run_id: str,
) -> List[Dict[str, Any]]:
    """Batch YES/NO filter against ALL legal issues extracted from the case.

    A result passes if it is relevant to ANY of the case's legal points.
    """
    if not results:
        return []

    pipeline_log(run_id, "ValidatorAgent",
                 f"Quick-validating {len(results)} results against all legal points")

    issues = legal_points.get("issues", [legal_points.get("primary_proposition", {})])

    # Build a concise summary of all legal issues for the filter prompt
    issues_summary = "\n".join(
        f"  [{i+1}] {iss.get('issue_title','')}: {iss.get('proposition','')[:120]}"
        for i, iss in enumerate(issues[:6])
    )
    all_rights = list({iss.get("legal_right", "") for iss in issues if iss.get("legal_right")})
    all_acts   = list({a for iss in issues for a in iss.get("acts_involved", [])})

    batch_lines = []
    for i, r in enumerate(results):
        batch_lines.append(
            f"[{i}] {r.get('title', '')}\n"
            f"    {r.get('snippet', '')[:200]}"
        )
    batch_text = "\n\n".join(batch_lines)

    system = (
        "You are a legal relevance filter. "
        "Answer YES or NO for each result — no explanations needed."
    )
    user = f"""My case has these legal issues:
{issues_summary}

Rights involved: {all_rights}
Acts/sections involved: {all_acts[:8]}

For each search result, answer YES if it is a real court judgment relevant to ANY of the above legal issues.

Say YES if the judgment:
- Interprets or applies any of the Acts/sections listed
- Deals with any of the constitutional/statutory rights listed
- Addresses a similar wrongdoing by a government authority
- Establishes a legal principle a court would cite in this case

Say NO only if:
- It is clearly a news article, commentary, or non-judgment
- It involves a completely unrelated area of law
- It is a private commercial dispute with no state action

When in doubt, say YES.

Results:
{batch_text}

Return ONLY a JSON array:
[{{"index": 0, "relevant": true}}, {{"index": 1, "relevant": false}}, ...]"""

    try:
        decisions = await claude_complete_json(system=system, user=user, max_tokens=1000)
        if not isinstance(decisions, list):
            decisions = decisions.get("decisions", []) if isinstance(decisions, dict) else []
    except Exception as exc:
        pipeline_log(run_id, "ValidatorAgent", f"Validation fallback: {exc}", "warning")
        return [r for r in results if "indiankanoon.org" in r.get("url", "")][:15]

    relevant_indices = {d["index"] for d in decisions if d.get("relevant")}
    filtered = [r for i, r in enumerate(results) if i in relevant_indices]

    pipeline_log(run_id, "ValidatorAgent",
                 f"Quick filter: {len(results)} → {len(filtered)} "
                 f"(removed {len(results) - len(filtered)} irrelevant)")
    return filtered


# ---------------------------------------------------------------------------
# Step 5 — Fetch Full Texts (top 15 validated results)
# ---------------------------------------------------------------------------

async def fetch_full_texts(
    results: List[Dict[str, Any]],
    run_id: str,
    max_fetch: int = 15,
) -> List[Dict[str, Any]]:
    """Fetch full judgment text for the top validated results."""
    from tools.ik_search import fetch_ik_document

    candidates = results[:max_fetch]
    pipeline_log(run_id, "FetchAgent", f"Fetching full text for {len(candidates)} results")

    async def _fetch(item: Dict) -> Dict:
        url = item.get("url", "")
        if "indiankanoon.org/doc/" in url:
            m = re.search(r"/doc/(\d+)", url)
            if m:
                doc = await fetch_ik_document(m.group(1))
                return {
                    **item,
                    "full_text":  doc.get("full_text", ""),
                    "doc_id":     f"ik:{m.group(1)}",
                    "court":      doc.get("court", item.get("court", "")),
                    "date":       doc.get("date", item.get("date", "")),
                    "headnotes":  doc.get("headnotes", ""),
                    "bench":      doc.get("bench", ""),
                    "ik_citation": doc.get("ik_citation", ""),
                }
        return {**item, "full_text": item.get("snippet", ""), "headnotes": ""}

    fetched = await asyncio.gather(*[_fetch(r) for r in candidates], return_exceptions=True)

    enriched = []
    for orig, result in zip(candidates, fetched):
        if isinstance(result, Exception):
            enriched.append({**orig, "full_text": orig.get("snippet", "")})
        else:
            enriched.append(result)

    pipeline_log(run_id, "FetchAgent",
                 f"Fetched {sum(1 for r in enriched if len(r.get('full_text',''))>200)} "
                 f"with substantial text")
    return enriched


# ---------------------------------------------------------------------------
# Step 6 — Deep Validate and Score
# ---------------------------------------------------------------------------

async def deep_validate_and_score(
    legal_points: Dict[str, Any],
    results: List[Dict[str, Any]],
    run_id: str,
    score_threshold: int = 7,
) -> List[Dict[str, Any]]:
    """Validate each result against ALL legal issues. Score 1-10; keep ≥ threshold."""
    pipeline_log(run_id, "DeepValidator",
                 f"Deep-validating {len(results)} results (threshold: {score_threshold}/10)")

    issues     = legal_points.get("issues", [legal_points.get("primary_proposition", {})])
    prop_text  = " | ".join(i.get("proposition", "") for i in issues[:3])
    acts       = list({a for iss in issues for a in iss.get("acts_involved", [])})
    wrongdoing = " / ".join(i.get("wrongdoing", "") for i in issues[:3] if i.get("wrongdoing"))
    remedy     = issues[0].get("remedy", "") if issues else ""

    system = (
        "You are a senior Indian advocate and legal researcher. "
        "Evaluate whether a judgment is relevant to the case and extract its key legal points "
        "in a form a court can directly cite."
    )

    async def _score_one(item: Dict) -> Optional[Dict]:
        full_text = item.get("full_text", item.get("snippet", ""))
        existing_headnotes = item.get("headnotes", "")
        if not full_text or len(full_text) < 50:
            return None

        headnotes_block = (
            f"\nHeadnotes from IK:\n{existing_headnotes[:800]}"
            if existing_headnotes else ""
        )

        user = f"""My case legal issues:
{prop_text[:600]}

Acts/sections involved: {acts[:6]}
Wrongdoing: {wrongdoing[:200]}

Judgment to evaluate:
Title: {item.get('title', '')}
URL: {item.get('url', '')}
{headnotes_block}
Full text (first 4000 chars):
{full_text[:4000]}

Evaluate this judgment and extract its key legal points.

Return ONLY this JSON:
{{
  "case_name": "Full Party A v Party B",
  "citation": "AIR/SCC citation e.g. (2020) 2 SCC 569 — write Unknown if not visible",
  "relevance_score": 8,
  "factual_match": true,
  "legal_issue_match": true,
  "which_issue": "Which of the case's legal issues does this judgment address?",

  "ratio_points": [
    "Point 1: The exact legal principle/holding stated by the court (verbatim quote preferred)",
    "Point 2: Second distinct principle if any",
    "Point 3: Third distinct principle if any"
  ],

  "headnote": "A single concise paragraph summarising what this judgment decided — written as a headnote a law reporter would write. Include: facts in 1 sentence, legal issue, court's holding, statute applied.",

  "excerpt": "The single most powerful sentence or passage from the judgment text that supports this case (verbatim, max 350 chars)"
}}

SCORING GUIDE:
10 = Landmark case — identical facts + same legal issue
8-9 = Very similar facts OR directly decides the same legal question
7   = Related principle, distinguishable facts but clearly citable
5-6 = Tangentially related — touches the area
1-4 = Not relevant, private dispute, or not a real judgment

Score below 7 if facts are about a completely different wrongdoing or it is commentary."""

        try:
            v = await claude_complete_json(system=system, user=user, max_tokens=1200)
        except Exception:
            return None

        score = int(v.get("relevance_score", 0))
        if score < score_threshold:
            return None

        # Build ratio as numbered points separated by newlines (frontend parses into bullets)
        ratio_points = v.get("ratio_points", [])
        if ratio_points:
            ratio_text = "\n".join(
                f"{i+1}. {pt}" for i, pt in enumerate(ratio_points) if pt
            )
        else:
            ratio_text = v.get("applicable_holding", "")

        # Prefer IK-fetched headnotes; fall back to Claude-generated headnote
        headnote_text = existing_headnotes or v.get("headnote", "")

        return {
            **item,
            "caseName":        v.get("case_name") or item.get("title", ""),
            "primaryCitation": v.get("citation", item.get("ik_citation", "")),
            "ratio":           ratio_text,
            "headnote":        headnote_text[:1000],
            "headnotes":       existing_headnotes[:2000] if existing_headnotes else v.get("headnote", ""),
            "excerptText":     (v.get("excerpt") or v.get("applicable_holding") or item.get("snippet", ""))[:350],
            "relevanceScore":  round(score / 10.0, 2),
            "which_issue":     v.get("which_issue", ""),
            "factual_match":   v.get("factual_match", False),
            "legal_match":     v.get("legal_issue_match", False),
        }

    tasks = [_score_one(r) for r in results]
    scored = await asyncio.gather(*tasks, return_exceptions=True)

    valid = [r for r in scored if r and not isinstance(r, Exception)]
    valid.sort(key=lambda x: x.get("relevanceScore", 0), reverse=True)

    pipeline_log(run_id, "DeepValidator",
                 f"Deep validation: {len(results)} → {len(valid)} "
                 f"(scored ≥ {score_threshold}/10)")
    for r in valid[:5]:
        pipeline_log(run_id, "DeepValidator",
                     f"  ✓ [{r['relevanceScore']:.1f}] {r.get('caseName','')[:60]}")
    return valid


# ---------------------------------------------------------------------------
# Step 7 — Build Report Format
# ---------------------------------------------------------------------------

def _build_report_format(
    citations: List[Dict[str, Any]],
    query: str,
    proposition: Dict[str, Any],
    user_id: str,
    case_id: Optional[str],
    run_id: str,
    perspective: str,
) -> Dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    issues = proposition.get("issues", [])
    primary_prop = issues[0].get("proposition", "") if issues else proposition.get("proposition", "")

    if not citations:
        return {
            "citations": [],
            "generatedAt": now,
            "perspective": perspective,
            "dimensions": [],
            "dimensionGroups": [],
            "metadata": {
                "query": query,
                "proposition": primary_prop,
                "legal_issues": [i.get("issue_title", "") for i in issues],
                "user_id": user_id, "case_id": case_id,
                "run_id": run_id, "status": "completed",
                "citation_count": 0, "generated_at": now,
                "service_version": "v1-proposition", "coverage": {},
            },
        }

    # Group by legal issue the citation addresses; fall back to court tier
    def _dim(c: Dict) -> tuple:
        which = c.get("which_issue", "").strip()
        if which and len(which) > 5:
            name = which[:50]
        else:
            acts = c.get("statutes", [])
            if acts:
                name = acts[0].split("§")[0].split(" s")[0].strip()[:40]
            elif "Supreme Court" in c.get("court", ""):
                name = "Supreme Court Precedents"
            elif "High Court" in c.get("court", ""):
                name = "High Court Precedents"
            else:
                name = "General"
        dim_id = re.sub(r"[^a-z0-9]", "_", name.lower())[:30]
        return dim_id, name

    dim_map: Dict[str, Dict] = {}
    final_cits: List[Dict] = []

    for c in citations:
        cid = str(uuid.uuid4())
        dim_id, dim_name = _dim(c)
        url = c.get("url", c.get("sourceUrl", ""))
        ik_m = re.search(r"indiankanoon\.org/doc/(\d+)", url)

        # Statutes — prefer from deep validation via acts_involved on the matched issue
        all_acts = list({
            a for iss in proposition.get("issues", [])
            for a in iss.get("acts_involved", [])
        }) or proposition.get("acts_involved", [])

        entry = {
            "id": cid,
            "caseName":        c.get("caseName", c.get("title", "")),
            "primaryCitation": c.get("primaryCitation", c.get("ik_citation", "")),
            "court":           c.get("court", ""),
            "date":            c.get("date", ""),
            "bench":           c.get("bench", ""),
            "statutes":        c.get("statutes", all_acts),
            "excerptText":     c.get("excerptText", c.get("snippet", ""))[:350],
            "ratio":           c.get("ratio", ""),
            "headnote":        c.get("headnote", "")[:1000],
            "headnotes":       c.get("headnotes", "")[:2000],
            "which_issue":     c.get("which_issue", ""),
            "relevanceScore":  float(c.get("relevanceScore", 0.7)),
            "argumentParty":   "neutral",
            "sourceUrl":       url,
            "sourceUrls":      [url] if url else [],
            "sourceCitations": [url] if url else [],
            "canonical_id":    f"ik:{ik_m.group(1)}" if ik_m else url,
            "dimensionId":     dim_id,
            "dimensionName":   dim_name,
            "auditStatus":     "UNVERIFIED",
            "verificationStatus": "YELLOW",
            "partyArguments":  {"appellant": [], "respondent": [], "court": ""},
            "treatment":       {"followedList": [], "distinguishedList": [], "overruledList": []},
            "ikCiteList": [], "ikCitedByList": [],
        }
        final_cits.append(entry)

        if dim_id not in dim_map:
            dim_map[dim_id] = {"dimension_id": dim_id, "name": dim_name,
                               "reasoning": "", "citations": []}
        dim_map[dim_id]["citations"].append(cid)

    courts = list({c.get("court", "") for c in final_cits if c.get("court")})
    years = [int(c["date"][:4]) for c in final_cits
             if c.get("date") and c["date"][:4].isdigit()]
    coverage = {
        "courts": len(courts),
        "court_names": courts[:5],
        "years_span": (max(years) - min(years)) if len(years) >= 2 else 0,
        "earliest": str(min(years)) if years else "",
        "latest": str(max(years)) if years else "",
    }

    dims = list(dim_map.values())
    return {
        "citations": final_cits,
        "generatedAt": now,
        "perspective": perspective,
        "dimensions": dims,
        "dimensionGroups": dims,
        "metadata": {
            "query": query,
            "proposition": proposition.get("proposition", ""),
            "user_id": user_id, "case_id": case_id,
            "run_id": run_id, "status": "completed",
            "citation_count": len(final_cits),
            "generated_at": now,
            "service_version": "v1-proposition",
            "coverage": coverage,
        },
    }


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def _results_to_citations(
    results: List[Dict[str, Any]],
    proposition: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """Convert raw search results to minimal citation dicts when deep validation fails."""
    cits = []
    for r in results:
        url = r.get("url", "")
        ik_m = re.search(r"indiankanoon\.org/doc/(\d+)", url)
        cits.append({
            "caseName":        r.get("title", ""),
            "primaryCitation": "",
            "court":           r.get("court", ""),
            "date":            r.get("date", ""),
            "statutes":        proposition.get("acts_involved", []),
            "excerptText":     r.get("snippet", r.get("full_text", ""))[:350],
            "ratio":           r.get("snippet", "")[:200],
            "relevanceScore":  0.6,
            "argumentParty":   "neutral",
            "url":             url,
            "sourceUrl":       url,
            "canonical_id":    f"ik:{ik_m.group(1)}" if ik_m else url,
        })
    return cits


async def run_proposition_pipeline(
    query: str,
    case_context: str,
    run_id: str,
    perspective: str,
    user_id: str,
    case_id: Optional[str],
) -> Dict[str, Any]:
    """Run the full proposition-based citation pipeline."""

    # 1. Extract ALL legal points from the case document
    legal_points = await extract_all_legal_points(query, case_context, run_id)
    primary = legal_points.get("primary_proposition", legal_points.get("issues", [{}])[0])

    # 2. Generate queries for every legal issue
    query_sets = await generate_queries(legal_points, run_id)

    # 3. Search across multiple legal databases
    raw_results = await search_domain_restricted(query_sets, run_id)

    if not raw_results:
        pipeline_log(run_id, "PropositionPipeline",
                     "⚠ No search results — check SERPER_API_KEY and INDIAN_KANOON_API_TOKEN", "warning")
        return _build_report_format([], query, primary, user_id, case_id, run_id, perspective)

    # 4. Quick YES/NO filter against all legal issues
    validated = await quick_validate(legal_points, raw_results, run_id)

    if not validated:
        pipeline_log(run_id, "PropositionPipeline",
                     "Quick filter removed all — using top IK results", "warning")
        validated = [r for r in raw_results if "indiankanoon.org" in r.get("url", "")][:15]
    if not validated:
        pipeline_log(run_id, "PropositionPipeline",
                     "No IK results — using all raw results", "warning")
        validated = raw_results[:15]

    # 5. Fetch full judgment texts
    enriched = await fetch_full_texts(validated, run_id, max_fetch=20)

    # 6. Deep validate + score against all legal issues (threshold 7)
    scored = await deep_validate_and_score(legal_points, enriched, run_id, score_threshold=7)

    if not scored:
        pipeline_log(run_id, "PropositionPipeline", "Score ≥ 7 gave 0 — relaxing to ≥ 5", "warning")
        scored = await deep_validate_and_score(legal_points, enriched, run_id, score_threshold=5)

    if not scored:
        pipeline_log(run_id, "PropositionPipeline",
                     "Deep validation returned 0 — using validated results without scoring", "warning")
        scored = _results_to_citations(enriched[:15], primary)

    top = scored[:15]
    pipeline_log(run_id, "PropositionPipeline",
                 f"Pipeline complete — {len(top)} citations covering "
                 f"{len(legal_points.get('issues', []))} legal issues")

    # Pass full legal_points so _build_report_format has all issues for statutes/dimensions
    return _build_report_format(top, query, legal_points, user_id, case_id, run_id, perspective)
