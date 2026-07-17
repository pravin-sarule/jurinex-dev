"""
Autonomous Citation Research — orchestrator (no google.adk dependency).

Architecture flow (matches diagram exactly):

  INPUT  — case query + case context
  GATE   — Case Analyzer: extract legal issues, parties, jurisdiction
  LOOP   — until sufficient citations OR budget exhausted:
    Stage 1  — Budget Guard (iterations / latency)
    Stage 2  — Query Planner (Flash)
    Stage 3a — Constrained Search (google_search + site: operators)
    Stage 3b — Allowlist Filter (T1/T2 kept, T3 + off-list dropped)
    Stage 4  — Extractor Agent (parties, court, year, citation, ratio, tier, url)
    Stage 5  — Relevance Critic → exit loop if sufficient, else gap-fill back to Stage 2
  Stage 6  — Verification + Confidence Grading (HIGH / MEDIUM / BLOCKED)
  OUTPUT   — verified citations + research gaps
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Any, Dict, List, Optional, Type

from pydantic import BaseModel

from agents.autonomous_citation_agent.case_analyzer import INSTRUCTION as CASE_ANALYZER_INSTRUCTION, MODEL as CASE_ANALYZER_MODEL
from agents.autonomous_citation_agent.citation_validator import INSTRUCTION as VALIDATOR_INSTRUCTION, MODEL as VALIDATOR_MODEL
from agents.autonomous_citation_agent.citation_extractor import EXTRACT_INSTRUCTION, MODEL as EXTRACTOR_MODEL
from agents.autonomous_citation_agent.quality_critic import CRITIC_INSTRUCTION, MODEL as CRITIC_MODEL
from agents.autonomous_citation_agent.query_planner import INSTRUCTION as QUERY_PLANNER_INSTRUCTION, MODEL as QUERY_PLANNER_MODEL
from agents.autonomous_citation_agent.research_decomposer import DECOMPOSE_INSTRUCTION, MODEL as DECOMPOSER_MODEL
from agents.autonomous_citation_agent.schema import CaseAnalysis, CitationListOutput, DeepResearchPlan, QueryPlanOutput
from agents.autonomous_citation_agent.grounding_search import run_authorized_search

logger = logging.getLogger(__name__)

_DEFAULT_MAX_ITER = int(os.environ.get("CITATION_AUTO_MAX_ITERATIONS", "4"))
_DEFAULT_LATENCY = int(os.environ.get("CITATION_AUTO_LATENCY_BUDGET_MS", "300000"))  # 5 min default


def _db_log(run_id: Optional[str], agent: str, stage: str, msg: str, level: str = "INFO",
            meta: Optional[Dict[str, Any]] = None) -> None:
    if not run_id:
        return
    try:
        from db.client import agent_log_insert
        agent_log_insert(run_id, None, agent, stage, level, msg, meta)
    except Exception:
        pass


def _log_stage(run_id: Optional[str], stage: str, detail: str = "", agent: str = "CitationAgent") -> None:
    banner = f"[CITATION AGENT] -- {stage}"
    print(banner, flush=True)
    if detail:
        print(f"           {detail}", flush=True)
    _db_log(run_id, agent, stage.lower().replace(" ", "_").replace("—", "").strip(),
            f"{stage}" + (f" — {detail}" if detail else ""))


def _format_prompt(template: str, state: Dict[str, Any]) -> str:
    out = template
    for key, val in state.items():
        placeholder = "{" + key + "}"
        if placeholder in out:
            if isinstance(val, (dict, list)):
                text = json.dumps(val, ensure_ascii=False, indent=2)
            else:
                text = str(val or "")
            out = out.replace(placeholder, text)
    return out


def _strip_json(text: str) -> str:
    text = re.sub(r"^```(?:json)?\s*", "", (text or "").strip())
    text = re.sub(r"```\s*$", "", text)
    text = text.strip()
    # Find first { or [ — whichever comes first in the text
    brace_pos = text.find("{")
    bracket_pos = text.find("[")
    if bracket_pos != -1 and (brace_pos == -1 or bracket_pos < brace_pos):
        end = text.rfind("]")
        if end > bracket_pos:
            return text[bracket_pos:end + 1]
    if brace_pos != -1:
        end = text.rfind("}")
        if end > brace_pos:
            return text[brace_pos:end + 1]
    return text


def _parse_json_loose(text: str) -> Optional[Any]:
    if not text:
        return None
    raw = _strip_json(text)
    for attempt in (raw, re.sub(r",\s*}", "}", raw), re.sub(r",\s*]", "]", raw)):
        try:
            return json.loads(attempt)
        except Exception:
            continue
    return None


def _gemini_call(
    prompt: str,
    model: str,
    max_tokens: int = 4096,
    temperature: float = 0.1,
    run_id: Optional[str] = None,
    user_id: Optional[str] = None,
    operation: str = "citation_agent",
) -> Optional[str]:
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        logger.warning("[CITATION_AGENT] GEMINI_API_KEY not set")
        return None
    _RETRY_DELAYS = [3, 7, 15]
    last_exc: Optional[Exception] = None
    for attempt, delay in enumerate([0] + _RETRY_DELAYS):
        if delay:
            time.sleep(delay)
        try:
            from google import genai
            client = genai.Client(api_key=api_key)
            resp = client.models.generate_content(
                model=model,
                contents=prompt,
                config=genai.types.GenerateContentConfig(
                    temperature=temperature,
                    max_output_tokens=max_tokens,
                ),
            )
            if run_id or user_id:
                try:
                    usage_meta = getattr(resp, "usage_metadata", None)
                    ti = int(getattr(usage_meta, "prompt_token_count", 0) or 0)
                    to = int(getattr(usage_meta, "candidates_token_count", 0) or 0)
                    from utils.usage_tracker import record_gemini
                    record_gemini(run_id, user_id or "anonymous", operation,
                                  tokens_in=ti, tokens_out=to, model=model)
                except Exception:
                    pass
            return (resp.text or "").strip() or None
        except Exception as exc:
            last_exc = exc
            msg = str(exc)
            if any(x in msg for x in ("429", "RESOURCE_EXHAUSTED", "503", "UNAVAILABLE")):
                continue
            logger.warning("[CITATION_AGENT] Gemini call failed: %s", exc)
            return None
    logger.warning("[CITATION_AGENT] Gemini failed after retries: %s", last_exc)
    return None


def _gemini_json(
    prompt: str,
    model: str,
    schema: Optional[Type[BaseModel]] = None,
    run_id: Optional[str] = None,
    user_id: Optional[str] = None,
    operation: str = "citation_agent",
) -> Optional[Dict[str, Any]]:
    schema_hint = ""
    if schema:
        schema_hint = f"\n\nOutput ONLY valid JSON matching this schema:\n{schema.model_json_schema()}"
    text = _gemini_call(prompt + schema_hint, model, run_id=run_id, user_id=user_id, operation=operation)
    if not text:
        return None
    parsed = _parse_json_loose(text)
    if parsed is None:
        logger.warning("[CITATION_AGENT] JSON parse failed for %s", operation)
        return None
    if schema and isinstance(parsed, dict):
        try:
            return schema.model_validate(parsed).model_dump()
        except Exception as exc:
            logger.warning("[CITATION_AGENT] Schema validation failed for %s: %s", operation, exc)
            return parsed
    return parsed if isinstance(parsed, dict) else None


def _issues_to_string(case_analysis_raw: Any) -> str:
    if not case_analysis_raw:
        return ""
    if isinstance(case_analysis_raw, str):
        try:
            ca = json.loads(case_analysis_raw)
        except Exception:
            return str(case_analysis_raw)[:1000]
    else:
        ca = case_analysis_raw or {}
    issues = ca.get("issues") or []
    if not issues:
        return ca.get("case_fact_summary", "") or ""
    lines = []
    for i, iss in enumerate(issues, 1):
        acts = ", ".join(iss.get("acts_involved") or [])
        lines.append(
            f"Issue {i}: {iss.get('issue_title', '')}\n"
            f"  Proposition: {iss.get('proposition', '')}\n"
            f"  Acts: {acts or 'N/A'}\n"
            f"  Facts: {iss.get('fact_summary', '')}"
        )
    jurisdiction = ca.get("jurisdiction", "")
    if jurisdiction:
        lines.append(f"\nJurisdiction: {jurisdiction}")
    return "\n\n".join(lines)


def _count_candidates(state: Dict[str, Any]) -> int:
    return len(_parse_candidates(state))


def _parse_candidates(state: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw = state.get("citation_candidates") or "[]"
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return list(parsed.get("citations") or [])
            if isinstance(parsed, list):
                return list(parsed)
        except Exception:
            return []
    return list(raw) if isinstance(raw, list) else []


def _set_candidates(state: Dict[str, Any], candidates: List[Dict[str, Any]]) -> None:
    state["citation_candidates"] = json.dumps(candidates, ensure_ascii=False)


def _budget_guard(state: Dict[str, Any]) -> bool:
    """Stage 1 — returns True if loop must stop (budget exhausted)."""
    budget: Dict[str, Any] = dict(state.get("budget_state") or {})
    max_iter = int(budget.get("max_iterations", _DEFAULT_MAX_ITER))
    latency_ms = int(budget.get("latency_budget_ms", _DEFAULT_LATENCY))
    start_ts = float(budget.get("start_ts", time.time()))

    current_iter = int(state.get("iteration", 0)) + 1
    state["iteration"] = current_iter
    budget["iterations_used"] = current_iter
    state["budget_state"] = budget

    elapsed_ms = (time.time() - start_ts) * 1000
    issue_str = _issues_to_string(state.get("case_analysis") or "{}")
    if not issue_str:
        issue_str = state.get("case_query", "Legal research query")
    state["issue"] = issue_str

    n = _count_candidates(state)
    run_id = state.get("run_id")
    detail = f"iteration {current_iter}/{max_iter} | candidates={n} | elapsed={elapsed_ms:.0f}ms"
    _log_stage(run_id, "Stage 1 — Budget Guard", detail, agent="budget_guard")

    reason = ""
    if current_iter > max_iter:
        reason = f"max iterations ({max_iter}) reached"
    elif elapsed_ms >= latency_ms:
        reason = f"latency budget ({latency_ms}ms) exceeded"

    if reason:
        state["budget_exhausted"] = True
        state["budget_exhaustion_reason"] = reason
        gaps: List[str] = list(state.get("research_gaps") or [])
        gaps.append(reason)
        state["research_gaps"] = gaps
        print(f"[CITATION AGENT] Budget exhausted: {reason}", flush=True)
        _db_log(run_id, "budget_guard", "exhausted", reason, "WARNING")
        return True
    return False


def _run_upstream_gate(state: Dict[str, Any]) -> None:
    """Upstream gate — extract legal issues, parties, jurisdiction from case context."""
    run_id = state.get("run_id")
    _log_stage(run_id, "Upstream Gate — Case Analyzer", state.get("case_query", "")[:80], agent="case_analyzer")
    prompt = _format_prompt(CASE_ANALYZER_INSTRUCTION, state)
    result = _gemini_json(prompt, CASE_ANALYZER_MODEL, CaseAnalysis,
                          run_id=run_id, user_id=state.get("user_id"), operation="case_analyzer")
    if result:
        state["case_analysis"] = json.dumps(result, ensure_ascii=False)
        issues = result.get("issues") or []
        _db_log(run_id, "case_analyzer", "done", f"Extracted {len(issues)} legal issue(s)",
                meta={"issue_count": len(issues), "jurisdiction": result.get("jurisdiction", "")})
    else:
        state["case_analysis"] = "{}"
        _db_log(run_id, "case_analyzer", "failed", "Could not parse case analysis", "WARNING")


def _run_research_decomposer(state: Dict[str, Any]) -> None:
    """Stage 1.5 — decompose the case into 5-7 typed research questions."""
    run_id = state.get("run_id")
    _log_stage(run_id, "Stage 1.5 — Research Decomposer", "generating typed research questions",
               agent="research_decomposer")

    prompt = _format_prompt(DECOMPOSE_INSTRUCTION, state)
    result = _gemini_json(prompt, DECOMPOSER_MODEL, DeepResearchPlan,
                          run_id=run_id, user_id=state.get("user_id"), operation="research_decomposer")

    if result and isinstance(result.get("research_questions"), list):
        questions = result["research_questions"]
        state["research_questions"] = json.dumps(questions, ensure_ascii=False)
        _db_log(
            run_id, "research_decomposer", "done",
            f"Generated {len(questions)} research question(s)",
            meta={
                "questions": [
                    {"type": q.get("type"), "question": q.get("question", "")[:80], "priority": q.get("priority")}
                    for q in questions
                ]
            },
        )
        print(f"[CITATION AGENT]   decomposer: {len(questions)} research questions", flush=True)
        for i, q in enumerate(questions, 1):
            print(f"[CITATION AGENT]     Q{i} [{q.get('type','?')}] P{q.get('priority','?')}: {q.get('question','')[:90]}", flush=True)
    else:
        state["research_questions"] = "[]"
        _db_log(run_id, "research_decomposer", "failed", "Could not generate research questions", "WARNING")
        print("[CITATION AGENT]   decomposer: failed — will proceed with case analysis only", flush=True)


def _run_query_planner(state: Dict[str, Any]) -> List[str]:
    """Stage 2 — generate targeted search queries."""
    run_id = state.get("run_id")
    iteration = int(state.get("iteration", 0))
    _log_stage(run_id, "Stage 2 — Query Planner", f"iteration {iteration}", agent="query_planner")
    prompt = _format_prompt(QUERY_PLANNER_INSTRUCTION, state)
    result = _gemini_json(prompt, QUERY_PLANNER_MODEL, QueryPlanOutput,
                          run_id=run_id, user_id=state.get("user_id"), operation="query_planner")
    queries: List[str] = []
    if result:
        state["planned_queries"] = json.dumps(result, ensure_ascii=False)
        queries = [q.strip() for q in (result.get("queries") or []) if q and q.strip()]

    if queries:
        print(f"[CITATION AGENT]   planner ({len(queries)} queries):", flush=True)
        for i, q in enumerate(queries, 1):
            print(f"[CITATION AGENT]     {i}. {q}", flush=True)
            _db_log(run_id, "query_planner", "planned_query", f"{i}. {q}", meta={"iteration": iteration, "index": i})
    else:
        print("[CITATION AGENT]   planner: no queries generated", flush=True)
        _db_log(run_id, "query_planner", "planned_query", "No queries generated", "WARNING",
                meta={"iteration": iteration})

    _db_log(run_id, "query_planner", "done", f"Planned {len(queries)} search queries",
            meta={"iteration": iteration, "queries": queries})
    return queries


def _enrich_ik_content(results: List[Dict[str, Any]], run_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Fetch full text for indiankanoon.org/doc/ URLs so the extractor has actual case text."""
    enriched = []
    for r in results:
        uri = r.get("uri", "")
        if "indiankanoon.org/doc/" in uri:
            parts = uri.split("/doc/")[1].strip("/").split("/")[0].split("?")[0]
            tid = parts if parts.isdigit() else ""
            if tid:
                try:
                    from services.indiankanoon_client import ik_fetch_doc
                    doc = ik_fetch_doc(tid) or {}
                    title = doc.get("title") or r.get("title", "")
                    content = (doc.get("doc") or "")[:2000]
                    citation = doc.get("citation") or ""
                    court = doc.get("docsource") or ""
                    date = doc.get("publishdate") or ""
                    enriched.append({
                        **r,
                        "title": title,
                        "snippet": content[:300] if content else r.get("snippet", ""),
                        "content": content,
                        "ik_tid": tid,
                        "ik_citation": citation,
                        "ik_court": court,
                        "ik_date": date,
                    })
                    logger.debug("[RUNNER] IK enriched tid=%s: %s", tid, title[:60])
                    continue
                except Exception as exc:
                    logger.debug("[RUNNER] IK fetch skipped for tid=%s: %s", tid, exc)
        enriched.append(r)
    return enriched


