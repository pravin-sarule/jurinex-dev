"""Broad Search Pipeline — maximum coverage, no filtering.

Search Serper + Indian Kanoon with multiple query angles, convert ALL
results to citations (no Claude scoring/filtering), return everything
as YELLOW (needs review). Fast and always produces results.

Use when: CITATION_USE_BROAD=true
"""
from __future__ import annotations

import asyncio
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from utils.claude_client import claude_complete_json
from utils.logger import pipeline_log


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

async def _serper(query: str, num: int = 10) -> List[Dict]:
    from tools.serper_search import search_google_serper
    try:
        r = await search_google_serper(query, num_results=num)
        return r.get("results", [])
    except Exception:
        return []


async def _ik(query: str) -> List[Dict]:
    from tools.ik_search import search_indian_kanoon
    try:
        r = await search_indian_kanoon(query, page_num=0)
        return r.get("results", [])
    except Exception:
        return []


async def broad_search(query: str, run_id: str) -> List[Dict]:
    """Run parallel searches across multiple Indian legal databases."""
    pipeline_log(run_id, "BroadSearch", f"Searching: {query[:80]}")

    queries = [
        f"site:indiankanoon.org {query}",
        f"site:sci.gov.in OR site:judis.nic.in {query}",
        f"site:casemine.com {query}",
        f"site:livelaw.in OR site:barandbench.com {query} judgment",
        f"{query} India Supreme Court judgment",
        f"{query} High Court India judgment",
    ]

    tasks = [_serper(q, 10) for q in queries] + [_ik(query), _ik(f"{query} Supreme Court India")]
    all_lists = await asyncio.gather(*tasks, return_exceptions=True)

    seen: set = set()
    results: List[Dict] = []
    for lst in all_lists:
        if isinstance(lst, Exception):
            continue
        for r in lst:
            url = r.get("url", "")
            if url and url not in seen:
                seen.add(url)
                results.append(r)

    pipeline_log(run_id, "BroadSearch", f"Found {len(results)} unique results across IK / SC / CaseMine / LiveLaw / web")
    return results


# ---------------------------------------------------------------------------
# Enrich with Claude (best-effort, no filtering)
# ---------------------------------------------------------------------------

async def enrich_citations(
    results: List[Dict],
    query: str,
    run_id: str,
) -> List[Dict]:
    """Ask Claude to extract structured metadata from snippets — batch, no filtering."""
    if not results:
        return []

    pipeline_log(run_id, "Enricher", f"Enriching {len(results)} results with Claude")

    batch = "\n\n".join(
        f"[{i+1}] Title: {r.get('title','')}\n"
        f"URL: {r.get('url','')}\n"
        f"Court: {r.get('court','')}\n"
        f"Date: {r.get('date','')}\n"
        f"Snippet: {r.get('snippet','')[:300]}"
        for i, r in enumerate(results[:20])
    )

    system = (
        "You are a legal citation extractor. "
        "Extract structured metadata from Indian court judgment snippets. "
        "Include ALL results that look like actual court judgments — do not filter."
    )
    user = f"""Query: {query}

Search results:
{batch}

For every result that appears to be an actual court judgment, extract metadata.
Include results even if information is partial.

Return a JSON array (one object per judgment found):
[
  {{
    "index": 1,
    "caseName": "Party A v Party B",
    "primaryCitation": "AIR/SCC citation if visible",
    "court": "Supreme Court of India | High Court | etc",
    "date": "YYYY or YYYY-MM-DD",
    "statutes": ["Act name section"],
    "excerptText": "Most relevant sentence from snippet (max 300 chars)",
    "ratio": "Key legal principle if visible (max 200 chars)"
  }}
]

If a result is clearly NOT a judgment (news article, forum post), skip it.
Return the array even if only 1-2 results are judgments."""

    try:
        enriched = await claude_complete_json(system=system, user=user, max_tokens=3000)
        if not isinstance(enriched, list):
            enriched = enriched.get("citations", []) if isinstance(enriched, dict) else []
    except Exception as exc:
        pipeline_log(run_id, "Enricher", f"Claude enrichment failed: {exc} — using raw snippets", "warning")
        enriched = []

    # Merge Claude metadata back onto original results
    by_index = {e.get("index", 0): e for e in enriched}
    merged: List[Dict] = []
    for i, r in enumerate(results[:20]):
        meta = by_index.get(i + 1, {})
        merged.append({**r, **{k: v for k, v in meta.items() if v}})

    pipeline_log(run_id, "Enricher", f"Enriched {len(merged)} results")
    return merged


