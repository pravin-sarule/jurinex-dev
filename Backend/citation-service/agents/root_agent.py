"""
JuriNex Citation Root Agent (ADK-compatible Orchestrator).

Coordinates the full pipeline:
  Watchdog → Fetcher → Clerk → Librarian → Auditor → ReportBuilder

Each sub-agent is an ADK-compatible class with:
  run(context: AgentContext) -> AgentResult

Usage:
    from agents.root_agent import CitationRootAgent, AgentContext
    root = CitationRootAgent()
    result = root.run(AgentContext(query="bail conditions India", user_id="u1", case_id="c1"))
    report_format = result.data["report_format"]
    report_id     = result.data["report_id"]
"""

from __future__ import annotations

import json
import logging
import os
import re
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any, Dict, List, Optional

from agents.base_agent import BaseAgent, AgentContext, AgentResult, Tool

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Wide-net IK augmentation — runs after WatchdogAgent, before Fetcher
# Injects additional IK candidates sourced by outcome-targeted queries and
# landmark seeds, deduplicated against whatever Watchdog already found.
# ---------------------------------------------------------------------------

def _augment_candidates_wide_net(context: AgentContext) -> None:
    """
    Augment context.metadata["candidates_ik"] with wide-net retrieval results.
    Only runs when a controversy_map with dispute_type is available and
    CITATION_WIDE_NET_ENABLED=1 (default: off until explicitly enabled).
    """
    enabled = os.environ.get("CITATION_WIDE_NET_ENABLED", "1").strip().lower() in (
        "1", "true", "yes", "on"
    )
    if not enabled:
        return

    controversy_map = context.metadata.get("controversy_map") or {}
    query = context.metadata.get("search_query") or context.query or ""
    statutes = controversy_map.get("applicable_statutes") or []

    try:
        from agents.ik_retrieval import IKWideNetRetrieval
        retrieval = IKWideNetRetrieval()
        new_candidates = retrieval.retrieve(
            controversy_map=controversy_map,
            query=query,
            statutes=statutes,
            run_id=context.metadata.get("run_id"),
            user_id=context.metadata.get("user_id") or context.user_id,
        )
    except Exception as exc:
        logger.warning("[WIDE_NET] IKWideNetRetrieval failed: %s", exc)
        return

    if not new_candidates:
        return

    # Merge into existing candidates_ik, deduplicated by external_id/tid
    existing = context.metadata.get("candidates_ik") or []
    seen_tids: set = {
        str(c.get("external_id") or c.get("tid") or "").strip()
        for c in existing
        if c.get("external_id") or c.get("tid")
    }

    added = 0
    for candidate in new_candidates:
        tid = str(
            candidate.get("external_id") or candidate.get("tid") or ""
        ).strip()
        if tid and tid not in seen_tids:
            seen_tids.add(tid)
            existing.append(candidate)
            added += 1

    context.metadata["candidates_ik"] = existing
    logger.info(
        "[WIDE_NET] Added %d new wide-net candidates (total IK candidates: %d)",
        added, len(existing),
    )
    try:
        from db.client import agent_log_insert
        agent_log_insert(
            context.metadata.get("run_id"), None,
            "wide_net", "wide_net", "INFO",
            f"🌐 Wide-net IK: +{added} new candidates ({len(existing)} total)",
            {"added": added, "total": len(existing)},
        )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# HoldingFilter step — runs after FetcherAgent, before ClerkAgent
# Drops fetched IK/Google docs that fail the holding-level relevance check.
# ---------------------------------------------------------------------------

def _apply_holding_filter(context: AgentContext) -> None:
    """
    Run HoldingFilter on context.metadata["fetched_ik"] and
    context.metadata["fetched_go"].  Replace them with the filtered subset.

    Only runs when CITATION_HOLDING_FILTER_ENABLED=1 (default: off until
    explicitly enabled) and a controversy_map is present.
    """
    enabled = os.environ.get("CITATION_HOLDING_FILTER_ENABLED", "0").strip().lower() in (
        "1", "true", "yes", "on"
    )
    if not enabled:
        return

    controversy_map = context.metadata.get("controversy_map") or {}
    fetched_ik = context.metadata.get("fetched_ik") or []
    fetched_go = context.metadata.get("fetched_go") or []

    if not fetched_ik and not fetched_go:
        return

    # Seeds bypass the filter — they are already pre-verified by selection
    seeds_ik = [c for c in fetched_ik if c.get("is_seed")]
    non_seeds_ik = [c for c in fetched_ik if not c.get("is_seed")]
    non_seeds_go = list(fetched_go)

    candidates_to_filter = non_seeds_ik + non_seeds_go

    if not candidates_to_filter:
        return

    logger.info(
        "[HOLDING_FILTER_STEP] Running HoldingFilter on %d docs "
        "(%d seeds bypass) | dispute_type=%s",
        len(candidates_to_filter),
        len(seeds_ik),
        controversy_map.get("dispute_type"),
    )

    try:
        from agents.holding_filter import HoldingFilter
        hf = HoldingFilter()
        filtered = hf.filter(
            candidates=candidates_to_filter,
            controversy_map=controversy_map,
            max_candidates=100,
        )
    except Exception as exc:
        logger.warning("[HOLDING_FILTER_STEP] HoldingFilter failed: %s — passing all through", exc)
        return

    # Separate filtered results back into IK and Google buckets
    def _is_ik(c: dict) -> bool:
        return c.get("_source") == "indian_kanoon" or c.get("source") == "indian_kanoon"

    filtered_ik = seeds_ik + [c for c in filtered if _is_ik(c)]
    filtered_go = [c for c in filtered if not _is_ik(c)]

    original_count = len(fetched_ik) + len(fetched_go)
    filtered_count = len(filtered_ik) + len(filtered_go)

    context.metadata["fetched_ik"] = filtered_ik
    context.metadata["fetched_go"] = filtered_go

    logger.info(
        "[HOLDING_FILTER_STEP] %d → %d docs after holding-level filter",
        original_count, filtered_count,
    )
    try:
        from db.client import agent_log_insert
        agent_log_insert(
            context.metadata.get("run_id"), None,
            "holding_filter", "holding_filter", "INFO",
            f"🔍 HoldingFilter: {original_count} → {filtered_count} docs passed holding check",
            {"input": original_count, "output": filtered_count},
        )
    except Exception:
        pass


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