def _run_constrained_search(state: Dict[str, Any], queries: List[str]) -> List[Dict[str, Any]]:
    """Stage 3a + 3b — google_search grounding with allowlist hard-filter (T1/T2 only)."""
    run_id = state.get("run_id")
    user_id = state.get("user_id") or "anonymous"
    _log_stage(run_id, "Stage 3a — Constrained Search", f"{len(queries)} queries", agent="source_searcher")

    searched: List[str] = list(state.get("searched_queries") or [])
    citable_results: List[Dict[str, Any]] = []
    dropped_total = 0

    for q in queries:
        if q in searched:
            continue
        searched.append(q)
        state["searched_queries"] = searched
        _db_log(run_id, "source_searcher", "search", f"Query: {q[:120]}")
        print(f"[CITATION AGENT]   search: {q[:80]}", flush=True)

        hits = run_authorized_search(q, num_results=4, run_id=run_id, user_id=user_id, citable_only=True)
        for h in hits:
            if h.authority_tier in ("T1", "T2"):
                citable_results.append({
                    "query": q,
                    "uri": h.uri,
                    "title": h.title,
                    "snippet": h.snippet,
                    "authority_tier": h.authority_tier,
                })
            else:
                dropped_total += 1

        budget = dict(state.get("budget_state") or {})
        budget["searches_used"] = int(budget.get("searches_used", 0)) + 1
        state["budget_state"] = budget

    # Deduplicate by URI before enrichment (same URL may appear across multiple queries)
    seen_uris: set = set()
    unique_results = []
    for r in citable_results:
        if r["uri"] not in seen_uris:
            seen_uris.add(r["uri"])
            unique_results.append(r)
    citable_results = unique_results

    # Enrich IK document URLs with actual case text (fetches via IK API)
    citable_results = _enrich_ik_content(citable_results, run_id=run_id)
    ik_enriched = sum(1 for r in citable_results if r.get("ik_tid"))
    if ik_enriched:
        print(f"[CITATION AGENT]   enriched {ik_enriched} IK document(s) with full text", flush=True)

    _log_stage(
        run_id, "Stage 3b — Allowlist Filter",
        f"{len(citable_results)} T1/T2 kept | T3/off-list dropped",
        agent="allowlist_filter",
    )
    _db_log(
        run_id, "allowlist_filter", "done",
        f"{len(citable_results)} citable result(s) from {len(queries)} queries",
        meta={"citable_count": len(citable_results), "t3_dropped": dropped_total, "ik_enriched": ik_enriched},
    )
    return citable_results