# ---------------------------------------------------------------------------
# Build report format
# ---------------------------------------------------------------------------

def _build_report(
    results: List[Dict],
    query: str,
    user_id: str,
    case_id: Optional[str],
    run_id: str,
    perspective: str,
) -> Dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    if not results:
        return {
            "citations": [],
            "generatedAt": now,
            "perspective": perspective,
            "dimensions": [],
            "dimensionGroups": [],
            "metadata": {
                "query": query, "user_id": user_id, "case_id": case_id,
                "run_id": run_id, "status": "completed", "citation_count": 0,
                "generated_at": now, "service_version": "v1-broad", "coverage": {},
            },
        }

    # Group by court tier
    def _tier(r: Dict) -> tuple:
        court = str(r.get("court", "")).lower()
        if "supreme" in court:
            return "sc", "Supreme Court"
        if "high" in court:
            return "hc", "High Court"
        if "tribunal" in court or "nclat" in court or "ncdrc" in court:
            return "tribunal", "Tribunal / Commission"
        return "other", "Other Courts"

    dim_map: Dict[str, Dict] = {}
    final_cits: List[Dict] = []

    for r in results:
        cid = str(uuid.uuid4())
        url = r.get("url", r.get("sourceUrl", ""))
        ik_m = re.search(r"indiankanoon\.org/doc/(\d+)", url)
        dim_id, dim_name = _tier(r)

        entry: Dict[str, Any] = {
            "id": cid,
            "caseName":        r.get("caseName") or r.get("title", ""),
            "primaryCitation": r.get("primaryCitation", ""),
            "court":           r.get("court", ""),
            "date":            r.get("date", ""),
            "statutes":        r.get("statutes", []),
            "excerptText":     (r.get("excerptText") or r.get("snippet", ""))[:350],
            "ratio":           r.get("ratio", r.get("snippet", ""))[:200],
            "relevanceScore":  float(r.get("relevanceScore", 0.6)),
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
             if c.get("date") and len(c["date"]) >= 4 and c["date"][:4].isdigit()]
    coverage = {
        "courts": len(courts),
        "court_names": courts[:8],
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
            "query": query, "user_id": user_id, "case_id": case_id,
            "run_id": run_id, "status": "completed",
            "citation_count": len(final_cits),
            "generated_at": now,
            "service_version": "v1-broad",
            "coverage": coverage,
        },
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

async def run_broad_pipeline(
    query: str,
    case_context: str,
    run_id: str,
    perspective: str,
    user_id: str,
    case_id: Optional[str],
) -> Dict[str, Any]:
    """Broad search + Claude enrichment — no filtering, maximum coverage."""

    # If case context present, build a richer query
    search_query = query
    if case_context and len(case_context) > 50:
        # Extract key terms from case context to augment the query
        try:
            system = "Extract 5-8 key legal search terms from this case context for Indian court search."
            user_msg = f"Case: {case_context[:1500]}\nQuery: {query}\n\nReturn a single search string combining the most important legal terms."
            augmented = await claude_complete_json(system=system, user=user_msg, max_tokens=150)
            if isinstance(augmented, str) and len(augmented) > 10:
                search_query = augmented
            elif isinstance(augmented, dict):
                search_query = augmented.get("query", query) or query
        except Exception:
            pass
        pipeline_log(run_id, "BroadSearch", f"Search query: {search_query[:100]}")

    # Search
    results = await broad_search(search_query, run_id)

    if not results:
        pipeline_log(run_id, "BroadSearch", "⚠ No results — check SERPER_API_KEY / INDIAN_KANOON_API_TOKEN", "warning")
        return _build_report([], query, user_id, case_id, run_id, perspective)

    # Enrich with Claude (best-effort)
    enriched = await enrich_citations(results, query, run_id)

    pipeline_log(run_id, "BroadSearch", f"Pipeline complete — {len(enriched)} citations")
    return _build_report(enriched, query, user_id, case_id, run_id, perspective)
