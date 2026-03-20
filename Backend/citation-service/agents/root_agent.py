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

# Target number of citation points for the report (CHECK 6 / CHECK 8)
TARGET_CITATION_POINTS = 10


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

# ══════════════════════════════════════════════════════════════════════════════
# WATCHDOG AGENT  — searches Local DB → Indian Kanoon → Google Serper
# ══════════════════════════════════════════════════════════════════════════════

class WatchdogAgent(BaseAgent):
    name        = "watchdog"
    description = "Searches Local DB, Indian Kanoon API and Google/Serper for relevant judgments."

    def run(self, context: AgentContext) -> AgentResult:
        from agents.watchdog import run_watchdog
        run_id = context.metadata.get("run_id")
        query = context.metadata.get("search_query") or context.query
        keyword_sets = context.metadata.get("keyword_sets")
        logger.info("[WATCHDOG] Searching: %s (keyword_sets=%d)", query[:80], len(keyword_sets) if keyword_sets else 0)
        result = run_watchdog(query, max_local=10, max_ik=8, max_google=5, keyword_sets=keyword_sets, run_id=run_id)
        if result.get("error"):
            return AgentResult(success=False, error=result["error"])
        context.judgement_ids = result.get("all_judgement_ids", [])
        context.metadata["candidates_ik"]     = result.get("candidates_ik", [])
        context.metadata["candidates_google"] = result.get("candidates_google", [])
        context.metadata["search_keywords_by_route"] = result.get("search_keywords_by_route", {})
        return AgentResult(data={
            "local_count":  len(context.judgement_ids),
            "ik_count":     len(context.metadata["candidates_ik"]),
            "google_count": len(context.metadata["candidates_google"]),
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
        def _fetch_ik():
            try:
                return fetch_ik_candidates(ik_cands, run_id=run_id)
            except Exception as e:
                errors.append(str(e)); return []

        def _fetch_go():
            try:
                return fetch_google_candidates(go_cands, run_id=run_id)
            except Exception as e:
                errors.append(str(e)); return []

        with ThreadPoolExecutor(max_workers=2) as pool:
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


# ══════════════════════════════════════════════════════════════════════════════
# CLERK AGENT  — OCR + Gemini extraction + chunk + embed + store
# ══════════════════════════════════════════════════════════════════════════════

class ClerkAgent(BaseAgent):
    name        = "clerk"
    description = "OCRs judgment text, uses Gemini to extract all structured fields, chunks and stores."

    def run(self, context: AgentContext) -> AgentResult:
        from agents.clerk import clerk_ingest_ik, clerk_ingest_google
        run_id     = context.metadata.get("run_id")
        query      = context.metadata.get("search_query") or context.query
        fetched_ik = context.metadata.get("fetched_ik", [])
        fetched_go = context.metadata.get("fetched_go", [])
        new_ids, errors = [], []

        try:
            from db.client import agent_log_insert
            agent_log_insert(run_id, None, "clerk", "clerk", "INFO",
                f"📋 Clerk started — extracting & storing {len(fetched_ik)} IK + {len(fetched_go)} Google judgments via Gemini",
                {"ik_count": len(fetched_ik), "google_count": len(fetched_go)})
        except Exception:
            pass

        case_id = context.case_id
        # Run IK + Google ingestion in parallel (pass case_id for Qdrant payload)
        def _ingest_ik():
            try:
                return clerk_ingest_ik(fetched_ik, query=query, case_id=case_id)
            except Exception as e:
                errors.append(f"IK: {e}"); return []

        def _ingest_go():
            try:
                return clerk_ingest_google(fetched_go, query=query, case_id=case_id)
            except Exception as e:
                errors.append(f"GO: {e}"); return []

        with ThreadPoolExecutor(max_workers=2) as pool:
            f_ik = pool.submit(_ingest_ik)
            f_go = pool.submit(_ingest_go)
            ik_ids = f_ik.result()
            go_ids = f_go.result()

        new_ids = ik_ids + go_ids
        for jid in new_ids:
            if jid not in context.judgement_ids:
                context.judgement_ids.append(jid)

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

        result = run_librarian(context.judgement_ids)
        context.metadata["librarian_result"]   = result
        context.metadata["validated_ids"]       = result["validated_ids"]
        context.metadata["flagged_ids"]         = result["flagged_ids"]
        context.metadata["rejected_ids"]        = result["rejected_ids"]

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

        result = run_auditor(validated, flagged, verify_online=True)
        context.metadata["audit_details"]  = result.get("audit_details", {})
        context.metadata["approved_ids"]   = result.get("approved_ids", [])
        context.judgement_ids              = result.get("approved_ids", [])
        approved_count    = len(result.get("approved_ids", []))
        quarantined_count = len(result.get("quarantined_ids", []))

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
        )
        report_id = str(uuid.uuid4())
        run_id = context.metadata.get("run_id")
        report_insert(
            report_id, context.user_id, context.query,
            report_format, "completed", case_id=context.case_id, run_id=run_id,
            citations_approved_count=len(context.judgement_ids),
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
# KEYWORD EXTRACTOR AGENT  — extracts legal keywords from case context via Gemini
# ══════════════════════════════════════════════════════════════════════════════

class KeywordExtractorAgent(BaseAgent):
    name        = "keyword_extractor"
    description = "Uses Gemini to extract legal search keywords (3-layer, N sets) from case file context."

    def run(self, context: AgentContext) -> AgentResult:
        run_id = context.metadata.get("run_id")
        case_context = context.metadata.get("case_file_context", [])
        base_query = (context.query or "").strip()

        try:
            from db.client import agent_log_insert
            if case_context:
                agent_log_insert(run_id, None, "keyword_extractor", "keyword_extractor", "INFO",
                    f"🔑 Keyword Extractor — analysing {len(case_context)} case file(s) with Claude to generate keyword sets…",
                    {"file_count": len(case_context)})
            else:
                agent_log_insert(run_id, None, "keyword_extractor", "keyword_extractor", "INFO",
                    f"🔑 Keyword Extractor — using query directly (no case file context): {base_query[:80]!r}",
                    {"query": base_query})
        except Exception:
            pass

        # Fallback: single query when no case context (CHECK 3)
        if not case_context:
            context.metadata["search_query"] = base_query
            context.metadata["keyword_sets"] = [base_query] if base_query else []
            return AgentResult(data={
                "search_query": base_query, "augmented": False, "keyword_sets_count": len(context.metadata["keyword_sets"]),
                "chunks_used_for_keywords": [], "embeddings_used": [], "message": "No case file context; using query only.",
            })

        parts = []
        chunks_used_for_keywords = []
        embeddings_used = []
        # Use full case context: larger snippet per file so LLM sees full context for keyword generation
        for idx, f in enumerate(case_context[:20]):
            name = f.get("name") or f.get("filename") or "document"
            snippet = (f.get("snippet") or f.get("content") or "")[:8000]
            if snippet:
                parts.append(f"[{name}]\n{snippet}")
                chunk_info = {
                    "file_name": name,
                    "chunk_index": idx,
                    "snippet_length": len(snippet),
                    "snippet_preview": snippet[:150] + ("…" if len(snippet) > 150 else ""),
                }
                if f.get("chunk_id") is not None:
                    chunk_info["chunk_id"] = f.get("chunk_id")
                if f.get("embedding_id") is not None:
                    chunk_info["embedding_id"] = f.get("embedding_id")
                    embeddings_used.append(str(f.get("embedding_id")))
                chunks_used_for_keywords.append(chunk_info)
        context.metadata["keyword_extraction_chunks_used"] = chunks_used_for_keywords
        context.metadata["keyword_extraction_embeddings_used"] = embeddings_used

        if not parts:
            context.metadata["search_query"] = base_query
            context.metadata["keyword_sets"] = [base_query] if base_query else []
            return AgentResult(data={
                "search_query": base_query, "augmented": False, "keyword_sets_count": len(context.metadata["keyword_sets"]),
                "chunks_used_for_keywords": [], "embeddings_used": [], "message": "No snippet/content in case context.",
            })

        # Log which file chunks and embeddings are used for keywords and facts
        chunk_summary = ", ".join(
            f"{c['file_name']} (chunk {c['chunk_index']}, {c['snippet_length']} chars)"
            for c in chunks_used_for_keywords[:10]
        )
        if len(chunks_used_for_keywords) > 10:
            chunk_summary += f" … and {len(chunks_used_for_keywords) - 10} more"
        logger.info(
            "[KEYWORD_EXTRACTOR] Keywords and facts use file chunks: %s",
            chunk_summary or "none",
        )
        if embeddings_used:
            logger.info("[KEYWORD_EXTRACTOR] Embeddings used for keyword context: %s", embeddings_used[:20] if len(embeddings_used) > 20 else embeddings_used)

        # CHECK 3: Generate N keyword sets from full case context so search fetches correct relevant judgments
        # Resolve prompt from DB → fallback to default
        _default_kw_prompt = (
            "You are a senior Indian legal research assistant using a multi-search engine (Local DB, Indian Kanoon API, Google).\n"
            "Consider ALL of the attached case context below (documents, facts, issues) together with the user's query.\n\n"
            "Task: Generate EXACTLY {target} high-quality search query strings to retrieve the most relevant Indian judgments.\n"
            "Each query must combine three layers:\n"
            "  Layer 1: Legal section/statute (e.g. 'Section 302 IPC', 'Section 439 CrPC', 'Article 21 Constitution').\n"
            "  Layer 2: Doctrine/fact pattern (e.g. 'last seen theory', 'anticipatory bail NDPS', 'dowry death presumption').\n"
            "  Layer 3: Court + time hint (e.g. 'Supreme Court 2019', 'Punjab and Haryana High Court 2024').\n\n"
            "STRICT FORMAT RULES (for Indian Kanoon-compatible keywords):\n"
            "- Do NOT include logical operators like ANDD/ORR/NOTT explicitly; just write natural phrases.\n"
            "- Do NOT include question marks, quotes, bullets, numbering, or extra punctuation.\n"
            "- Prefer patterns like: 'Section 438 CrPC anticipatory bail Supreme Court 2023'.\n"
            "- Avoid very long sentences; keep each query under 140 characters.\n\n"
            "User query:\n{base_query}\n\n"
            "Case context (multiple documents, use ALL of this to design the queries):\n\n{case_context}\n\n"
            "Output format:\n"
            "- EXACTLY {target} lines.\n"
            "- Each line is ONE complete search query string ready to send to Indian Kanoon / local DB.\n"
            "- No numbering, no bullets, no explanations. One query per line."
        )
        
        pc = None
        try:
            from utils.prompt_resolver import resolve_prompt
            pc = resolve_prompt(
                name="KeywordExtractor",
                agent_type="citation",
                default_prompt=_default_kw_prompt,
                default_model=os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-20250514"),
                default_temperature=0.2,
                default_max_tokens=800,
            )
            case_context_str = "\n\n".join(parts[:15])
            prompt = pc.prompt.format(
                target=TARGET_CITATION_POINTS,
                base_query=base_query,
                case_context=case_context_str,
            )
            kw_model = pc.model_name
            kw_temp = pc.temperature
            kw_max_tokens = pc.max_tokens
            logger.info("[KEYWORD_EXTRACTOR] Prompt source=%s model=%s temp=%.2f", pc.source, kw_model, kw_temp)
        except Exception as exc:
            logger.warning("[KEYWORD_EXTRACTOR] Prompt resolver failed (%s), using default", exc)
            prompt = _default_kw_prompt.format(
                target=TARGET_CITATION_POINTS,
                base_query=base_query,
                case_context="\n\n".join(parts[:15]),
            )
            kw_model = None
            kw_temp = 0.2
            kw_max_tokens = 800

        # Use Claude Sonnet for richer keyword generation
        claude_kw = pc.claude_config if pc else {}
        keywords_text = self._claude(prompt, **claude_kw)
        keyword_sets = []
        if keywords_text and keywords_text.strip():
            for line in keywords_text.strip().split("\n"):
                q = line.strip()
                if q and len(keyword_sets) < TARGET_CITATION_POINTS:
                    keyword_sets.append(q[:400])
        if not keyword_sets:
            # Fallback: single augmented query via Claude
            _default_fallback = (
                "You are a legal research assistant. Given the user's query and case file excerpts, "
                "produce 5–10 short Indian legal search keywords/phrases (comma-separated). "
                "Focus on statutes, doctrines, and fact patterns. No explanation.\n\n"
                "User query: {base_query}\n\n"
                "Case context:\n{case_context}\n\nKeywords:"
            )
            pc_fb = None
            try:
                from utils.prompt_resolver import resolve_prompt
                pc_fb = resolve_prompt(
                    name="KeywordExtractorFallback",
                    agent_type="citation",
                    default_prompt=_default_fallback,
                    default_model=os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-20250514"),
                    default_temperature=0.2,
                    default_max_tokens=200,
                )
                prompt_flat = pc_fb.prompt.format(base_query=base_query, case_context="\n\n".join(parts))
            except Exception:
                prompt_flat = _default_fallback.format(base_query=base_query, case_context="\n\n".join(parts))
            
            fb_kw = pc_fb.claude_config if pc_fb else {}
            flat = self._claude(prompt_flat, **fb_kw)
            single = f"{base_query} {flat.strip()}"[:500] if flat and flat.strip() else base_query
            keyword_sets = [single]
            
        context.metadata["keyword_sets"] = keyword_sets
        context.metadata["search_query"] = keyword_sets[0] if keyword_sets else base_query
        logger.info("[KEYWORD_EXTRACTOR] %d keyword set(s), first: %s", len(keyword_sets), (keyword_sets[0][:80] if keyword_sets else ""))
        try:
            from db.client import agent_log_insert
            kw_preview = " | ".join(k[:60] for k in keyword_sets[:4]) + ("…" if len(keyword_sets) > 4 else "")
            agent_log_insert(run_id, None, "keyword_extractor", "keyword_extractor", "INFO",
                f"✅ Generated {len(keyword_sets)} keyword set(s): {kw_preview}",
                {"keyword_sets_count": len(keyword_sets), "keywords": keyword_sets[:10]})
        except Exception:
            pass
        return AgentResult(data={
            "search_query": context.metadata["search_query"],
            "augmented": True,
            "keyword_sets_count": len(keyword_sets),
            "chunks_used_for_keywords": chunks_used_for_keywords,
            "embeddings_used": embeddings_used,
            "message": f"Keywords/facts derived from {len(chunks_used_for_keywords)} file chunk(s)" + (f", {len(embeddings_used)} embedding(s)" if embeddings_used else ""),
        })


# ══════════════════════════════════════════════════════════════════════════════
# ROOT ORCHESTRATOR AGENT
# ══════════════════════════════════════════════════════════════════════════════

class CitationRootAgent(BaseAgent):
    """
    Root orchestrator agent (ADK-compatible).
    Delegates to sub-agents in sequence:
      KeywordExtractor → Watchdog → Fetcher → Clerk → Librarian → Auditor → ReportBuilder

    Fetcher + Clerk run in parallel when possible.
    """
    name        = "citation_root_agent"
    description = "Root orchestrator for the JuriNex citation verification pipeline."

    def __init__(self):
        super().__init__()
        self.keyword_extractor = KeywordExtractorAgent()
        self.watchdog          = WatchdogAgent()
        self.fetcher           = FetcherAgent()
        self.clerk             = ClerkAgent()
        self.librarian         = LibrarianAgent()
        self.auditor           = AuditorAgent()
        self.report_builder    = ReportBuilderAgent()

        # Sub-agents list (ADK convention)
        self.sub_agents = [
            self.keyword_extractor,
            self.watchdog,
            self.fetcher,
            self.clerk,
            self.librarian,
            self.auditor,
            self.report_builder,
        ]

    def _log_agent_prompt_info(self, agent_name: str, duration: float, run_id: str, report_id: str) -> None:
        """Helper to centralize rich console prompt logging for all agents."""
        try:
            from utils.rich_logger import pipeline_console
        except ImportError:
            return

        # LLM agent mapping: (agent name → prompt resolver name, default_model)
        llm_map = {
            "keyword_extractor": ("KeywordExtractor", os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-20250514")),
            "clerk":             ("Clerk",             os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")),
            "report_builder":    ("ReportBuilder",     os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")),
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
                if agent_name == "keyword_extractor":   disp_name = "KeywordExtractor"
                elif agent_name == "clerk":             disp_name = "Clerk"
                elif agent_name == "report_builder":    disp_name = "ReportBuilder"
                else:                                   disp_name = agent_name.capitalize()
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
                "watchdog": "Watchdog",
                "fetcher": "Fetcher",
                "librarian": "Librarian",
                "auditor": "Auditor",
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
            if result.success and result.data and agent.name == "keyword_extractor":
                chunks = result.data.get("chunks_used_for_keywords") or []
                emb = result.data.get("embeddings_used") or []
                msg = f"{msg} | Keywords/facts from {len(chunks)} file chunk(s)"
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

        # 1. Keyword extraction (augments query using case context)
        self._delegate(self.keyword_extractor, context, "keyword_extractor")

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

        # 3. Fetcher + Clerk in parallel (fetch external docs & ingest them)
        #    Only run if there are external candidates
        ik_cands = context.metadata.get("candidates_ik", [])
        go_cands = context.metadata.get("candidates_google", [])

        if ik_cands or go_cands:
            # Fetcher first, then Clerk (Clerk needs fetched docs)
            self._delegate(self.fetcher, context, "fetcher")
            self._delegate(self.clerk,   context, "clerk")
        else:
            logger.info("[ROOT] No external candidates — skipping Fetcher/Clerk")

        if not context.judgement_ids:
            logger.warning("[ROOT] No judgements found — running fallback via citation_agent")
            return self._fallback(context)

        # 4. Librarian — validate & enrich
        self._delegate(self.librarian, context, "librarian")

        # 5. Auditor — gate final list (CHECK 8: retry if < TARGET points)
        max_retries = 2
        accumulated_approved: List[str] = []
        for audit_round in range(max_retries + 1):
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
            if audit_round >= max_retries:
                logger.warning("[ROOT] After %d rounds still have %d approved (target %d)", audit_round + 1, approved_count, TARGET_CITATION_POINTS)
                break
            # Retry: fetch more candidates for missing slots
            logger.info("[ROOT] Retry %d: approved=%d < %d — re-running Watchdog/Fetcher/Clerk for more candidates", audit_round + 1, approved_count, TARGET_CITATION_POINTS)
            self._delegate(self.watchdog, context, "watchdog")
            ik_cands = context.metadata.get("candidates_ik", [])
            go_cands = context.metadata.get("candidates_google", [])
            if ik_cands or go_cands:
                self._delegate(self.fetcher, context, "fetcher")
                self._delegate(self.clerk, context, "clerk")
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
                )
                snap = (j_report.get("citations") or [{}])[0]
                report_citation_insert(report_id, jid, "approved", snap)
            report_insert(
                report_id, context.user_id, context.query, report_format,
                status="pending_hitl", case_id=context.case_id, run_id=run_id,
                hitl_pending_count=len(quarantined_ids), citations_approved_count=len(approved_ids),
                citations_quarantined_count=len(quarantined_ids),
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
                    )
                    snap = (one_rep.get("citations") or [{}])[0]
                    hitl_queue_insert(
                        report_id=report_id, run_id=run_id, canonical_id=jid,
                        user_id=context.user_id, citation_snapshot=snap,
                        reason_queued="google_fallback", case_id=context.case_id,
                        citation_string=(snap.get("primaryCitation") or snap.get("caseName") or "")[:512],
                        query_context=(context.query or "")[:2000],
                        web_source_url=(snap.get("importSourceLink") or snap.get("sourceUrl") or "")[:2000],
                        priority_score=float(snap.get("priorityScore") or 0.0),
                    )
                    report_citation_insert(report_id, jid, "hitl_pending", snap)
                except Exception as exc:
                    logger.warning("[ROOT._fallback] HITL insert failed for %s: %s", jid, exc)
        elif not safe_ids:
            report_format["status"] = "pending_hitl"
            report_format["pendingMessage"] = (
                "We could not auto-verify any citations from local databases or external legal APIs. "
                "Potential citations have been identified and are under human review."
            )

        status = report_format.get("status", "completed")
        report_insert(report_id, context.user_id, context.query,
                      report_format, status, case_id=context.case_id, run_id=run_id,
                      citations_approved_count=len(safe_ids),
                      citations_quarantined_count=len(google_ids))
        logger.info("[ROOT._fallback] report_id=%s safe=%d google_hitl=%d", report_id, len(safe_ids), len(google_ids))
        return AgentResult(data={"report_id": report_id, "report_format": report_format, "report_status": status})