def _run_extractor(state: Dict[str, Any], search_results: List[Dict[str, Any]]) -> None:
    """Stage 4 — extract structured citation candidates from T1/T2 search results."""
    run_id = state.get("run_id")
    if not search_results:
        _log_stage(run_id, "Stage 4 — Extractor Agent", "no citable results to extract", agent="citation_extractor")
        return

    _log_stage(run_id, "Stage 4 — Extractor Agent", f"{len(search_results)} sources", agent="citation_extractor")

    existing = _parse_candidates(state)

    # Build compact source list for the prompt (limit content to 1500 chars each)
    compact_results = []
    for r in search_results:
        entry = {
            "uri": r.get("uri", ""),
            "title": r.get("title", ""),
            "authority_tier": r.get("authority_tier", "T2"),
        }
        # Include enriched IK fields if available
        if r.get("ik_tid"):
            entry["ik_tid"] = r["ik_tid"]
            if r.get("ik_citation"):
                entry["citation_no"] = r["ik_citation"]
            if r.get("ik_court"):
                entry["court"] = r["ik_court"]
            if r.get("ik_date"):
                entry["date"] = r["ik_date"]
        content = r.get("content") or r.get("snippet") or ""
        if content:
            entry["content"] = content[:1500]
        compact_results.append(entry)

    extract_prompt = _format_prompt(EXTRACT_INSTRUCTION, state)
    extract_prompt += f"\n\n## Search Results (T1/T2 only — some include full judgment text)\n"
    extract_prompt += json.dumps(compact_results, ensure_ascii=False, indent=2)
    extract_prompt += (
        "\n\nExtract ALL citation candidates from these search results. "
        "For IK URLs (indiankanoon.org/doc/), the 'content' field contains actual judgment text — use it. "
        "For other URLs, use title and any available content. "
        "Return ONLY JSON: {\"citations\": [...]}. Include existing citations merged with new ones."
    )

    # Call raw — use high token limit so JSON is never truncated (14 citations × ~400 tokens = ~5600)
    raw_text = _gemini_call(extract_prompt, EXTRACTOR_MODEL, max_tokens=8192, run_id=run_id,
                            user_id=state.get("user_id"), operation="citation_extractor")
    if not raw_text:
        logger.warning("[RUNNER] Extractor Gemini returned empty — skipping merge")
        print("[CITATION AGENT]   extractor: Gemini returned empty response", flush=True)
        return

    result = _parse_json_loose(raw_text)
    if not result:
        logger.warning("[RUNNER] Extractor JSON parse failed — raw: %s", raw_text[:300])
        print(f"[CITATION AGENT]   extractor: JSON parse failed. Raw: {raw_text[:200]}", flush=True)
        return

    # Normalise: model may return a list directly instead of {"citations": [...]}
    if isinstance(result, list):
        new_citations = result
    elif isinstance(result, dict):
        new_citations = result.get("citations") or []
        if not new_citations and (result.get("parties") or result.get("source_url")):
            new_citations = [result]  # single citation object
    else:
        logger.warning("[RUNNER] Extractor returned unexpected type: %s | raw: %s", type(result), raw_text[:200])
        return
    if not isinstance(new_citations, list):
        return

    seen_urls = {c.get("source_url") for c in existing if c.get("source_url")}
    seen_keys = {(c.get("citation_no"), c.get("source_url")) for c in existing}
    merged = list(existing)
    added = 0
    for c in new_citations:
        if not isinstance(c, dict):
            continue
        tier = str(c.get("authority_tier") or "").upper()
        if tier == "T3":
            continue
        url = c.get("source_url") or ""
        key = (c.get("citation_no"), url)
        # Accept if has parties OR a source URL we haven't seen
        if (c.get("parties") or url) and key not in seen_keys and url not in seen_urls:
            seen_keys.add(key)
            if url:
                seen_urls.add(url)
            merged.append(c)
            added += 1

    _set_candidates(state, merged)
    print(f"[CITATION AGENT]   extractor: +{added} new candidates (total={len(merged)})", flush=True)
    _db_log(run_id, "citation_extractor", "done", f"+{added} new | {len(merged)} total",
            meta={"candidate_count": len(merged), "new_added": added})