# Target number of citation points for the report (CHECK 6 / CHECK 8)
TARGET_CITATION_POINTS = 10
# Production-oriented retry threshold: do not spend another full fetch/audit round
# just to chase the last 1-2 points because report_builder can pad placeholders.
MIN_APPROVED_TO_FINISH = _env_int(
    "CITATION_MIN_APPROVED_TO_FINISH",
    max(3, (TARGET_CITATION_POINTS * 8 + 9) // 10),
)
MAX_AUDIT_RETRIES = _env_int("CITATION_MAX_AUDIT_RETRIES", 2)
ENABLE_EXPANSION_RETRY = _env_bool("CITATION_ENABLE_EXPANSION_RETRY", False)
FETCHER_SOURCE_WORKERS = max(2, min(4, _env_int("CITATION_FETCHER_SOURCE_WORKERS", 2)))
CLERK_SOURCE_WORKERS = max(2, min(4, _env_int("CITATION_CLERK_SOURCE_WORKERS", 2)))

_IK_WEB_DOC_RE = re.compile(
    r"https?://(?:www\.)?indiankanoon\.org/(?:doc|docfragment)/(\d+)/?",
    re.I,
)
_IK_WEB_SEARCH_RE = re.compile(
    r"https?://(?:www\.)?indiankanoon\.org/search/\?",
    re.I,
)


def _build_manifest(context: AgentContext) -> Dict[str, Any]:
    """Build job manifest after keyword extraction (CHECK 2)."""
    case_file_context = context.metadata.get("case_file_context") or []
    case_text_parts = []
    for f in case_file_context[:10]:
        name = f.get("name") or f.get("filename") or "document"
        snippet = (f.get("snippet") or f.get("content") or "")[:1500]
        if snippet:
            case_text_parts.append(f"[{name}]\n{snippet}")
    case_text = "\n\n".join(case_text_parts).strip() if case_text_parts else ""
    search_query = (context.metadata.get("search_query") or context.query or "").strip()
    keyword_sets = context.metadata.get("keyword_sets") or []
    return {
        "case_id": context.case_id,
        "case_text": case_text[:5000] if case_text else "",
        "jurisdiction": context.metadata.get("jurisdiction"),
        "year": context.metadata.get("year"),
        "court_name": context.metadata.get("court_name"),
        "num_points": TARGET_CITATION_POINTS,
        "search_query": search_query,
        "keyword_sets": keyword_sets,
    }


def _manifest_is_empty(manifest: Dict[str, Any]) -> bool:
    """True if manifest has no usable search query or case text (CHECK 2)."""
    sq = (manifest.get("search_query") or "").strip()
    ct = (manifest.get("case_text") or "").strip()
    kws = manifest.get("keyword_sets") or []
    return not sq and not ct and not kws


def _candidate_key(candidate: Dict[str, Any]) -> str:
    """Build a stable run-level candidate key so retries only fetch unseen docs."""
    tid = str(candidate.get("external_id") or candidate.get("tid") or "").strip()
    if tid:
        return f"ik:{tid}"

    link = (candidate.get("link") or candidate.get("url") or "").strip()
    if not link:
        return ""

    ik_match = _IK_WEB_DOC_RE.match(link)
    if ik_match:
        return f"ik:{ik_match.group(1)}"
    return f"url:{link.lower()}"


def _filter_new_external_candidates(
    context: AgentContext,
    ik_candidates: List[Dict[str, Any]],
    google_candidates: List[Dict[str, Any]],
) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Keep only unseen external candidates for this run.

    Also drops Indian Kanoon search-result pages because they are not fetchable
    judgments and only add latency/noise.
    """
    seen = set(context.metadata.get("attempted_candidate_keys") or [])
    new_ik: List[Dict[str, Any]] = []
    new_google: List[Dict[str, Any]] = []

    for candidate in ik_candidates or []:
        key = _candidate_key(candidate)
        if not key or key in seen:
            continue
        seen.add(key)
        new_ik.append(candidate)

    for candidate in google_candidates or []:
        link = (candidate.get("link") or candidate.get("url") or "").strip()
        if link and _IK_WEB_SEARCH_RE.match(link):
            continue
        key = _candidate_key(candidate)
        if not key or key in seen:
            continue
        seen.add(key)
        new_google.append(candidate)

    context.metadata["attempted_candidate_keys"] = list(seen)
    return new_ik, new_google

# ══════════════════════════════════════════════════════════════════════════════
# WATCHDOG AGENT  — searches Local DB → Indian Kanoon → Google Serper
# ══════════════════════════════════════════════════════════════════════════════

class WatchdogAgent(BaseAgent):
    name        = "watchdog"
    description = "Dimension-aware search: Local DB, Indian Kanoon API (batched, hierarchy-filtered), Google."

    def run(self, context: AgentContext) -> AgentResult:
        from agents.watchdog import run_watchdog
        run_id       = context.metadata.get("run_id")
        query        = context.metadata.get("search_query") or context.query
        keyword_sets = context.metadata.get("keyword_sets")
        user_id      = context.metadata.get("user_id") or context.user_id or "anonymous"
        # Dimensions from LegalDimensionExtractor (may be empty if no case context)
        dimensions   = context.dimensions or []
        case_state   = (context.metadata.get("state") or "").strip()

        dim_count = len(dimensions)

        # Fallback: if both query and dimensions are empty, prefer controversy_map over raw case text
        if not query and not dimensions and not keyword_sets:
            _cm = context.metadata.get("controversy_map") or {}
            # controversy_query (40-60 words, question format) → use for Qdrant vector search
            _cq = str(_cm.get("controversy_query") or _cm.get("central_controversy") or "").strip()
            if _cq:
                query = _cq
                # Also build short IK-friendly keyword phrases from factual_trigger + legal_claim
                _ik_phrases = [
                    p for p in [
                        str(_cm.get("factual_trigger") or "").strip(),
                        str(_cm.get("legal_claim") or "").strip(),
                        str(_cm.get("central_controversy") or "").strip(),
                    ] if p
                ]
                if _ik_phrases:
                    keyword_sets = _ik_phrases
                logger.info("[WATCHDOG] No query/dimensions — using controversy_map seed: %r, IK phrases: %d",
                            query[:80], len(keyword_sets or []))
            else:
                for f in (context.metadata.get("case_file_context") or [])[:3]:
                    snippet = (f.get("snippet") or f.get("content") or "").strip()
                    if snippet:
                        query = snippet[:300]
                        logger.info("[WATCHDOG] No query/dimensions — derived seed from case_file_context: %r", query[:80])
                        break

        logger.info("[WATCHDOG] Starting — %d dimension(s), query=%s",
                    dim_count, (query or "")[:80])

        result = run_watchdog(
            query,
            max_local  = 10,
            max_ik     = 10,
            max_google = 5,
            keyword_sets    = keyword_sets if not dimensions else None,
            dimensions      = dimensions if dimensions else None,
            case_state      = case_state,
            run_id          = run_id,
            user_id         = user_id,
            controversy_map = context.metadata.get("controversy_map"),
        )

        if result.get("error"):
            return AgentResult(success=False, error=result["error"])

        context.judgement_ids                       = result.get("all_judgement_ids", [])
        context.metadata["candidates_ik"]           = result.get("candidates_ik", [])
        context.metadata["candidates_google"]       = result.get("candidates_google", [])
        context.metadata["search_keywords_by_route"] = result.get("search_keywords_by_route", {})
        context.metadata["local_judgement_hints"]   = result.get("local_judgement_hints") or {}
        context.metadata["local_canonical_ids_needing_analysis"] = (
            result.get("local_canonical_ids_needing_analysis") or []
        )
        dropped = result.get("dropped_low_hierarchy_count", 0)

        return AgentResult(data={
            "local_count":                len(context.judgement_ids),
            "ik_count":                   len(context.metadata["candidates_ik"]),
            "google_count":               len(context.metadata["candidates_google"]),
            "dropped_low_hierarchy_count": dropped,
        })


# ══════════════════════════════════════════════════════════════════════════════
# FETCHER AGENT  — fetches full doc from IK API or URL
# ══════════════════════════════════════════════════════════════════════════════

class FetcherAgent(BaseAgent):
    name        = "fetcher"
    description = "Fetches full judgment HTML/text from Indian Kanoon API and web URLs."

    def run(self, context: AgentContext) -> AgentResult:
        from agents.fetcher import fetch_ik_candidates, fetch_google_candidates
        run_id = context.metadata.get("run_id")
        ik_cands = context.metadata.get("candidates_ik", [])
        go_cands = context.metadata.get("candidates_google", [])
        fetched_ik, fetched_go = [], []
        errors = []

        try:
            from db.client import agent_log_insert
            agent_log_insert(run_id, None, "fetcher", "fetcher", "INFO",
                f"📡 Fetcher started — {len(ik_cands)} Indian Kanoon + {len(go_cands)} Google URLs to fetch",
                {"ik_count": len(ik_cands), "google_count": len(go_cands)})
        except Exception:
            pass

        # Fetch IK + Google in parallel
        user_id = context.metadata.get("user_id") or context.user_id or "anonymous"
        def _fetch_ik():
            try:
                return fetch_ik_candidates(ik_cands, query=context.metadata.get("search_query") or context.query, run_id=run_id, user_id=user_id)
            except Exception as e:
                errors.append(str(e)); return []

        def _fetch_go():
            try:
                return fetch_google_candidates(go_cands, run_id=run_id, user_id=user_id)
            except Exception as e:
                errors.append(str(e)); return []

        with ThreadPoolExecutor(max_workers=FETCHER_SOURCE_WORKERS) as pool:
            f_ik = pool.submit(_fetch_ik)
            f_go = pool.submit(_fetch_go)
            fetched_ik = f_ik.result()
            fetched_go = f_go.result()

        context.metadata["fetched_ik"] = fetched_ik
        context.metadata["fetched_go"] = fetched_go
        logger.info("[FETCHER] IK=%d fetched, Google=%d fetched", len(fetched_ik), len(fetched_go))
        try:
            from db.client import agent_log_insert
            agent_log_insert(run_id, None, "fetcher", "fetcher", "INFO",
                f"✅ Fetcher done — {len(fetched_ik)} IK docs + {len(fetched_go)} Google docs ready for Clerk",
                {"ik_fetched": len(fetched_ik), "google_fetched": len(fetched_go), "errors": errors[:3]})
        except Exception:
            pass
        return AgentResult(data={
            "ik_fetched":     len(fetched_ik),
            "google_fetched": len(fetched_go),
            "errors":         errors,
        })


# ── Phase 4: Clerk relevance pre-check helper ─────────────────────────────────

_CLERK_PRECHECK_PROMPT = (
    "You are a senior Indian legal research analyst.\n\n"
    "Score each document for relevance to the legal dispute (0-5):\n"
    "  5=directly on point   3-4=useful precedent   1-2=marginal   0=irrelevant\n\n"
    "DISPUTE:\n{controversy_text}\n\n"
    "DOCUMENTS:\n{documents_list}\n\n"
    "Return JSON array ONLY: "
    '[{{"index":1,"score":<0-5>}},{{"index":2,"score":<0-5>}},...]\n'
    "Return ONLY the JSON array."
)

def _clerk_relevance_precheck(
    fetched_ik: List[Dict[str, Any]],
    fetched_go: List[Dict[str, Any]],
    controversy_map: Dict[str, Any],
    dimensions: List[Dict[str, Any]],
    run_id: Optional[str],
    user_id: str,
    agent: "BaseAgent",
    min_score: int = 2,
) -> tuple:
    """
    Quick Gemini relevance check on fetched docs before ingest.
    Docs scored below min_score are dropped (EXCLUDE tier) to avoid
    polluting the DB with irrelevant content.
    Returns (filtered_ik, filtered_go).
    """
    all_docs = [(d, "ik") for d in fetched_ik] + [(d, "go") for d in fetched_go]
    if not all_docs:
        return fetched_ik, fetched_go

    cm = controversy_map or {}
    controversy_text = (
        f"Dispute: {cm.get('central_controversy', '')}\n"
        f"Trigger: {cm.get('factual_trigger', '')}\n"
        f"Claim: {cm.get('legal_claim', '')}"
    ).strip()

    # Build compact description for each doc
    lines: List[str] = []
    for i, (d, _src) in enumerate(all_docs):
        title = str(d.get("title") or d.get("doc_title") or "").strip() or "(untitled)"
        snippet = str(d.get("headline") or d.get("content") or d.get("raw_content") or "")[:200].strip()
        line = f"[{i + 1}] {title}"
        if snippet:
            line += f" — {snippet}"
        lines.append(line)

    _precheck_template = _CLERK_PRECHECK_PROMPT
    _precheck_temp = 0.0
    _precheck_max_tokens = 512
    try:
        from utils.prompt_resolver import resolve_prompt as _resolve_prompt
        _pc = _resolve_prompt(
            name="ClerkPrecheck",
            agent_type="citation",
            default_prompt=_CLERK_PRECHECK_PROMPT,
            default_model=os.environ.get("GEMINI_MODEL", "gemini-2.0-flash"),
            default_temperature=0.0,
            default_max_tokens=512,
        )
        _precheck_template = _pc.prompt
        _precheck_temp = _pc.temperature
        _precheck_max_tokens = _pc.max_tokens
    except Exception as _exc:
        logger.debug("[CLERK_PRECHECK] prompt_resolver unavailable: %s", _exc)

    prompt = _precheck_template.format(
        controversy_text=controversy_text,
        documents_list="\n".join(lines),
    )

    try:
        raw = agent._gemini(
            prompt,
            max_tokens=_precheck_max_tokens,
            temperature=_precheck_temp,
            run_id=run_id,
            user_id=user_id,
            operation="clerk_precheck",
        )
        import re as _re, json as _json
        text = (raw or "").strip()
        text = _re.sub(r"^```(?:json)?\s*", "", text)
        text = _re.sub(r"```\s*$", "", text).strip()
        items = _json.loads(text)
        if not isinstance(items, list):
            raise ValueError("not a list")

        score_map: Dict[int, float] = {}
        for item in items:
            if isinstance(item, dict):
                idx = int(item.get("index") or 0)
                score = float(item.get("score") or 0)
                score_map[idx] = score

        kept_ik, kept_go = [], []
        excluded = 0
        for i, (d, src) in enumerate(all_docs):
            score = score_map.get(i + 1, 3.0)
            if score < min_score:
                excluded += 1
                title = str(d.get("title") or "?")[:60]
                logger.info("[CLERK_PRECHECK] EXCLUDED (score=%.0f): %s", score, title)
                continue
            d["_precheck_score"] = score
            if src == "ik":
                kept_ik.append(d)
            else:
                kept_go.append(d)

        logger.info(
            "[CLERK_PRECHECK] %d → %d docs (excluded %d with score < %d)",
            len(all_docs), len(kept_ik) + len(kept_go), excluded, min_score,
        )
        return kept_ik, kept_go
    except Exception as exc:
        logger.warning("[CLERK_PRECHECK] failed (%s) — passing all docs through", exc)
        return fetched_ik, fetched_go


# ══════════════════════════════════════════════════════════════════════════════
# CLERK AGENT  — OCR + Gemini extraction + chunk + embed + store
# ══════════════════════════════════════════════════════════════════════════════

class ClerkAgent(BaseAgent):
    name        = "clerk"
    description = "OCRs judgment text, uses Gemini to extract all structured fields, chunks and stores."

    def run(self, context: AgentContext) -> AgentResult:
        from agents.clerk import clerk_ingest_ik, clerk_ingest_google, clerk_enrich_local_canonical_ids
        run_id     = context.metadata.get("run_id")
        query      = context.metadata.get("search_query") or context.query
        fetched_ik = context.metadata.get("fetched_ik", [])
        fetched_go = context.metadata.get("fetched_go", [])
        new_ids, errors = [], []

        # Phase 4: relevance pre-check — drop EXCLUDE-tier docs before ingestion
        cm   = context.metadata.get("controversy_map") or {}
        dims = context.dimensions or []
        if (fetched_ik or fetched_go) and (cm or dims):
            fetched_ik, fetched_go = _clerk_relevance_precheck(
                fetched_ik, fetched_go, cm, dims, run_id=run_id,
                user_id=context.metadata.get("user_id") or context.user_id or "anonymous",
                agent=self,
            )

        try:
            from db.client import agent_log_insert
            agent_log_insert(run_id, None, "clerk", "clerk", "INFO",
                f"📋 Clerk started — extracting & storing {len(fetched_ik)} IK + {len(fetched_go)} Google judgments via Gemini",
                {"ik_count": len(fetched_ik), "google_count": len(fetched_go)})
        except Exception:
            pass

        case_id = context.case_id
        user_id = context.metadata.get("user_id") or context.user_id or "anonymous"
        dimensions = context.dimensions or []
        # Run IK + Google ingestion in parallel (pass case_id for Qdrant payload)
        def _ingest_ik():
            try:
                return clerk_ingest_ik(
                    fetched_ik, query=query, case_id=case_id,
                    run_id=run_id, user_id=user_id, dimensions=dimensions,
                )
            except Exception as e:
                errors.append(f"IK: {e}"); return []

        def _ingest_go():
            try:
                return clerk_ingest_google(fetched_go, query=query, case_id=case_id, run_id=run_id, user_id=user_id)
            except Exception as e:
                errors.append(f"GO: {e}"); return []

        with ThreadPoolExecutor(max_workers=CLERK_SOURCE_WORKERS) as pool:
            f_ik = pool.submit(_ingest_ik)
            f_go = pool.submit(_ingest_go)
            ik_ids = f_ik.result()
            go_ids = f_go.result()

        new_ids = ik_ids + go_ids
        for jid in new_ids:
            if jid not in context.judgement_ids:
                context.judgement_ids.append(jid)

        local_need = list(dict.fromkeys(context.metadata.get("local_canonical_ids_needing_analysis") or []))
        if local_need:
            pipeline_api_context = {
                "fetched_ik_documents":      len(fetched_ik),
                "fetched_google_documents": len(fetched_go),
                "watchdog_ik_candidates":  len(context.metadata.get("candidates_ik") or []),
                "watchdog_google_candidates": len(context.metadata.get("candidates_google") or []),
            }
            try:
                clerk_enrich_local_canonical_ids(
                    local_need,
                    query=query,
                    case_id=case_id,
                    run_id=run_id,
                    user_id=user_id,
                    dimensions=dimensions,
                    local_hints=context.metadata.get("local_judgement_hints") or {},
                    pipeline_api_context=pipeline_api_context,
                )
            except Exception as e:
                errors.append(f"LOCAL_ENRICH: {e}")
                logger.warning("[CLERK] Local canonical enrich failed: %s", e)

        logger.info("[CLERK] Ingested %d IK + %d Google = %d total new IDs",
                    len(ik_ids), len(go_ids), len(new_ids))
        try:
            from db.client import agent_log_insert
            agent_log_insert(run_id, None, "clerk", "clerk", "INFO",
                f"✅ Clerk done — {len(ik_ids)} IK + {len(go_ids)} Google = {len(new_ids)} new citations stored",
                {"ik_ingested": len(ik_ids), "google_ingested": len(go_ids), "total": len(new_ids), "errors": errors[:3]})
        except Exception:
            pass
        return AgentResult(data={
            "ik_ingested":     len(ik_ids),
            "google_ingested": len(go_ids),
            "total_ingested":  len(new_ids),
            "errors":          errors,
        })


# ══════════════════════════════════════════════════════════════════════════════
# LIBRARIAN AGENT  — validates & enriches every citation
# ══════════════════════════════════════════════════════════════════════════════

class LibrarianAgent(BaseAgent):
    name        = "librarian"
    description = "Validates citation format, year, court, content quality and area-of-law tagging."

    def run(self, context: AgentContext) -> AgentResult:
        from agents.librarian import run_librarian
        run_id = context.metadata.get("run_id")
        if not context.judgement_ids:
            return AgentResult(data={"validated": 0, "flagged": 0, "rejected": 0})

        try:
            from db.client import agent_log_insert
            agent_log_insert(run_id, None, "librarian", "librarian", "INFO",
                f"📚 Librarian validating {len(context.judgement_ids)} citation(s) — checking format, year, court, content quality…",
                {"total": len(context.judgement_ids)})
        except Exception:
            pass

        case_state = (context.metadata.get("state") or "").strip()
        result = run_librarian(
            context.judgement_ids,
            case_state=case_state,
            dimensions=context.dimensions or [],
            judgement_hints=context.metadata.get("local_judgement_hints") or {},
        )
        context.metadata["librarian_result"]    = result
        context.metadata["validated_ids"]       = result["validated_ids"]
        context.metadata["flagged_ids"]         = result["flagged_ids"]
        context.metadata["rejected_ids"]        = result["rejected_ids"]
        context.metadata["hierarchy_rankings"]  = result.get("hierarchy_rankings", {})

        # Phase 6: composite sort — combine hierarchy rank + relevance score
        relevance_scores = context.metadata.get("relevance_scores") or {}
        if relevance_scores:
            hier = result.get("hierarchy_rankings") or {}
            # Normalise hierarchy rank (higher rank number = better) to 0-10 range
            # SC rank ≈ 300, HC ≈ 200, district ≈ 100 → normalise /30 capped at 10
            def _composite(jid: str) -> float:
                h_rank = float(hier.get(jid) or 100)
                h_norm = min(h_rank / 30.0, 10.0)
                r_score = float((relevance_scores.get(jid) or {}).get("score") or 5.0)
                return 0.4 * h_norm + 0.6 * r_score
            context.metadata["validated_ids"] = sorted(
                result["validated_ids"], key=_composite, reverse=True
            )
            context.metadata["flagged_ids"] = sorted(
                result["flagged_ids"], key=_composite, reverse=True
            )
            logger.info("[LIBRARIAN] Composite sort applied using relevance_scores (%d entries)", len(relevance_scores))

        # Log per-citation details
        details = result.get("details", {})
        try:
            from db.client import judgement_get, agent_log_insert
            for jid, det in list(details.items())[:30]:  # cap at 30 to avoid log spam
                j = judgement_get(jid)
                title = ((j or {}).get("title") or jid)[:60]
                src_icon = {"local": "🏛", "indian_kanoon": "📚", "google": "🌐"}.get(det.get("source", ""), "❓")
                status = det.get("status", "?")
                status_icon = {"validated": "✓", "validated_with_warnings": "~", "flagged": "⚠", "rejected": "✗"}.get(status, "?")
                issues = det.get("issues", [])
                warnings = det.get("warnings", [])
                note = ""
                if issues:
                    note = f" | issues: {', '.join(issues)}"
                elif warnings:
                    note = f" | warnings: {', '.join(warnings[:2])}"
                area = (det.get("enrichments") or {}).get("area_of_law", "")
                msg = f"  {src_icon} {status_icon} {title}{note}" + (f" [{area}]" if area else "")
                level = "WARNING" if status in ("flagged", "rejected") else "INFO"
                agent_log_insert(run_id, None, "librarian", "librarian", level, msg,
                                 {"jid": jid, "status": status, "source": det.get("source")})
        except Exception:
            pass

        logger.info("[LIBRARIAN] validated=%d flagged=%d rejected=%d",
                    len(result["validated_ids"]), len(result["flagged_ids"]), len(result["rejected_ids"]))
        try:
            from db.client import agent_log_insert
            agent_log_insert(run_id, None, "librarian", "librarian", "INFO",
                f"✅ Librarian done — ✓ {len(result['validated_ids'])} validated | ⚠ {len(result['flagged_ids'])} flagged | ✗ {len(result['rejected_ids'])} rejected",
                {"validated": len(result["validated_ids"]), "flagged": len(result["flagged_ids"]), "rejected": len(result["rejected_ids"])})
        except Exception:
            pass
        return AgentResult(data={
            "validated": len(result["validated_ids"]),
            "flagged":   len(result["flagged_ids"]),
            "rejected":  len(result["rejected_ids"]),
        })


# ══════════════════════════════════════════════════════════════════════════════
# AUDITOR AGENT  — cross-validates and gates citations
# ══════════════════════════════════════════════════════════════════════════════

class AuditorAgent(BaseAgent):
    name        = "auditor"
    description = "Cross-validates citations via IK API and heuristics; gates final approved list."

    def run(self, context: AgentContext) -> AgentResult:
        from agents.auditor import run_auditor
        run_id    = context.metadata.get("run_id")
        validated = context.metadata.get("validated_ids", [])
        flagged   = context.metadata.get("flagged_ids", [])
        if not validated and not flagged:
            return AgentResult(data={"approved": 0, "quarantined": 0})

        try:
            from db.client import agent_log_insert
            agent_log_insert(run_id, None, "auditor", "auditor", "INFO",
                f"🔍 Auditor cross-verifying {len(validated)} validated + {len(flagged)} flagged citation(s) via Indian Kanoon…",
                {"validated_count": len(validated), "flagged_count": len(flagged)})
        except Exception:
            pass

        user_id = context.metadata.get("user_id") or context.user_id or "anonymous"
        result = run_auditor(
            validated,
            flagged,
            verify_online=True,
            run_id=run_id,
            user_id=user_id,
            judgement_hints=context.metadata.get("local_judgement_hints") or {},
        )
        context.metadata["audit_details"]  = result.get("audit_details", {})
        context.metadata["approved_ids"]   = result.get("approved_ids", [])
        context.metadata["hitl_ids"]       = result.get("hitl_ids", [])
        context.judgement_ids              = result.get("approved_ids", [])
        approved_count    = len(result.get("approved_ids", []))
        quarantined_count = len(result.get("quarantined_ids", []))

        # Phase 7: relevance gate — move low-relevance approved IDs to HITL queue
        relevance_scores = context.metadata.get("relevance_scores") or {}
        hints = context.metadata.get("local_judgement_hints") or {}
        _RELEVANCE_GATE = float(os.environ.get("CITATION_RELEVANCE_GATE_SCORE", "2.5"))
        if relevance_scores:
            still_approved: List[str] = []
            relevance_hitl: List[str] = []
            for jid in list(context.judgement_ids):
                # Admin uploads bypass the relevance gate
                h = hints.get(jid) or {}
                is_admin = h.get("is_local_admin") or str(h.get("source_type") or "").lower().startswith("admin")
                if is_admin:
                    still_approved.append(jid)
                    continue
                r_score = float((relevance_scores.get(jid) or {}).get("score") or 10.0)
                if r_score < _RELEVANCE_GATE:
                    relevance_hitl.append(jid)
                    context.metadata["audit_details"].setdefault(jid, {})
                    context.metadata["audit_details"][jid]["relevance_gate"] = "NOT_RELEVANT"
                    context.metadata["audit_details"][jid]["relevance_score"] = r_score
                    logger.info(
                        "[AUDITOR] Relevance gate: HITL for jid=%s score=%.1f < threshold=%.1f",
                        jid, r_score, _RELEVANCE_GATE,
                    )
                else:
                    still_approved.append(jid)
            if relevance_hitl:
                context.metadata["hitl_ids"] = list(
                    dict.fromkeys((context.metadata.get("hitl_ids") or []) + relevance_hitl)
                )
                context.metadata["approved_ids"] = still_approved
                context.judgement_ids = still_approved
                approved_count = len(still_approved)
                logger.info(
                    "[AUDITOR] Relevance gate moved %d judgment(s) to HITL (threshold=%.1f)",
                    len(relevance_hitl), _RELEVANCE_GATE,
                )

        # Log per-citation audit outcomes
        audit_details = result.get("audit_details", {})
        try:
            from db.client import judgement_get, agent_log_insert
            for jid, det in list(audit_details.items())[:30]:
                j = judgement_get(jid)
                title = ((j or {}).get("title") or jid)[:60]
                status = det.get("audit_status", "?")
                conf_raw = det.get("final_confidence") or det.get("confidence") or 0
                conf = conf_raw / 100.0 if conf_raw > 1 else conf_raw  # normalise 0-100 → 0-1 for % format
                status_icon = {
                    "VERIFIED": "✅", "VERIFIED_WITH_WARNINGS": "✓⚠",
                    "NEEDS_REVIEW": "🔎", "QUARANTINED": "🚫"
                }.get(status, "?")
                msg = f"  {status_icon} {title} — {status} (confidence: {conf:.0%})"
                level = "WARNING" if status == "QUARANTINED" else "INFO"
                agent_log_insert(run_id, None, "auditor", "auditor", level, msg,
                                 {"jid": jid, "status": status, "confidence": conf_raw})
        except Exception:
            pass

        logger.info("[AUDITOR] approved=%d quarantined=%d", approved_count, quarantined_count)
        try:
            from db.client import agent_log_insert
            agent_log_insert(run_id, None, "auditor", "auditor", "INFO",
                f"✅ Auditor done — ✅ {approved_count} approved | 🚫 {quarantined_count} quarantined",
                {"approved": approved_count, "quarantined": quarantined_count})
        except Exception:
            pass
        return AgentResult(data={
            "approved":    approved_count,
            "quarantined": quarantined_count,
        })


# ══════════════════════════════════════════════════════════════════════════════
# REPORT BUILDER AGENT  — assembles final citation report
# ══════════════════════════════════════════════════════════════════════════════

class ReportBuilderAgent(BaseAgent):
    name        = "report_builder"
    description = "Assembles the final verified citation report from approved judgements."

    def run(self, context: AgentContext) -> AgentResult:
        from report_builder import build_report_from_judgements
        from db.client import report_insert
        run_id = context.metadata.get("run_id")
        audit_details = context.metadata.get("audit_details", {})
        search_keywords = context.metadata.get("keyword_sets") or []
        search_keywords_by_route = context.metadata.get("search_keywords_by_route") or {}
        dimensions_meta = context.dimensions or context.metadata.get("dimensions") or []

        try:
            from db.client import agent_log_insert
            agent_log_insert(run_id, None, "report_builder", "report_builder", "INFO",
                f"🏗 Building final citation report from {len(context.judgement_ids)} approved citation(s)…",
                {"citation_count": len(context.judgement_ids)})
        except Exception:
            pass

        perspective = (context.metadata.get("perspective") or "all").lower().strip()
        report_format = build_report_from_judgements(
            context.judgement_ids,
            context.query,
            context.user_id,
            audit_details=audit_details,
            search_keywords=search_keywords,
            search_keywords_by_route=search_keywords_by_route,
            perspective=perspective,
            run_id=run_id,
            dimensions=dimensions_meta,
            local_judgement_hints=context.metadata.get("local_judgement_hints") or {},
        )
        # Ensure structured legal metadata visibility for every citation object.
        for c in (report_format.get("citations") or []):
            c.setdefault("metadata", {
                "caseName": c.get("caseName") or "Not Available",
                "court": c.get("court") or "Not Available",
                "bench": c.get("coram") or "Not Available",
                "date": c.get("dateOfJudgment") or "Not Available",
                "official_citation": c.get("primaryCitation") or "Not Available",
            })
            c.setdefault("headnotes", c.get("headnote") or "Not Available")
            c.setdefault("ratio_decidendi", c.get("ratio") or "Not Available")
            c.setdefault("relevance_badge", "High" if str(c.get("relevanceBadge") or "").upper() == "HIGH" else "Medium")
            c.setdefault("is_local_admin", bool(c.get("isLocalAdmin")))
        report_id = str(uuid.uuid4())
        run_id = context.metadata.get("run_id")
        report_insert(
            report_id, context.user_id, context.query,
            report_format, "completed", case_id=context.case_id, run_id=run_id,
            citations_approved_count=len(context.judgement_ids),
            dimensions_metadata=dimensions_meta,
        )
        context.metadata["report_id"] = report_id
        citation_count = len(report_format.get("citations", []))
        logger.info("[REPORT_BUILDER] report_id=%s citations=%d", report_id, citation_count)
        try:
            from db.client import agent_log_insert
            agent_log_insert(run_id, report_id, "report_builder", "report_builder", "INFO",
                f"🎉 Report ready! {citation_count} verified citation(s) compiled — report_id: {report_id}",
                {"report_id": report_id, "citation_count": citation_count})
        except Exception:
            pass
        return AgentResult(data={
            "report_id":     report_id,
            "report_format": report_format,
            "citation_count": citation_count,
        })


# ══════════════════════════════════════════════════════════════════════════════
# STATE → HIGH COURT MAPPING  (used by LegalDimensionExtractor for hc_query)
# ══════════════════════════════════════════════════════════════════════════════

_STATE_TO_HC: Dict[str, str] = {
    "andhra pradesh":    "Andhra Pradesh High Court",
    "telangana":         "Telangana High Court",
    "delhi":             "Delhi High Court",
    "gujarat":           "Gujarat High Court",
    "karnataka":         "Karnataka High Court",
    "kerala":            "Kerala High Court",
    "madhya pradesh":    "Madhya Pradesh High Court",
    "maharashtra":       "Bombay High Court",
    "punjab":            "Punjab and Haryana High Court",
    "haryana":           "Punjab and Haryana High Court",
    "rajasthan":         "Rajasthan High Court",
    "tamil nadu":        "Madras High Court",
    "uttar pradesh":     "Allahabad High Court",
    "west bengal":       "Calcutta High Court",
    "odisha":            "Orissa High Court",
    "assam":             "Gauhati High Court",
    "meghalaya":         "Meghalaya High Court",
    "manipur":           "Manipur High Court",
    "tripura":           "Tripura High Court",
    "himachal pradesh":  "Himachal Pradesh High Court",
    "uttarakhand":       "Uttarakhand High Court",
    "chhattisgarh":      "Chhattisgarh High Court",
    "jharkhand":         "Jharkhand High Court",
    "goa":               "Bombay High Court",
    "jammu":             "Jammu and Kashmir High Court",
    "kashmir":           "Jammu and Kashmir High Court",
    "sikkim":            "Sikkim High Court",
}

MAX_DIMENSIONS = _env_int("CITATION_MAX_DIMENSIONS", 8)


def _resolve_hc_name(context: AgentContext) -> str:
    """Derive the relevant High Court name from context metadata."""
    # Try explicit state field first
    for key in ("state", "jurisdiction", "court_name"):
        val = (context.metadata.get(key) or "").strip().lower()
        if val:
            for state_key, hc_name in _STATE_TO_HC.items():
                if state_key in val or val in state_key:
                    return hc_name
    # Scan case file context snippets for state mentions (first match wins)
    for f in (context.metadata.get("case_file_context") or [])[:5]:
        text = (f.get("snippet") or f.get("content") or "").lower()
        for state_key, hc_name in _STATE_TO_HC.items():
            if state_key in text:
                return hc_name
    return "High Court"


# ══════════════════════════════════════════════════════════════════════════════
# CONTROVERSY MAPPER  — pre-LDE step that compresses the dispute into a single map
# ══════════════════════════════════════════════════════════════════════════════

class ControversyMapperAgent(BaseAgent):
    """
    Runs BEFORE LegalDimensionExtractor to extract a compact 'controversy map'
    from the query and case context.  The map is stored in
    context.metadata["controversy_map"] and reused by:
      - Watchdog (extra Qdrant vector query)
      - Clerk (relevance pre-check)
      - RelevanceRanker (scoring)
      - ReportBuilder (dimension tagging)

    Output schema:
      {
        "central_controversy": "one-sentence statement of the core legal dispute",
        "factual_trigger":     "what event/action triggered the legal proceeding",
        "legal_claim":         "which right/rule/section is invoked",
        "disputed_outcome":    "what each side is trying to achieve",
        "controversy_query":   "40-60 word richly factual query for Qdrant vector search"
      }

    Fast path: if the query is very short (< 15 words) and there is no case
    context, we fall back to a simple keyword expansion without an LLM call.
    """
    name        = "controversy_mapper"
    description = "Compresses the case into a compact controversy map for downstream retrieval."

    _PROMPT = (
        "You are a senior Indian legal research strategist.\n\n"
        "Read the following case query and supporting file extracts, then produce a "
        "controversy map — a compact analytical summary of the core legal dispute "
        "that will drive citation retrieval.\n\n"
        "RULES:\n"
        "- controversy_query must be 40-60 words, richly factual, encode the actual "
        "transaction/event, the specific offences or provisions invoked, the "
        "procedural posture, and the decisive legal questions.\n"
        "- Do NOT produce generic vocabulary (locus standi, violation of rights, etc.).\n"
        "- Prefer specific section numbers, transaction types, and factual markers.\n\n"
        "INPUT\n"
        "Query: {base_query}\n\n"
        "Case extracts:\n{case_context}\n\n"
        "OUTPUT — return ONLY valid JSON, no markdown:\n"
        '{{"central_controversy":"...","factual_trigger":"...","legal_claim":"...",'
        '"disputed_outcome":"...","controversy_query":"..."}}'
    )

    def run(self, context: AgentContext) -> AgentResult:
        run_id    = context.metadata.get("run_id")
        user_id   = context.metadata.get("user_id") or context.user_id or "anonymous"
        base_query = (context.query or "").strip()

        # Build a compact case_context string (max 3000 chars)
        parts: List[str] = []
        for f in (context.metadata.get("case_file_context") or [])[:10]:
            snip = (f.get("snippet") or f.get("content") or "")[:800].strip()
            if snip:
                name = f.get("name") or f.get("filename") or "doc"
                parts.append(f"[{name}]\n{snip}")
        case_context_str = "\n\n".join(parts)[:3000]

        # Fast path — short bare query, no context
        query_words = [w for w in base_query.split() if w]
        if len(query_words) < 15 and not case_context_str:
            cm = {
                "central_controversy": base_query,
                "factual_trigger": base_query,
                "legal_claim": base_query,
                "disputed_outcome": "",
                "controversy_query": base_query,
            }
            context.metadata["controversy_map"] = cm
            logger.info("[CONTROVERSY_MAPPER] fast-path (short query, no context)")
            return AgentResult(data={"source": "fast_path", "controversy_map": cm})

        _cm_template = self._PROMPT
        _cm_temp = 0.1
        _cm_max_tokens = 512
        try:
            from utils.prompt_resolver import resolve_prompt as _resolve_prompt
            _pc = _resolve_prompt(
                name="ControversyMapper",
                agent_type="citation",
                default_prompt=self._PROMPT,
                default_model=os.environ.get("GEMINI_MODEL", "gemini-2.0-flash"),
                default_temperature=0.1,
                default_max_tokens=512,
            )
            _cm_template = _pc.prompt
            _cm_temp = _pc.temperature
            _cm_max_tokens = _pc.max_tokens
        except Exception as _exc:
            logger.debug("[CONTROVERSY_MAPPER] prompt_resolver unavailable: %s", _exc)

        prompt = _cm_template.format(
            base_query=base_query,
            case_context=case_context_str or "(no file context provided)",
        )
        try:
            raw = self._gemini(
                prompt,
                max_tokens=_cm_max_tokens,
                temperature=_cm_temp,
                run_id=run_id,
                user_id=user_id,
                operation="controversy_map",
            )
            text = (raw or "").strip()
            # Strip markdown fences
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"```\s*$", "", text).strip()
            cm = json.loads(text)
            if not isinstance(cm, dict):
                raise ValueError("not a dict")
            # Ensure all keys present
            for k in ("central_controversy", "factual_trigger", "legal_claim",
                      "disputed_outcome", "controversy_query"):
                if k not in cm:
                    cm[k] = base_query
            context.metadata["controversy_map"] = cm
            logger.info(
                "[CONTROVERSY_MAPPER] map ready | controversy=%s | controversy_query=%s",
                str(cm.get("central_controversy") or "")[:80],
                str(cm.get("controversy_query") or "")[:80],
            )
            return AgentResult(data={"source": "gemini", "controversy_map": cm})
        except Exception as exc:
            logger.warning("[CONTROVERSY_MAPPER] failed (%s) — using base query fallback", exc)
            cm = {
                "central_controversy": base_query,
                "factual_trigger": base_query,
                "legal_claim": base_query,
                "disputed_outcome": "",
                "controversy_query": base_query,
            }
            context.metadata["controversy_map"] = cm
            return AgentResult(data={"source": "fallback", "controversy_map": cm})


# ══════════════════════════════════════════════════════════════════════════════
# LEGAL DIMENSION EXTRACTOR  — "Legal Dimension Intelligence" framework
# ══════════════════════════════════════════════════════════════════════════════

class LegalDimensionExtractor(BaseAgent):
    """
    Replaces KeywordExtractorAgent.

    Uses Claude to identify 3-6 core Legal Dimensions (distinct disputes) from
    the case context, then generates exactly 3 targeted search queries per
    dimension (SC, HC, Provision).  All queries are 8-15 words for optimal
    India Kanoon phrase-matching.

    After dimension generation, directly calls the India Kanoon API for each
    of the 3×N queries in parallel (using INDIAN_KANOON_TOKEN from .env).
    Results are stored as `candidates_ik` with dimension tags so WatchdogAgent
    can skip the IK search step entirely.

    Populates:
      context.dimensions                      — structured list of dimension dicts
      context.metadata["dimensions"]          — same, persisted in metadata
      context.metadata["keyword_sets"]        — flat list of all queries (SC+HC+Provision)
      context.metadata["search_query"]        — first sc_query (primary search seed)
      context.metadata["candidates_ik"]       — IK search results tagged per dimension+query_type
      context.metadata["ik_prefetched"]       — True so WatchdogAgent skips IK
    """
    name        = "legal_dimension_extractor"
    description = "Uses Claude to identify Legal Dimensions and generate 3-tier search queries (SC/HC/Provision) per dimension."

    # ── Prompt template ────────────────────────────────────────────────────
    _PROMPT_TEMPLATE = (
        "You are a senior Indian legal research strategist for a citation retrieval pipeline.\n\n"
        "Your only task is to generate highly relevant legal dimensions and search queries for case-law retrieval.\n\n"
        "Current mode: {mode_label}. {mode_instruction}\n\n"
        "High Court jurisdiction for hc_query: {hc_name} ({hc_name_short})\n\n"
        "Your output will control downstream search across vector search, Indian Kanoon, and web-grounded retrieval.\n"
        "Therefore, do NOT generate broad, generic, constitutional, writ-style, or party-label-driven dimensions"
        " unless the record clearly shows those are central issues.\n\n"
        "MISSION\n"
        "Generate 3 to 5 legal dimensions that are:\n"
        "- controversy-shaped, not topic-shaped\n"
        "- fact-sensitive, not abstract\n"
        "- offence-sensitive where criminal law is involved\n"
        "- tailored to the actual dispute in the file\n"
        "- optimized for retrieving precedent that is materially relevant, not merely lexically similar\n\n"
        "PRIORITY ORDER\n"
        "When inferring dimensions, use this order of importance:\n"
        "1. operative facts\n"
        "2. legal controversy actually arising from those facts\n"
        "3. ingredients of invoked offences / causes of action / statutory requirements\n"
        "4. procedural posture and relief sought\n"
        "5. only then party labels, state names, forum names, or generic public-law framing\n\n"
        "CRITICAL ANTI-DRIFT RULES\n"
        "1. Do NOT create generic dimensions such as:\n"
        "   - locus standi\n"
        "   - maintainability\n"
        "   - statutory duty of the State\n"
        "   - violation of rights\n"
        "   - joinder of parties\n"
        "   - nature of relief\n"
        "   unless the file clearly shows those are core deciding issues.\n\n"
        "2. If the file concerns FIR quashing / criminal proceedings / cheating / forgery / business"
        " dispute / money recovery / NI Act / contractual dispute, dimensions must focus on:\n"
        "   - whether allegations disclose offence ingredients\n"
        "   - whether dispute is civil/commercial but given criminal colour\n"
        "   - whether criminal case is a counterblast / pressure tactic / abuse of process\n"
        "   - effect of parallel civil, recovery, arbitration, or NI Act proceedings\n"
        "   - scope of quashing power in that specific factual setting\n\n"
        "3. Do NOT over-weight the appearance of words like: State, writ, quashing,"
        " petitioner/applicant/respondent. If the facts point elsewhere, follow the facts.\n\n"
        "4. Prefer dimensions that can retrieve precedents with close factual overlap.\n\n"
        "MANDATORY CONTROVERSY COMPRESSION STEP\n"
        "Before generating dimensions, silently derive this internal case map from the materials:\n"
        "- dispute_nature / transaction_type / key_timeline / existing_proceedings\n"
        "- later_impugned_action / offences_or_provisions_invoked\n"
        "- applicant_core_case / respondent_core_case / actual_relief_sought\n"
        "- strongest_factual_signals / likely_decisive_issues\n"
        "Use that map to generate dimensions. Do NOT output the map.\n\n"
        "DIMENSION DESIGN RULES\n"
        "Each dimension must identify one real axis of legal controversy — narrow enough to"
        " retrieve the right precedents, broad enough to return multiple authorities.\n\n"
        "QUERY RULES\n\n"
        "A. sc_query (8-15 words)\n"
        "   - Supreme Court focused, concise but issue-specific\n"
        "   - must target the controlling principle\n"
        "   - include exact act/section (BNS/BNSS 2023 over IPC/CrPC where applicable)\n\n"
        "B. hc_query (8-15 words)\n"
        "   - {hc_name} focused, fact-pattern specific\n"
        "   - MUST contain '{hc_name_short}'\n"
        "   - should be useful for criminal quashing and applied precedent\n\n"
        "C. provision_query (8-15 words)\n"
        "   - must mention the most relevant offence/procedural/Act sections\n"
        "   - target ingredients and quashing tests, not just raw section numbers\n\n"
        "D. semantic_query (30-80 words)\n"
        "   - must be richly factual — encode: transaction background, timeline, existing civil / NI"
        " / recovery / contractual proceedings if any, later FIR / complaint / administrative action"
        " if any, core legal grievance, key offence ingredients or statutory tests, relief sought\n"
        "   - do NOT make it generic, do NOT merely restate the dimension title\n"
        "   - make it suitable for semantic retrieval of materially similar judgments\n\n"
        "SPECIAL RULES FOR CRIMINAL QUASHING MATTERS\n"
        "If the file is a quashing matter, at least 3 dimensions should come from this cluster:\n"
        "1. civil dispute vs criminal offence\n"
        "2. ingredient failure (cheating / forgery / breach of trust / conspiracy etc.)\n"
        "3. abuse of process / mala fide / counterblast after civil or NI proceedings\n"
        "4. parallel proceedings and their legal effect\n"
        "5. threshold for quashing at FIR stage\n\n"
        "SPECIAL RULES FOR CHEATING / FORGERY CASES\n"
        "If sections like 420, 467, 468, 471 (IPC) or analogous BNS offences appear:\n"
        "- at least one dimension must focus on whether the complaint discloses the statutory ingredients\n"
        "- at least one query must target 'dishonest intention at inception'\n"
        "- at least one query must target 'false document' / 'forgery ingredients'\n"
        "- do not collapse all offences into one vague fraud dimension\n\n"
        "RELEVANCE FILTER — before finalising each dimension, test:\n"
        "- Would this retrieve judgments that actually help decide this case?\n"
        "- Is this dimension driven by the controversy, or just by legal vocabulary?\n"
        "- Would this dimension wrongly retrieve broad writ/public-law cases?\n"
        "If yes, rewrite it.\n\n"
        "══════════════════════════════════════════\n"
        "INPUT\n"
        "══════════════════════════════════════════\n\n"
        "User query:\n{base_query}\n\n"
        "Case file context (uploaded documents / file snippets):\n\n{case_context}\n\n"
        "══════════════════════════════════════════\n"
        "OUTPUT REQUIREMENTS\n"
        "══════════════════════════════════════════\n"
        "- Return valid JSON only — no markdown, no commentary, no prose outside JSON\n"
        "- 3 to 5 dimensions only\n"
        "- Each semantic_query must be at least 30 words\n"
        "- Avoid duplicate or overlapping dimensions\n"
        "- Dimensions must be ordered by likely decisiveness\n\n"
        "JSON SCHEMA (return exactly this structure):\n"
        '{{\n'
        '  "dimensions": [\n'
        '    {{\n'
        '      "dimension_id": 1,\n'
        '      "name": "string — controversy-shaped, specific, not generic",\n'
        '      "reasoning": "one sentence: why does this dimension require precedent support?",\n'
        '      "sc_query": "8-15 word Supreme Court query with exact section",\n'
        '      "hc_query": "8-15 word {hc_name_short} query with section",\n'
        '      "provision_query": "8-15 word statute/section/ingredient query",\n'
        '      "semantic_query": "30-80 word richly factual description for vector search"\n'
        '    }}\n'
        '  ]\n'
        '}}'
    )

    @staticmethod
    def _word_count_ok(text: str) -> bool:
        words = [w for w in re.split(r"\s+", (text or "").strip()) if w]
        return 8 <= len(words) <= 15

    def _parse_dimensions(self, raw: str) -> List[Dict[str, Any]]:
        """Extract and validate the dimensions array from LLM output."""
        if not raw:
            return []
        # Strip extended-thinking blocks (Claude thinking mode)
        text = re.sub(r"<thinking>.*?</thinking>", "", raw, flags=re.DOTALL | re.IGNORECASE)
        # Unwrap XML answer/output/response wrapper tags, keeping inner content
        text = re.sub(
            r"<(?:answer|output|response)>(.*?)</(?:answer|output|response)>",
            r"\1", text, flags=re.DOTALL | re.IGNORECASE,
        )
        # Strip markdown fences
        text = re.sub(r"^```(?:json)?\s*", "", text.strip())
        text = re.sub(r"```\s*$", "", text)
        # Attempt full JSON parse
        try:
            obj = json.loads(text)
            if isinstance(obj, list):
                return obj
            if isinstance(obj, dict):
                return obj.get("dimensions") or []
        except Exception:
            pass
        # Fallback: try array block first, then object block
        m = re.search(r"\[.*\]", text, re.DOTALL)
        if m:
            try:
                arr = json.loads(m.group(0))
                if isinstance(arr, list):
                    return arr
            except Exception:
                pass
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            try:
                obj = json.loads(m.group(0))
                if isinstance(obj, dict):
                    return obj.get("dimensions") or []
            except Exception:
                pass
        logger.warning("[LEGAL_DIM_EXTRACTOR] Could not parse dimensions JSON")
        return []

    def _validate_dimensions(self, dimensions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Enforce production schema:
        - 3 to 5 dimensions
        - each has id, name, reasoning
        - sc/hc/provision queries present and 8-15 words
        - semantic_query present and 30+ words (synthesised from all fields if missing/short)

        Accepts both flat format (queries at top level — new schema) and nested format
        (queries in a 'queries' sub-dict — legacy schema), normalising to nested internally.
        """
        validated: List[Dict[str, Any]] = []
        for idx, dim in enumerate(dimensions[:MAX_DIMENSIONS]):
            if not isinstance(dim, dict):
                continue
            name      = str(dim.get("name") or "").strip()
            reasoning = str(dim.get("reasoning") or "").strip()
            # Optional legacy enrichment fields
            dispute    = str(dim.get("dispute") or "").strip()
            prayer_link = str(dim.get("prayer_link") or "").strip()

            # Accept both flat (new schema) and nested 'queries' dict (legacy schema)
            qs = dim.get("queries") or {}
            sc_q   = str(dim.get("sc_query") or qs.get("sc_query") or "").strip()
            hc_q   = str(dim.get("hc_query") or qs.get("hc_query") or "").strip()
            prov_q = str(dim.get("provision_query") or qs.get("provision_query") or "").strip()

            if not (name and reasoning and sc_q and hc_q and prov_q):
                continue
            if not (self._word_count_ok(sc_q) and self._word_count_ok(hc_q) and self._word_count_ok(prov_q)):
                continue

            # semantic_query: use LLM output if ≥25 words; otherwise synthesise a rich fallback
            # covering reasoning, name, and all 3 keyword queries for maximum Qdrant coverage.
            sem_q = str(dim.get("semantic_query") or qs.get("semantic_query") or "").strip()
            sem_words = [w for w in sem_q.split() if w]
            if len(sem_words) < 25:
                sem_q = " ".join(filter(None, [
                    dispute or name,
                    prayer_link,
                    reasoning,
                    sc_q,
                    hc_q,
                    prov_q,
                ]))

            did = dim.get("dimension_id")
            try:
                did = int(did)
            except Exception:
                did = idx + 1
            validated.append({
                "dimension_id": did,
                "name":         name,
                "dispute":      dispute,
                "prayer_link":  prayer_link,
                "reasoning":    reasoning,
                "queries": {
                    "sc_query":        sc_q,
                    "hc_query":        hc_q,
                    "provision_query": prov_q,
                    "semantic_query":  sem_q,
                },
            })
        # Cap at 5 — 5 specific dimensions outperform 6 generic ones
        if len(validated) > 5:
            validated = validated[:5]
        return validated

    def _dimensions_to_keyword_sets(self, dimensions: List[Dict[str, Any]]) -> List[str]:
        """Flatten all dimension queries into a deduplicated keyword_sets list.
        sc/hc/provision queries go to IK and Google keyword search.
        semantic_query is excluded from keyword_sets (it is used only for Qdrant vector search).
        """
        seen: set = set()
        kw: List[str] = []
        for dim in dimensions:
            qs = dim.get("queries") or {}
            for key in ("sc_query", "hc_query", "provision_query"):
                q = (qs.get(key) or "").strip()
                if q and q not in seen:
                    seen.add(q)
                    kw.append(q[:400])
        return kw

    def _search_ik_for_dimensions(
        self,
        dimensions: List[Dict[str, Any]],
        run_id: Optional[str],
        user_id: str,
        per_query_limit: int = 5,
    ) -> List[Dict[str, Any]]:
        """
        Call India Kanoon API for each dimension's sc_query / hc_query / provision_query
        in parallel (uses INDIAN_KANOON_TOKEN from .env via services.indian_kanoon.ik_search).

        Returns a flat, deduplicated list of IK candidates tagged with
        _dimension_id, _dimension_name, and _query_type so downstream agents
        can see which Legal Dimension each judgment serves.
        """
        from services.indian_kanoon import ik_search
        from concurrent.futures import ThreadPoolExecutor, as_completed as _as_completed

        # Build task list: (dim_id, dim_name, query_type_label, query_string)
        tasks: List[tuple] = []
        for dim in dimensions:
            dim_id   = dim.get("dimension_id", "?")
            dim_name = dim.get("name", "")
            qs       = dim.get("queries") or {}
            for q_type, q_key in (("sc", "sc_query"), ("hc", "hc_query"), ("provision", "provision_query")):
                q = (qs.get(q_key) or "").strip()
                if q:
                    tasks.append((dim_id, dim_name, q_type, q))

        if not tasks:
            return []

        logger.info("[LEGAL_DIM_EXTRACTOR] Searching IK API for %d queries (%d dimensions × 3 types)",
                    len(tasks), len(dimensions))

        try:
            from db.client import agent_log_insert
            agent_log_insert(run_id, None, self.name, self.name, "INFO",
                f"📚 Querying India Kanoon API for {len(tasks)} dimension queries in parallel…",
                {"task_count": len(tasks), "dimension_count": len(dimensions)})
        except Exception:
            pass

        raw_results: List[tuple] = []  # (dim_id, dim_name, q_type, query, docs_list)

        def _search_one(dim_id, dim_name, q_type, query):
            try:
                resp = ik_search(query, pagenum=0, doctypes="judgments")
                docs = (resp or {}).get("docs") or []
                logger.info("[LEGAL_DIM_EXTRACTOR] IK [dim=%s|%s] %r → %d result(s)",
                            dim_id, q_type, query[:60], len(docs))
                return dim_id, dim_name, q_type, query, docs[:per_query_limit]
            except Exception as exc:
                logger.warning("[LEGAL_DIM_EXTRACTOR] IK search failed for %r: %s", query[:60], exc)
                return dim_id, dim_name, q_type, query, []

        workers = min(len(tasks), max(3, _env_int("CITATION_WATCHDOG_WORKERS", 6)))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(_search_one, *t): t for t in tasks}
            for fut in _as_completed(futures):
                try:
                    raw_results.append(fut.result(timeout=20))
                except Exception as exc:
                    logger.warning("[LEGAL_DIM_EXTRACTOR] IK task error: %s", exc)

        # Record IK search usage
        try:
            from utils.usage_tracker import record_ik
            record_ik(run_id, user_id, "search", count=len(tasks))
        except Exception:
            pass

        # Deduplicate by tid, preserving first-seen dimension tag
        try:
            from agents.watchdog import _is_pending_result as _ik_is_pending
        except Exception:
            _ik_is_pending = None

        seen_tids: set = set()
        candidates: List[Dict[str, Any]] = []
        pending_dropped = 0
        for dim_id, dim_name, q_type, query, docs in raw_results:
            for d in docs:
                tid = str(d.get("tid") or "").strip()
                if not tid or tid in seen_tids:
                    continue
                candidate_dict = {
                    "external_id": tid,
                    "title":       d.get("title", ""),
                    "snippet":     d.get("headline", ""),
                    "docsource":   d.get("docsource", ""),
                    "_source":     "indian_kanoon",
                    "_dimension_id":   dim_id,
                    "_dimension_name": dim_name,
                    "_query_type":     q_type,
                    "_query":          query,
                }
                if _ik_is_pending and _ik_is_pending(candidate_dict):
                    logger.debug("[LEGAL_DIM_EXTRACTOR] Dropped Pending result: %s (%s)", tid, d.get("title", ""))
                    pending_dropped += 1
                    continue
                seen_tids.add(tid)
                candidates.append(candidate_dict)

        total_raw = sum(len(r[4]) for r in raw_results)
        logger.info("[LEGAL_DIM_EXTRACTOR] IK search complete — %d raw results → %d unique candidates (%d pending dropped)",
                    total_raw, len(candidates), pending_dropped)
        try:
            from db.client import agent_log_insert
            agent_log_insert(run_id, None, self.name, self.name, "INFO",
                f"✅ India Kanoon search done — {total_raw} raw results → {len(candidates)} unique candidates ({pending_dropped} pending dropped)",
                {"raw_total": total_raw, "unique_candidates": len(candidates),
                 "pending_dropped": pending_dropped,
                 "queries_run": len(tasks), "tids": [c["external_id"] for c in candidates[:20]]})
        except Exception:
            pass

        return candidates

    def run(self, context: AgentContext) -> AgentResult:
        run_id       = context.metadata.get("run_id")
        case_context = context.metadata.get("case_file_context", [])
        base_query   = (context.query or "").strip()
        user_id      = context.metadata.get("user_id") or context.user_id or "anonymous"
        mode_label   = "MODE 1" if case_context else "MODE 2"
        mode_instruction = (
            "Case folder context is present. Use the case context as primary source."
            if case_context
            else "No case folder context. Use user description only and decompose all legal dimensions."
        )
        context.metadata["citation_finder_mode"] = 1 if case_context else 2

        try:
            from db.client import agent_log_insert
            if case_context:
                agent_log_insert(run_id, None, self.name, self.name, "INFO",
                    f"⚖ Legal Dimension Extractor — analysing {len(case_context)} case file(s) to identify core Legal Dimensions…",
                    {"file_count": len(case_context)})
            else:
                agent_log_insert(run_id, None, self.name, self.name, "INFO",
                    f"⚖ Legal Dimension Extractor — no case context; using query as seed: {base_query[:80]!r}",
                    {"query": base_query})
        except Exception:
            pass

        # ── Fallback: no case context and no query seed ───────────────────
        if not case_context and not base_query:
            _cm = context.metadata.get("controversy_map") or {}
            _fallback_query = str(_cm.get("controversy_query") or _cm.get("central_controversy") or "").strip()
            context.metadata["search_query"] = _fallback_query
            _ik_phrases_early: list = []
            for _field in ("factual_trigger", "legal_claim", "central_controversy"):
                _val = str(_cm.get(_field) or "").strip()
                if _val:
                    _phrase = " ".join(_val.split()[:12])
                    if _phrase and _phrase not in _ik_phrases_early:
                        _ik_phrases_early.append(_phrase)
            if not _ik_phrases_early and _fallback_query:
                _stripped_e = re.sub(
                    r'^(?:did|does|was|were|is|are|whether|how|what|why|when)\s+(?:the\s+)?',
                    '', _fallback_query.strip(), flags=re.IGNORECASE,
                )
                _stripped_e = re.sub(
                    r'^(?:high|supreme|bombay|delhi|madras|allahabad|calcutta|gujarat|'
                    r'karnataka|kerala|punjab|haryana|rajasthan|telangana|andhra|orissa)\s+'
                    r'court\s+\w+\s+',
                    '', _stripped_e, flags=re.IGNORECASE,
                )
                _kw_e = " ".join(_stripped_e.split()[:10])
                if _kw_e:
                    _ik_phrases_early.append(_kw_e)
            context.metadata["keyword_sets"] = _ik_phrases_early if _ik_phrases_early else ([_fallback_query] if _fallback_query else [])
            context.metadata["dimensions"] = []
            context.dimensions = []
            return AgentResult(data={
                "search_query": base_query,
                "augmented": False,
                "dimensions_count": 0,
                "keyword_sets_count": len(context.metadata["keyword_sets"]),
                "message": "No case file context or query description; nothing to extract.",
            })

        # ── Build case text from file snippets ────────────────────────────
        parts: List[str] = []
        chunks_used: List[Dict[str, Any]] = []
        embeddings_used: List[str] = []

        # Patterns that indicate high-value legal sections (prayer, issues, conflict)
        _PRIORITY_PATTERNS = re.compile(
            r"(?:wherefore|prayer|prayers|relief\s+sought|it\s+is\s+(?:humbly\s+)?prayed"
            r"|points?\s+of\s+(?:dispute|conflict|contention|determination|law)"
            r"|issues?\s+framed|question(?:s)?\s+of\s+law|grounds?\s+of\s+(?:appeal|challenge|petition)"
            r"|contentions?\s+of\s+(?:petitioner|appellant|respondent|plaintiff|defendant)"
            r"|prayer\s+clause|directions?\s+sought|order(?:s)?\s+sought)",
            re.IGNORECASE,
        )

        priority_parts: List[str] = []   # prayer / issues / conflict sections — prepended
        regular_parts:  List[str] = []   # remaining context

        for idx, f in enumerate(case_context[:20]):
            name    = f.get("name") or f.get("filename") or "document"
            snippet = (f.get("snippet") or f.get("content") or "")[:8000]
            if not snippet:
                continue

            # Check if this chunk contains high-value legal analysis sections
            is_priority = bool(_PRIORITY_PATTERNS.search(snippet))
            bucket = priority_parts if is_priority else regular_parts
            bucket.append(f"[{name}{'  ← prayer/issues/conflict' if is_priority else ''}]\n{snippet}")

            chunk_info: Dict[str, Any] = {
                "file_name": name,
                "chunk_index": idx,
                "snippet_length": len(snippet),
                "is_priority": is_priority,
                "snippet_preview": snippet[:150] + ("…" if len(snippet) > 150 else ""),
            }
            if f.get("chunk_id") is not None:
                chunk_info["chunk_id"] = f["chunk_id"]
            if f.get("embedding_id") is not None:
                chunk_info["embedding_id"] = f["embedding_id"]
                embeddings_used.append(str(f["embedding_id"]))
            chunks_used.append(chunk_info)

        # Priority sections first so Claude reads prayer/issues before generic facts
        parts = priority_parts + regular_parts

        context.metadata["keyword_extraction_chunks_used"] = chunks_used
        context.metadata["keyword_extraction_embeddings_used"] = embeddings_used
        context.metadata["priority_chunks_count"] = len(priority_parts)

        if not parts and base_query:
            parts.append(f"[USER_DESCRIPTION]\n{base_query}")

        # ── Resolve High Court name from metadata ─────────────────────────
        hc_name       = _resolve_hc_name(context)
        hc_name_short = hc_name.replace(" High Court", "").strip()
        num_dimensions = min(8, max(6, MAX_DIMENSIONS))  # hint only; model targets 6-8

        priority_count = len(priority_parts)
        chunk_summary = ", ".join(
            f"{c['file_name']} (chunk {c['chunk_index']}, {c['snippet_length']} chars{', PRIORITY' if c.get('is_priority') else ''})"
            for c in chunks_used[:10]
        ) + (f" … and {len(chunks_used) - 10} more" if len(chunks_used) > 10 else "")
        logger.info("[LEGAL_DIM_EXTRACTOR] Analysing chunks: %s | HC=%s | priority_chunks=%d",
                    chunk_summary or "none", hc_name, priority_count)

        # ── Build & send prompt ───────────────────────────────────────────
        case_context_str = "\n\n".join(parts[:15])
        pc = None
        try:
            from utils.prompt_resolver import resolve_prompt
            pc = resolve_prompt(
                name="LegalDimensionExtractor",
                agent_type="citation",
                default_prompt=self._PROMPT_TEMPLATE,
                default_model=os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-20250514"),
                default_temperature=0.1,
                default_max_tokens=2000,
            )
            prompt = pc.prompt.format(
                num_dimensions=num_dimensions,
                hc_name=hc_name,
                hc_name_short=hc_name_short,
                mode_label=mode_label,
                mode_instruction=mode_instruction,
                base_query=base_query,
                case_context=case_context_str,
            )
            logger.info("[LEGAL_DIM_EXTRACTOR] Prompt source=%s model=%s temp=%.2f", pc.source, pc.model_name, pc.temperature)
        except Exception as exc:
            logger.warning("[LEGAL_DIM_EXTRACTOR] Prompt resolver failed (%s), using default", exc)
            prompt = self._PROMPT_TEMPLATE.format(
                num_dimensions=num_dimensions,
                hc_name=hc_name,
                hc_name_short=hc_name_short,
                mode_label=mode_label,
                mode_instruction=mode_instruction,
                base_query=base_query,
                case_context=case_context_str,
            )

        claude_cfg = dict(pc.claude_config) if pc and pc.claude_config else {}
        raw_response = self._claude(
            prompt,
            max_tokens=max(claude_cfg.pop("max_tokens", 3000), 3000),  # floor at 3000; DB override may be lower
            temperature=claude_cfg.pop("temperature", 0.1),
            run_id=run_id,
            user_id=user_id,
            operation="legal_dimension_extract",
            **claude_cfg,
        )

        # ── Parse dimensions ──────────────────────────────────────────────
        dimensions = self._parse_dimensions(raw_response or "")
        validated_dims = self._validate_dimensions(dimensions)

        if not validated_dims:
            # Graceful fallback: use controversy_map seed when base_query is empty
            _cm = context.metadata.get("controversy_map") or {}
            _fallback_query = base_query or str(_cm.get("controversy_query") or _cm.get("central_controversy") or "").strip()
            _seed_source = "base_query" if base_query else ("controversy_map" if _fallback_query else "none")
            logger.warning("[LEGAL_DIM_EXTRACTOR] Insufficient valid dimensions (%d); falling back to %s seed: %r",
                           len(validated_dims), _seed_source, _fallback_query[:80])
            context.metadata["search_query"] = _fallback_query
            # Build short IK-friendly keyword phrases (IK needs ≤12 words; controversy_query is 40-60 words)
            # Mirrors the same logic in watchdog.py:339-348
            _ik_phrases: list = []
            for _field in ("factual_trigger", "legal_claim", "central_controversy"):
                _val = str(_cm.get(_field) or "").strip()
                if _val:
                    _phrase = " ".join(_val.split()[:12])
                    if _phrase and _phrase not in _ik_phrases:
                        _ik_phrases.append(_phrase)
            if base_query and len(base_query.split()) <= 15 and base_query not in _ik_phrases:
                _ik_phrases.insert(0, base_query)
            # If all cm fields were empty, derive clean keywords from the controversy_query
            # by stripping question preamble ("Did the X correctly Y" → meaningful nouns)
            if not _ik_phrases and _fallback_query:
                _stripped = re.sub(
                    r'^(?:did|does|was|were|is|are|whether|how|what|why|when)\s+(?:the\s+)?',
                    '', _fallback_query.strip(), flags=re.IGNORECASE,
                )
                _stripped = re.sub(
                    r'^(?:high|supreme|bombay|delhi|madras|allahabad|calcutta|gujarat|'
                    r'karnataka|kerala|punjab|haryana|rajasthan|telangana|andhra|orissa)\s+'
                    r'court\s+\w+\s+',
                    '', _stripped, flags=re.IGNORECASE,
                )
                _kw = " ".join(_stripped.split()[:10])
                if _kw:
                    _ik_phrases.append(_kw)
            context.metadata["keyword_sets"] = _ik_phrases if _ik_phrases else ([_fallback_query] if _fallback_query else [])
            context.metadata["dimensions"] = []
            context.dimensions = []
            try:
                from db.client import agent_log_insert
                agent_log_insert(run_id, None, self.name, self.name, "WARNING",
                    "⚠ Valid dimension count was below 3; using base query as fallback",
                    {"raw_preview": (raw_response or "")[:300], "fallback_query": _fallback_query[:120]})
            except Exception:
                pass
            return AgentResult(data={
                "search_query": _fallback_query,
                "augmented": False,
                "dimensions_count": 0,
                "keyword_sets_count": len(context.metadata["keyword_sets"]),
                "message": "Dimension extraction failed; using base query.",
            })

        # ── Persist to context ────────────────────────────────────────────
        context.dimensions = validated_dims
        context.metadata["dimensions"] = validated_dims

        keyword_sets = self._dimensions_to_keyword_sets(validated_dims)
        context.metadata["keyword_sets"] = keyword_sets
        context.metadata["search_query"] = (
            validated_dims[0].get("queries", {}).get("sc_query") or keyword_sets[0] or base_query
        )

        # ── Log dimensions ────────────────────────────────────────────────
        logger.info("[LEGAL_DIM_EXTRACTOR] %d dimension(s), %d keyword set(s)", len(validated_dims), len(keyword_sets))
        for d in validated_dims:
            qs = d.get("queries") or {}
            logger.info(
                "[LEGAL_DIM_EXTRACTOR] DIM %s | %s | dispute=%s | SC=%s | HC=%s | PROVISION=%s",
                d.get("dimension_id"),
                (d.get("name") or "")[:90],
                (d.get("dispute") or "")[:120],
                (qs.get("sc_query") or "")[:160],
                (qs.get("hc_query") or "")[:160],
                (qs.get("provision_query") or "")[:160],
            )
        dim_preview = " | ".join(
            f"[{d.get('dimension_id','?')}] {d.get('name','?')}" for d in validated_dims[:4]
        ) + ("…" if len(validated_dims) > 4 else "")
        try:
            from db.client import agent_log_insert
            agent_log_insert(run_id, None, self.name, self.name, "INFO",
                f"✅ Extracted {len(validated_dims)} Legal Dimension(s): {dim_preview}",
                {
                    "dimensions_count": len(validated_dims),
                    "keyword_sets_count": len(keyword_sets),
                    "priority_chunks_used": context.metadata.get("priority_chunks_count", 0),
                    "dimensions": [
                        {
                            "id": d.get("dimension_id"),
                            "name": d.get("name"),
                            "dispute": d.get("dispute"),
                            "prayer_link": d.get("prayer_link"),
                            "reasoning": d.get("reasoning"),
                            "sc_query": (d.get("queries") or {}).get("sc_query"),
                            "hc_query": (d.get("queries") or {}).get("hc_query"),
                            "provision_query": (d.get("queries") or {}).get("provision_query"),
                            "semantic_query": (d.get("queries") or {}).get("semantic_query", "")[:120],
                        }
                        for d in validated_dims
                    ],
                })
        except Exception:
            pass

        return AgentResult(data={
            "search_query":            context.metadata["search_query"],
            "augmented":               True,
            "dimensions_count":        len(validated_dims),
            "keyword_sets_count":      len(keyword_sets),
            "chunks_used_for_keywords": chunks_used,
            "embeddings_used":         embeddings_used,
            "message": (
                f"Extracted {len(validated_dims)} Legal Dimension(s) with "
                f"{len(keyword_sets)} search queries from {len(chunks_used)} file chunk(s)"
                + (f", {len(embeddings_used)} embedding(s)" if embeddings_used else "")
            ),
        })