def _run_quality_critic(state: Dict[str, Any]) -> bool:
    """Stage 5 — returns True if research loop should exit (sufficient coverage)."""
    run_id = state.get("run_id")
    _log_stage(run_id, "Stage 5 — Relevance Critic", agent="quality_critic")

    prompt = _format_prompt(CRITIC_INSTRUCTION, state)
    prompt += (
        '\n\nRespond with ONLY JSON: {"sufficient": true/false, "gaps": "description of unmet issues"}'
    )
    result = _gemini_json(prompt, CRITIC_MODEL, run_id=run_id, user_id=state.get("user_id"),
                          operation="quality_critic")

    sufficient = False
    gaps = ""
    if result:
        sufficient = bool(result.get("sufficient"))
        gaps = str(result.get("gaps") or "")
        state["critic_output"] = gaps if gaps else ("Sufficient citations found." if sufficient else "")

    if not sufficient:
        candidates = _parse_candidates(state)
        t1 = [c for c in candidates if str(c.get("authority_tier", "")).upper() == "T1"]
        t2_sites = set()
        for c in candidates:
            if str(c.get("authority_tier", "")).upper() == "T2":
                url = str(c.get("source_url") or c.get("source_name") or "")
                try:
                    from urllib.parse import urlparse
                    host = urlparse(url).netloc.replace("www.", "")
                    if host:
                        t2_sites.add(host)
                except Exception:
                    pass
        if t1 or len(t2_sites) >= 2:
            sufficient = True
            state["critic_output"] = "Heuristic: sufficient T1/T2 coverage."

    if sufficient:
        _db_log(run_id, "quality_critic", "exit", "Sufficient citations — exiting loop")
        print("[CITATION AGENT] Critic: sufficient — exiting loop", flush=True)
    else:
        gap_list: List[str] = list(state.get("research_gaps") or [])
        if gaps:
            gap_list.append(gaps)
        state["research_gaps"] = gap_list
        _db_log(run_id, "quality_critic", "continue", gaps or "Need more research — looping to Stage 2", "INFO")
        print("[CITATION AGENT] Critic: need more — looping back to query planner", flush=True)

    return sufficient


def _run_verification_grading(state: Dict[str, Any]) -> None:
    """Stage 6 — final review + HIGH/MEDIUM/BLOCKED confidence grading."""
    run_id = state.get("run_id")
    user_id = state.get("user_id") or "anonymous"
    _log_stage(run_id, "Stage 6 — Verification + Grading", agent="citation_validator")

    candidates = _parse_candidates(state)
    citations: List[Dict[str, Any]] = []

    if candidates:
        prompt = _format_prompt(VALIDATOR_INSTRUCTION, state)
        # Use high token limit — validator must output all citations without truncation
        raw_v = _gemini_call(prompt, VALIDATOR_MODEL, max_tokens=8192,
                             run_id=run_id, user_id=user_id, operation="citation_validator")
        result = _parse_json_loose(raw_v) if raw_v else None

        # Normalise result: model may return a list directly instead of {"citations": [...]}
        if isinstance(result, list):
            result = {"citations": result}
        elif isinstance(result, dict) and "citations" not in result:
            # Single citation object returned — wrap it
            if result.get("parties") or result.get("source_url"):
                result = {"citations": [result]}

        if result and isinstance(result, dict) and isinstance(result.get("citations"), list):
            citations = [c for c in result["citations"]
                         if isinstance(c, dict)
                         and str(c.get("authority_tier") or "").upper() != "T3"
                         and str(c.get("confidence") or "").upper() != "BLOCKED"]
            print(f"[CITATION AGENT] Validator: {len(citations)} citation(s) accepted", flush=True)
        else:
            if not raw_v:
                print("[CITATION AGENT] Validator returned empty — using candidates directly", flush=True)
            else:
                print(f"[CITATION AGENT] Validator JSON parse failed — raw: {(raw_v or '')[:200]}", flush=True)
            # Fallback: use candidates directly, assign MEDIUM confidence
            citations = []
            for c in candidates:
                if str(c.get("authority_tier") or "").upper() == "T3":
                    continue
                citations.append({**c, "confidence": c.get("confidence") or "MEDIUM",
                                  "verification_status": c.get("verification_status") or "unverified"})

    if citations:
        try:
            from agents.autonomous_citation_agent.citation_verifier import verify_citations
            citations = verify_citations(citations, run_id=run_id, user_id=user_id)
        except Exception as exc:
            logger.warning("[CITATION_AGENT] Verification step failed: %s", exc)

    state["citation_report"] = json.dumps({"citations": citations}, ensure_ascii=False)
    high = sum(1 for c in citations if str(c.get("confidence", "")).upper() == "HIGH")
    medium = sum(1 for c in citations if str(c.get("confidence", "")).upper() == "MEDIUM")
    _db_log(
        run_id, "citation_validator", "done",
        f"{len(citations)} verified (HIGH={high}, MEDIUM={medium})",
        meta={"citation_count": len(citations), "high": high, "medium": medium},
    )