# Keep alias so any direct import of KeywordExtractorAgent (e.g., main.py fallback) still works.
KeywordExtractorAgent = LegalDimensionExtractor


# ══════════════════════════════════════════════════════════════════════════════
# ROOT ORCHESTRATOR AGENT
# ══════════════════════════════════════════════════════════════════════════════

class CitationRootAgent(BaseAgent):
    """
    Root orchestrator agent (ADK-compatible).
    Delegates to sub-agents in sequence:
      LegalDimensionExtractor → Watchdog → Fetcher → Clerk → Librarian → Auditor → ReportBuilder

    Fetcher + Clerk run in parallel when possible.
    """
    name        = "citation_root_agent"
    description = "Root orchestrator for the JuriNex citation verification pipeline."

    def __init__(self):
        super().__init__()
        self.controversy_mapper        = ControversyMapperAgent()
        self.legal_dimension_extractor = LegalDimensionExtractor()
        self.watchdog          = WatchdogAgent()
        self.fetcher           = FetcherAgent()
        self.clerk             = ClerkAgent()
        self.relevance_ranker  = None   # lazy import to avoid circular deps at module load
        self.librarian         = LibrarianAgent()
        self.auditor           = AuditorAgent()
        self.report_builder    = ReportBuilderAgent()

        # Sub-agents list (ADK convention)
        self.sub_agents = [
            self.controversy_mapper,
            self.legal_dimension_extractor,
            self.watchdog,
            self.fetcher,
            self.clerk,
            self.librarian,
            self.auditor,
            self.report_builder,
        ]

    def _get_relevance_ranker(self):
        if self.relevance_ranker is None:
            from agents.relevance_ranker import RelevanceRankerAgent
            self.relevance_ranker = RelevanceRankerAgent()
        return self.relevance_ranker

    def _log_agent_prompt_info(self, agent_name: str, duration: float, run_id: str, report_id: str) -> None:
        """Helper to centralize rich console prompt logging for all agents."""
        try:
            from utils.rich_logger import pipeline_console
        except ImportError:
            return

        # LLM agent mapping: (agent name → prompt resolver name, default_model)
        llm_map = {
            "legal_dimension_extractor": ("LegalDimensionExtractor", os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-20250514")),
            "clerk":                     ("Clerk",                   os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")),
            "report_builder":            ("ReportBuilder",           os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")),
        }
        # Note: citation_agent and subsequent_treatment_extractor are not directly wrapped here in the main pipeline flow
        # as they are edge cases / fallbacks / inner loops, but the primary 7 agents are covered.

        if agent_name in llm_map:
            resolver_name, default_model = llm_map[agent_name]
            try:
                from utils.prompt_resolver import resolve_prompt
                pc = resolve_prompt(
                    name=resolver_name,
                    agent_type="citation",
                    default_prompt="",  # We only need metadata here, not the full prompt text
                    default_model=default_model,
                    default_temperature=0.0,  # Doesn't matter, we want what's in DB or Cache
                )
                pipeline_console.log_agent_start(
                    agent_name=resolver_name,
                    prompt_source=pc.source,
                    prompt_name=pc.prompt_name,
                    model_name=pc.model_name,
                    temperature=pc.temperature,
                    max_tokens=pc.max_tokens,
                    warnings=pc.warnings or None,
                    duration=duration,
                )
                try:
                    from db.client import agent_log_insert
                    agent_log_insert(
                        run_id=run_id, report_id=report_id, agent_name=agent_name, stage="prompt_info", log_level="INFO",
                        message=f"Prompt metadata config: {pc.source}",
                        metadata={
                            "type": "AGENT_PROMPT_INFO",
                            "agent": resolver_name,
                            "prompt_key": pc.prompt_name,
                            "source": pc.source.upper(),
                            "model": pc.model_name,
                            "temperature": pc.temperature,
                            "max_tokens": pc.max_tokens,
                            "runtime": duration
                        }
                    )
                except Exception as db_e:
                    logger.error("[ROOT] Failed to insert prompt DB log: %s", db_e)
            except Exception as e:
                logger.warning("[ROOT] Failed to log prompt info for %s: %s", agent_name, e)
                if agent_name == "legal_dimension_extractor": disp_name = "LegalDimensionExtractor"
                elif agent_name == "clerk":                   disp_name = "Clerk"
                elif agent_name == "report_builder":          disp_name = "ReportBuilder"
                else:                                         disp_name = agent_name.capitalize()
                pipeline_console.log_agent_start(agent_name=disp_name, prompt_source="n/a", duration=duration)
                
                # Still send N/A event to frontend for failed LLM agent resolutions
                try:
                    from db.client import agent_log_insert
                    agent_log_insert(
                        run_id=run_id, report_id=report_id, agent_name=agent_name, stage="prompt_info", log_level="INFO",
                        message=f"Prompt metadata: n/a",
                        metadata={"type": "AGENT_PROMPT_INFO", "agent": disp_name, "source": "N/A", "runtime": duration}
                    )
                except Exception as db_e:
                    logger.error("[ROOT] Failed to insert N/A prompt DB log: %s", db_e)
        else:
            # Non-LLM agents (Watchdog, Fetcher, Librarian, Auditor)
            disp_map = {
                "watchdog":  "Watchdog",
                "fetcher":   "Fetcher",
                "librarian": "Librarian",
                "auditor":   "Auditor",
            }
            disp_name = disp_map.get(agent_name, agent_name.capitalize())
            pipeline_console.log_agent_start(agent_name=disp_name, prompt_source="n/a", duration=duration)
            try:
                from db.client import agent_log_insert
                agent_log_insert(
                    run_id=run_id, report_id=report_id, agent_name=agent_name, stage="prompt_info", log_level="INFO",
                    message=f"Prompt metadata: n/a",
                    metadata={"type": "AGENT_PROMPT_INFO", "agent": disp_name, "source": "N/A", "runtime": duration}
                )
            except Exception as db_e:
                 logger.error("[ROOT] Failed to insert non-LLM prompt log: %s", db_e)


    def _delegate(self, agent: BaseAgent, context: AgentContext, stage: str) -> AgentResult:
        """Run a sub-agent, log results, and persist to agent_logs."""
        run_id = context.metadata.get("run_id")
        report_id = context.metadata.get("report_id")
        
        try:
            from db.client import agent_log_insert
            agent_log_insert(run_id, report_id, agent.name, stage, "INFO", f"Delegating to {agent.name}", None)
        except Exception:
            pass
        logger.info("╔══ [ROOT] Delegating to %-20s ══════════════════╗", agent.name.upper())
        try:
            import time
            start_t = time.time()
            result = agent.run(context)
            duration = time.time() - start_t
            
            self._log_agent_prompt_info(agent.name, duration, run_id, report_id)
            
            level = "INFO" if result.success else "WARNING"
            msg = f"{agent.name} OK" if result.success else f"{agent.name} FAILED: {result.error}"
            if result.success and result.data and agent.name == "legal_dimension_extractor":
                chunks = result.data.get("chunks_used_for_keywords") or []
                emb    = result.data.get("embeddings_used") or []
                dims   = result.data.get("dimensions_count", 0)
                msg = f"{msg} | {dims} Legal Dimension(s), {result.data.get('keyword_sets_count', 0)} queries from {len(chunks)} chunk(s)"
                if emb:
                    msg += f", {len(emb)} embedding(s)"
                if chunks:
                    msg += ". Chunks: " + ", ".join(f"{c.get('file_name', '?')}({c.get('chunk_index', '?')})" for c in chunks[:5])
                    if len(chunks) > 5:
                        msg += f" +{len(chunks) - 5} more"
                if emb:
                    msg += ". Embedding IDs: " + ", ".join(str(e) for e in emb[:10]) + (" …" if len(emb) > 10 else "")
            try:
                from db.client import agent_log_insert
                agent_log_insert(run_id, report_id, agent.name, stage, level, msg[:10000], result.data)
            except Exception:
                pass
            if result.success:
                logger.info("║  ✓ %s OK  data=%s", agent.name, str(result.data)[:120])
            else:
                logger.warning("║  ✗ %s FAILED  error=%s", agent.name, result.error)
            logger.info("╚══════════════════════════════════════════════════════════╝")
            return result
        except Exception as e:
            logger.exception("╚══ [ROOT] %s crashed: %s", agent.name, e)
            try:
                from db.client import agent_log_insert
                agent_log_insert(run_id, report_id, agent.name, stage, "ERROR", f"{agent.name} crashed: {e}", {"error": str(e)})
            except Exception:
                pass
            return AgentResult(success=False, error=str(e))

    def run(self, context: AgentContext) -> AgentResult:
        """Full pipeline execution."""
        run_id = context.metadata.get("run_id")
        try:
            from db.client import agent_log_insert
            agent_log_insert(run_id, None, "root", "start", "INFO", "Pipeline started", {"query": (context.query or "")[:500]})
        except Exception:
            pass
        logger.info("╔══ CITATION ROOT AGENT — START ══════════════════════════╗")
        logger.info("║  query  : %s", context.query[:70])
        logger.info("║  user   : %s | case: %s", context.user_id, context.case_id or "—")
        logger.info("╚══════════════════════════════════════════════════════════╝")

        # CHECK 1: Ensure pipeline has at least some direction (query or context)
        case_id = context.case_id
        case_file_context = context.metadata.get("case_file_context") or []
        has_context = bool((context.query or "").strip()) or any(
            (f.get("snippet") or f.get("content") or "").strip() for f in case_file_context
        )
        if not has_context:
            if case_id:
                # Case context fetch may have failed (DOCUMENT_SERVICE_URL not set, etc.)
                # Use the case_id itself as a fallback search seed so pipeline can still run.
                logger.warning(
                    "[ROOT] case_id=%s set but context and query are both empty "
                    "(document-service unreachable?). Proceeding with case_id as search seed.",
                    case_id,
                )
                context.query = f"legal case analysis {case_id}"
                context.metadata["case_file_context"] = []
            else:
                msg = (
                    "Nothing to search: query is empty and no case context provided. "
                    "Please enter a search query or select a case."
                )
                logger.warning("[ROOT] %s", msg)
                return AgentResult(success=False, error=msg)

        # 0.5 Controversy Mapper — compress the dispute before dimension extraction
        self._delegate(self.controversy_mapper, context, "controversy_mapper")

        # 1. Legal Dimension Extraction (identifies core disputes + generates 3-tier queries)
        self._delegate(self.legal_dimension_extractor, context, "legal_dimension_extractor")

        # Build job manifest and CHECK 2: manifest non-empty
        manifest = _build_manifest(context)
        context.metadata["manifest"] = manifest
        if _manifest_is_empty(manifest):
            msg = (
                "Job manifest is empty: no search_query, no case_text, and no keyword_sets. "
                "Cannot run Watchdog. Abort."
            )
            logger.warning("[ROOT] %s", msg)
            return AgentResult(success=False, error=msg)

        # 2. Watchdog — find candidates
        wd_result = self._delegate(self.watchdog, context, "watchdog")
        if not wd_result.success:
            return AgentResult(success=False, error=f"Watchdog failed: {wd_result.error}")

        # 2.5 Wide-net IK augmentation (opt-in: CITATION_WIDE_NET_ENABLED=1)
        # Injects outcome-targeted queries and landmark seeds into candidates_ik
        # before the Fetcher runs, so all candidates are fetched in one batch.
        _augment_candidates_wide_net(context)

        # 3. Fetcher + Clerk in parallel (fetch external docs & ingest them)
        #    Only run if there are external candidates
        ik_cands, go_cands = _filter_new_external_candidates(
            context,
            context.metadata.get("candidates_ik", []),
            context.metadata.get("candidates_google", []),
        )
        context.metadata["candidates_ik"] = ik_cands
        context.metadata["candidates_google"] = go_cands

        need_local_clerk = bool(context.metadata.get("local_canonical_ids_needing_analysis"))
        if ik_cands or go_cands:
            # Fetcher first, then HoldingFilter, then Clerk
            self._delegate(self.fetcher, context, "fetcher")
            # 3.3 Holding-level LLM filter (opt-in: CITATION_HOLDING_FILTER_ENABLED=1)
            # Drops fetched docs whose holdings are irrelevant to the controversy.
            # Seeds bypass this filter. Runs BEFORE Clerk so only relevant docs are ingested.
            _apply_holding_filter(context)
            self._delegate(self.clerk,   context, "clerk")
        elif need_local_clerk:
            logger.info("[ROOT] No external candidates — running Clerk for Qdrant-local analysis gaps only")
            self._delegate(self.clerk, context, "clerk")
        else:
            logger.info("[ROOT] No external candidates — skipping Fetcher/Clerk")

        if not context.judgement_ids:
            logger.warning("[ROOT] No judgements found — running fallback via citation_agent")
            return self._fallback(context)

        # 3.5 RelevanceRanker — score & reorder judgement_ids before Librarian
        self._delegate(self._get_relevance_ranker(), context, "relevance_ranker")

        # 4. Librarian — validate & enrich
        self._delegate(self.librarian, context, "librarian")

        # 5. Auditor — gate final list (CHECK 8: retry if < TARGET points)
        accumulated_approved: List[str] = []
        for audit_round in range(MAX_AUDIT_RETRIES + 1):
            aud_result = self._delegate(self.auditor, context, "auditor")
            audit_data = aud_result.data or {}
            context.metadata["audit_details"] = context.metadata.get("audit_details") or {}
            context.metadata["audit_details"].update(audit_data.get("audit_details") or {})
            # Accumulate quarantined_ids across retry rounds (derive from audit_details — AuditorAgent returns counts, not arrays)
            existing_quar = context.metadata.get("quarantined_ids") or []
            _ad = context.metadata.get("audit_details") or {}
            new_quar = [j for j, d in _ad.items() if d.get("audit_status") == "QUARANTINED"]
            context.metadata["quarantined_ids"] = list(dict.fromkeys(existing_quar + new_quar))
            # Accumulate approved IDs across all rounds (do not lose prior rounds' approved set)
            new_approved = context.metadata.get("approved_ids") or []
            seen_approved = set(accumulated_approved)
            for jid in new_approved:
                if jid not in seen_approved:
                    accumulated_approved.append(jid)
                    seen_approved.add(jid)
            approved_count = len(accumulated_approved)  # CHANGE 2A: was audit_data.get("approved_count") which returned None
            if approved_count >= TARGET_CITATION_POINTS:
                break
            if approved_count > 0 and not ENABLE_EXPANSION_RETRY:
                logger.info(
                    "[ROOT] Expansion retry disabled; proceeding to report build with %d approved citation(s)",
                    approved_count,
                )
                break
            if approved_count >= MIN_APPROVED_TO_FINISH:
                logger.info(
                    "[ROOT] Approved=%d reached soft threshold %d/%d; proceeding to report build",
                    approved_count, MIN_APPROVED_TO_FINISH, TARGET_CITATION_POINTS,
                )
                break
            if audit_round >= MAX_AUDIT_RETRIES:
                logger.warning("[ROOT] After %d rounds still have %d approved (target %d)", audit_round + 1, approved_count, TARGET_CITATION_POINTS)
                break
            # Retry: fetch more candidates for missing slots
            logger.info("[ROOT] Retry %d: approved=%d < %d — re-running Watchdog/Fetcher/Clerk for more candidates", audit_round + 1, approved_count, TARGET_CITATION_POINTS)
            self._delegate(self.watchdog, context, "watchdog")
            _augment_candidates_wide_net(context)
            ik_cands, go_cands = _filter_new_external_candidates(
                context,
                context.metadata.get("candidates_ik", []),
                context.metadata.get("candidates_google", []),
            )
            context.metadata["candidates_ik"] = ik_cands
            context.metadata["candidates_google"] = go_cands
            _need_local = bool(context.metadata.get("local_canonical_ids_needing_analysis"))
            if ik_cands or go_cands:
                self._delegate(self.fetcher, context, "fetcher")
                _apply_holding_filter(context)
                self._delegate(self.clerk, context, "clerk")
            elif _need_local:
                self._delegate(self.clerk, context, "clerk")
            else:
                logger.info("[ROOT] Retry %d produced no new external candidates; stopping retries", audit_round + 1)
                break
            # Re-rank new candidates before Librarian
            self._delegate(self._get_relevance_ranker(), context, "relevance_ranker")
            # Merge accumulated_approved back so Librarian/Auditor can include them next round
            existing = set(accumulated_approved)
            merged = list(accumulated_approved)
            for jid in context.judgement_ids:
                if jid not in existing:
                    merged.append(jid)
                    existing.add(jid)
            context.judgement_ids = merged
            self._delegate(self.librarian, context, "librarian")

        # After all rounds, set judgement_ids to the full accumulated approved set
        context.judgement_ids = accumulated_approved

        # If Auditor rejected all and there are also no quarantined candidates,
        # fall back to legacy behaviour. If there ARE quarantined ids, we will
        # handle them via the HITL queue logic below (pending_hitl report).
        if not accumulated_approved and not (context.metadata.get("quarantined_ids") or []):
            logger.warning("[ROOT] Auditor rejected all — running fallback (no HITL candidates)")
            return self._fallback(context)

        run_id = context.metadata.get("run_id")
        quarantined_ids = context.metadata.get("quarantined_ids") or []
        audit_details = context.metadata.get("audit_details") or {}
        search_keywords = context.metadata.get("keyword_sets") or []
        search_keywords_by_route = context.metadata.get("search_keywords_by_route") or {}
        dimensions_meta = context.dimensions or context.metadata.get("dimensions") or []

        # 6a. Citations that are not validated (quarantined by Auditor) → store in hitl_queue for human review
        if quarantined_ids:
            from report_builder import build_report_from_judgements
            from db.client import (
                report_insert,
                hitl_queue_insert,
                report_citation_insert,
                pipeline_run_update,
                agent_log_insert,
            )
            report_id = str(uuid.uuid4())
            context.metadata["report_id"] = report_id
            approved_ids = list(context.judgement_ids)
            # Deduplicate by primary_citation — same judgment can arrive via multiple
            # admin-upload records that share an identical citation string.
            try:
                from db.client import judgement_get as _jget
                _seen_citations: set = set()
                _deduped: list = []
                for _jid in approved_ids:
                    _j = _jget(_jid) or {}
                    _cit = (_j.get("primary_citation") or "").strip()
                    if _cit and _cit in _seen_citations:
                        logger.info("[ROOT] Deduplicated duplicate primary_citation=%r (jid=%s)", _cit, _jid)
                        continue
                    if _cit:
                        _seen_citations.add(_cit)
                    _deduped.append(_jid)
                approved_ids = _deduped
            except Exception as _de:
                logger.warning("[ROOT] primary_citation dedup failed: %s", _de)
            # Build report from approved only
            _perspective = (context.metadata.get("perspective") or "all").lower().strip()
            report_format = build_report_from_judgements(
                approved_ids,
                context.query,
                context.user_id,
                audit_details=audit_details,
                search_keywords=search_keywords,
                search_keywords_by_route=search_keywords_by_route,
                perspective=_perspective,
                run_id=run_id,
                dimensions=dimensions_meta,
                local_judgement_hints=context.metadata.get("local_judgement_hints") or {},
            )
            report_format["pendingHITLCount"] = len(quarantined_ids)
            report_format["status"] = "pending_hitl"
            report_format["pendingMessage"] = (
                f"{len(quarantined_ids)} citation(s) could not be auto-verified and are under human review. "
                "You will see the full report once verification is complete."
            )
            # Push each quarantined citation to HITL queue
            for jid in quarantined_ids:
                one_report = build_report_from_judgements(
                    [jid],
                    context.query,
                    context.user_id,
                    audit_details=audit_details,
                    search_keywords=search_keywords,
                    search_keywords_by_route=search_keywords_by_route,
                    perspective=_perspective,
                    run_id=run_id,
                    dimensions=dimensions_meta,
                    local_judgement_hints=context.metadata.get("local_judgement_hints") or {},
                )
                citation_snapshot = (one_report.get("citations") or [{}])[0]
                if citation_snapshot:
                    # Derive metadata for HITL row
                    try:
                        cit_string = (
                            citation_snapshot.get("primaryCitation")
                            or citation_snapshot.get("caseName")
                            or citation_snapshot.get("shortTitle")
                            or ""
                        )
                        web_url = (
                            citation_snapshot.get("importSourceLink")
                            or citation_snapshot.get("sourceUrl")
                            or citation_snapshot.get("officialSourceLink")
                            or ""
                        )
                        ps = float(citation_snapshot.get("priorityScore") or 0.0)
                    except Exception:
                        cit_string = citation_snapshot.get("caseName") or ""
                        web_url = ""
                        ps = 0.0

                    hitl_id = hitl_queue_insert(
                        report_id=report_id,
                        run_id=run_id,
                        canonical_id=jid,
                        user_id=context.user_id,
                        citation_snapshot={
                            **citation_snapshot,
                            "priorityScore": ps,
                            "queryContext": (context.query or "")[:300],
                            "requestUserId": context.user_id or "anonymous",
                        },
                        reason_queued="quarantined",
                        case_id=context.case_id,
                        citation_string=cit_string[:512] if cit_string else None,
                        query_context=(context.query or "")[:2000] if context.query else None,
                        web_source_url=web_url[:2000] if web_url else None,
                        priority_score=ps,
                    )
                    report_citation_insert(
                        report_id,
                        jid,
                        "hitl_pending",
                        citation_snapshot,
                        hitl_queue_id=hitl_id,
                    )
            for jid in approved_ids:
                j_report = build_report_from_judgements(
                    [jid],
                    context.query,
                    context.user_id,
                    audit_details=audit_details,
                    search_keywords=search_keywords,
                    search_keywords_by_route=search_keywords_by_route,
                    perspective=_perspective,
                    run_id=run_id,
                    dimensions=dimensions_meta,
                    local_judgement_hints=context.metadata.get("local_judgement_hints") or {},
                )
                snap = (j_report.get("citations") or [{}])[0]
                report_citation_insert(report_id, jid, "approved", snap)
            try:
                from db.client import hitl_enqueue_citations_from_report
                hitl_enqueue_citations_from_report(
                    report_id, run_id, context.user_id, report_format,
                    context.query or "", context.case_id,
                )
            except Exception as e:
                logger.warning("[ROOT] HITL enqueue (pending_hitl report) failed: %s", e)
            report_insert(
                report_id, context.user_id, context.query, report_format,
                status="pending_hitl", case_id=context.case_id, run_id=run_id,
                hitl_pending_count=len(quarantined_ids), citations_approved_count=len(approved_ids),
                citations_quarantined_count=len(quarantined_ids),
                dimensions_metadata=dimensions_meta,
            )
            if run_id:
                pipeline_run_update(
                    run_id, "pending_hitl", report_id=report_id,
                    citations_approved_count=len(approved_ids),
                    citations_quarantined_count=len(quarantined_ids),
                    citations_sent_to_hitl_count=len(quarantined_ids),
                )
            agent_log_insert(run_id, report_id, "root", "report_builder", "INFO",
                f"Report {report_id} created with {len(quarantined_ids)} in HITL queue", {"approved": len(approved_ids)})
            logger.info("╔══ CITATION ROOT AGENT — DONE (pending HITL) ═══════════╗")
            logger.info("║  report_id   : %s  status: pending_hitl", report_id)
            logger.info("║  approved    : %d  |  in HITL: %d", len(approved_ids), len(quarantined_ids))
            logger.info("╚══════════════════════════════════════════════════════════╝")
            return AgentResult(data={
                "report_id":     report_id,
                "report_format": report_format,
                "report_status": "pending_hitl",
            })

        # 6b. All approved — full report
        rb_result = self._delegate(self.report_builder, context, "report_builder")
        if not rb_result.success:
            return AgentResult(success=False, error=f"ReportBuilder failed: {rb_result.error}")

        report_id = rb_result.data.get("report_id")
        report_format = rb_result.data.get("report_format") or {}
        if run_id:
            try:
                from db.client import hitl_enqueue_citations_from_report, report_update
                n_hitl = hitl_enqueue_citations_from_report(
                    report_id, run_id, context.user_id, report_format,
                    context.query or "", context.case_id,
                )
                if n_hitl and report_id:
                    report_update(report_id, report_format=report_format)
            except Exception as e:
                logger.warning("[ROOT] HITL enqueue from report failed: %s", e)
            try:
                from db.client import pipeline_run_update, report_citation_insert
                pipeline_run_update(
                    run_id, "completed", report_id=report_id,
                    citations_approved_count=len(context.judgement_ids),
                )
                for jid in context.judgement_ids:
                    report_citation_insert(report_id, jid, "approved", None)
            except Exception as e:
                logger.warning("[ROOT] pipeline_run_update/report_citation failed: %s", e)

        logger.info("╔══ CITATION ROOT AGENT — DONE ═══════════════════════════╗")
        logger.info("║  report_id   : %s", report_id)
        logger.info("║  citations   : %d", rb_result.data.get("citation_count", 0))
        logger.info("╚══════════════════════════════════════════════════════════╝")

        return AgentResult(data={
            "report_id":     report_id,
            "report_format": report_format,
            "report_status": "completed",
        })

    def _fallback(self, context: AgentContext) -> AgentResult:
        """Fallback when main pipeline produced zero approved citations.

        Strategy:
        - safe_ids  (non-Google source): build a real report and show directly.
        - google_ids (Google source):    queue to HITL — never shown directly.
        - If nothing at all: return a pending_hitl placeholder.
        """
        from report_builder import build_report_from_judgements
        from db.client import report_insert, hitl_queue_insert, report_citation_insert

        run_id      = context.metadata.get("run_id")
        all_jids    = list(context.judgement_ids or [])
        audit_details = context.metadata.get("audit_details") or {}
        search_keywords = context.metadata.get("keyword_sets") or []
        search_keywords_by_route = context.metadata.get("search_keywords_by_route") or {}
        dimensions_meta = context.dimensions or context.metadata.get("dimensions") or []
        _perspective = (context.metadata.get("perspective") or "all").lower().strip()
        report_id   = str(uuid.uuid4())
        context.metadata["report_id"] = report_id

        # Separate safe (local / indian_kanoon) from google-only
        safe_ids:   List[str] = []
        google_ids: List[str] = []
        try:
            from db.client import judgement_get
            for jid in all_jids:
                j = judgement_get(jid)
                src = ((j or {}).get("source") or "local").lower()
                if src == "google":
                    google_ids.append(jid)
                else:
                    safe_ids.append(jid)
        except Exception:
            safe_ids = all_jids

        if safe_ids:
            report_format = build_report_from_judgements(
                safe_ids,
                context.query,
                context.user_id,
                audit_details=audit_details,
                search_keywords=search_keywords,
                search_keywords_by_route=search_keywords_by_route,
                perspective=_perspective,
                run_id=run_id,
                dimensions=dimensions_meta,
                local_judgement_hints=context.metadata.get("local_judgement_hints") or {},
            )
        else:
            report_format = {
                "citations": [],
                "generatedAt": datetime.utcnow().strftime("%d %B %Y"),
                "status": "pending_hitl",
            }

        if google_ids:
            report_format["pendingHITLCount"] = len(google_ids)
            report_format["status"] = "pending_hitl"
            report_format["pendingMessage"] = (
                f"{len(google_ids)} web-sourced citation(s) could not be auto-verified and are under human review."
            )
            for jid in google_ids:
                try:
                    one_rep = build_report_from_judgements(
                        [jid], context.query, context.user_id,
                        audit_details=audit_details,
                        search_keywords=search_keywords,
                        search_keywords_by_route=search_keywords_by_route,
                        perspective=_perspective,
                        run_id=run_id,
                        dimensions=dimensions_meta,
                        local_judgement_hints=context.metadata.get("local_judgement_hints") or {},
                    )
                    snap = (one_rep.get("citations") or [{}])[0]
                    hitl_id = hitl_queue_insert(
                        report_id=report_id, run_id=run_id, canonical_id=jid,
                        user_id=context.user_id, citation_snapshot=snap,
                        reason_queued="google_fallback", case_id=context.case_id,
                        citation_string=(snap.get("primaryCitation") or snap.get("caseName") or "")[:512],
                        query_context=(context.query or "")[:2000],
                        web_source_url=(snap.get("importSourceLink") or snap.get("sourceUrl") or "")[:2000],
                        priority_score=float(snap.get("priorityScore") or 0.0),
                    )
                    report_citation_insert(report_id, jid, "hitl_pending", snap, hitl_queue_id=hitl_id)
                except Exception as exc:
                    logger.warning("[ROOT._fallback] HITL insert failed for %s: %s", jid, exc)
        elif not safe_ids:
            report_format["status"] = "pending_hitl"
            report_format["pendingMessage"] = (
                "We could not auto-verify any citations from local databases or external legal APIs. "
                "Potential citations have been identified and are under human review."
            )

        try:
            from db.client import hitl_enqueue_citations_from_report
            hitl_enqueue_citations_from_report(
                report_id, run_id, context.user_id, report_format,
                context.query or "", context.case_id,
            )
        except Exception as e:
            logger.warning("[ROOT._fallback] HITL enqueue from report failed: %s", e)

        status = report_format.get("status", "completed")
        report_insert(report_id, context.user_id, context.query,
                      report_format, status, case_id=context.case_id, run_id=run_id,
                      citations_approved_count=len(safe_ids),
                      citations_quarantined_count=len(google_ids),
                      dimensions_metadata=dimensions_meta)
        logger.info("[ROOT._fallback] report_id=%s safe=%d google_hitl=%d", report_id, len(safe_ids), len(google_ids))
        return AgentResult(data={"report_id": report_id, "report_format": report_format, "report_status": status})