def run_autonomous_pipeline(state: Dict[str, Any]) -> Dict[str, Any]:
    """Execute the full autonomous citation research pipeline."""
    run_id = state.get("run_id")
    state.setdefault("research_gaps", [])
    state.setdefault("research_questions", "[]")
    _log_stage(run_id, "INPUT — Autonomous Research Start", state.get("case_query", "")[:80])

    # Upstream gate: extract issues + jurisdiction
    _run_upstream_gate(state)

    # Stage 1.5: decompose case into typed research questions
    _run_research_decomposer(state)

    # Research loop: Stage 1 → 1.5 → 2 → 3a → 3b → 4 → 5
    max_iter = int((state.get("budget_state") or {}).get("max_iterations", _DEFAULT_MAX_ITER))
    for _ in range(max_iter):
        if _budget_guard(state):
            break

        queries = _run_query_planner(state)
        if not queries:
            continue

        search_results = _run_constrained_search(state, queries)
        _run_extractor(state, search_results)

        if _run_quality_critic(state):
            break

        if state.get("budget_exhausted"):
            break

    # Stage 6: verification + confidence grading
    _run_verification_grading(state)

    n = len(json.loads(state.get("citation_report") or "{}").get("citations", []))
    gaps = state.get("research_gaps") or []
    _log_stage(run_id, "OUTPUT — Research Complete", f"{n} citation(s) | {len(gaps)} gap(s)")
    return state
