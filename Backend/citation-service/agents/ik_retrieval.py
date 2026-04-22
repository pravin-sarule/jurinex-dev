"""
agents/ik_retrieval.py

Wide-net IK retrieval using 4 strategies in parallel.
Goal: 50-100 raw candidates with text fetched.
IK's job is RECALL, not precision. Precision happens in downstream ranking.

The 4 strategies:
  A. Outcome-targeted queries (not section queries)
  B. Landmark seed direct fetch by tid
  C. Citation graph traversal (cases that CITE landmark cases, via citedbyList)
  D. Statute combination queries

Synchronous implementation using ThreadPoolExecutor to match existing
pipeline patterns (watchdog.py, fetcher.py, clerk.py).
"""

from __future__ import annotations

import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Optional

from agents.landmark_seeds import get_seeds_for_case, infer_dispute_type_from_query

logger = logging.getLogger(__name__)

IK_MAX_PER_QUERY = int(os.getenv("IK_WIDE_NET_PER_QUERY", "20"))
IK_MAX_TOTAL = int(os.getenv("IK_WIDE_NET_TOTAL", "100"))
IK_FETCH_WORKERS = int(os.getenv("IK_FETCH_CONCURRENCY", "8"))


def build_outcome_queries(controversy_map: dict) -> list[str]:
    """
    Build outcome-targeted IK queries.
    These search for WHAT THE COURT DID, not what sections are involved.

    CRITICAL INSIGHT: Searching "FIR quashed civil dispute" returns cases
    where the court actually quashed the FIR — exactly what the lawyer needs.
    Searching "IPC 420 elements" returns textbook cases on cheating elements.
    """
    dt = controversy_map.get("dispute_type", "")
    statutes = controversy_map.get("applicable_statutes", []) or []
    jurisdiction = controversy_map.get("jurisdiction", "") or ""
    relief = controversy_map.get("relief_sought", "") or ""

    queries: list[str] = []

    # Strategy A: Outcome queries — what the court DID
    if "fir_quashing" in dt or "482" in str(statutes) or "quash" in relief.lower():
        queries += [
            "FIR quashed civil dispute section 482 CrPC allowed",
            "quashing FIR commercial transaction abuse process criminal",
            "section 482 CrPC FIR quash civil commercial dispute Supreme Court",
        ]

    if "420" in str(statutes) or "cheating" in dt:
        queries += [
            "IPC 420 cheating acquitted civil transaction mens rea absent",
            "cheating charge quashed civil dispute no criminal intent",
            "FIR quashed IPC 420 civil dispute commercial transaction",
        ]

    if "138" in str(statutes) or "ni_act" in dt or "NI Act" in str(statutes):
        queries += [
            "NI Act 138 cheque dishonour IPC 420 quash FIR civil",
            "cheque dishonour criminal case quashed civil remedy NI Act",
        ]

    if "467" in str(statutes) or "468" in str(statutes) or "forgery" in dt:
        queries += [
            "IPC 467 468 forgery quashed civil document commercial",
            "forgery charge quashed civil transaction document dispute",
        ]

    # Strategy D: Statute combination queries
    sections = [s for s in statutes if re.search(r"\d", str(s))]
    if len(sections) >= 2:
        combo = " ".join(str(s) for s in sections[:4])
        queries.append(f"quash FIR {combo} civil dispute allowed")

    # Strategy E: Court + relief targeted
    if "Bombay" in jurisdiction or "Maharashtra" in jurisdiction:
        queries += [
            "Bombay High Court section 482 CrPC quash FIR civil commercial",
            "Bombay High Court FIR quashed cheating civil transaction",
        ]

    # Deduplicate while preserving order
    seen: set[str] = set()
    unique: list[str] = []
    for q in queries:
        if q not in seen:
            seen.add(q)
            unique.append(q)

    logger.info("[IK_RETRIEVAL] Built %d outcome queries", len(unique))
    return unique[:10]  # cap at 10 queries


class IKWideNetRetrieval:
    """
    Executes all retrieval strategies in parallel and returns
    deduplicated candidates with full text fetched.

    Uses the existing services.indian_kanoon module for all IK API calls —
    the same module used by WatchdogAgent and FetcherAgent — so no new
    HTTP clients are created.
    """

    def retrieve(
        self,
        controversy_map: dict,
        query: str = "",
        statutes: list[str] | None = None,
        run_id: str | None = None,
        user_id: str | None = None,
    ) -> list[dict]:
        """
        Run all strategies in parallel, return deduplicated candidates with text.
        """
        statutes = statutes or controversy_map.get("applicable_statutes") or []
        dispute_type = (
            controversy_map.get("dispute_type")
            or infer_dispute_type_from_query(query, statutes)
        )

        logger.info(
            "[IK_RETRIEVAL] Starting wide-net retrieval | dispute_type=%s",
            dispute_type,
        )

        # Run strategies in parallel using ThreadPoolExecutor
        strategy_results: dict[str, list[dict]] = {}
        strategies = {
            "outcome_queries": lambda: self._strategy_a_outcome_queries(
                controversy_map
            ),
            "landmark_seeds": lambda: self._strategy_b_landmark_seeds(
                dispute_type, statutes, query
            ),
            "citation_graph": lambda: self._strategy_c_citation_graph(
                dispute_type
            ),
            "statute_combos": lambda: self._strategy_d_statute_combos(
                statutes, dispute_type
            ),
        }

        with ThreadPoolExecutor(max_workers=4) as pool:
            futs = {pool.submit(fn): name for name, fn in strategies.items()}
            for fut in as_completed(futs):
                name = futs[fut]
                try:
                    strategy_results[name] = fut.result(timeout=60) or []
                except Exception as exc:
                    logger.error(
                        "[IK_RETRIEVAL] Strategy %s failed: %s", name, exc
                    )
                    strategy_results[name] = []

        # Merge all candidates, deduplicate by tid
        all_candidates: list[dict] = []
        seen_tids: set[str] = set()

        for name, results in strategy_results.items():
            for candidate in results:
                tid = str(
                    candidate.get("external_id")
                    or candidate.get("tid")
                    or ""
                ).strip()
                if tid and tid not in seen_tids:
                    seen_tids.add(tid)
                    all_candidates.append(candidate)

        logger.info(
            "[IK_RETRIEVAL] All strategies complete: %d unique candidates",
            len(all_candidates),
        )

        # Fetch full text for candidates that don't have it yet
        # (landmark seeds already have text from direct doc fetch)
        candidates_with_text = self._fetch_texts_parallel(
            all_candidates[:IK_MAX_TOTAL]
        )

        logger.info(
            "[IK_RETRIEVAL] Text fetched for %d candidates",
            len(candidates_with_text),
        )
        return candidates_with_text

    def _strategy_a_outcome_queries(self, controversy_map: dict) -> list[dict]:
        """Strategy A: Outcome-targeted IK search queries."""
        queries = build_outcome_queries(controversy_map)
        all_results: list[dict] = []
        seen: set[str] = set()

        def _run_one(q: str) -> list[dict]:
            try:
                results = self._ik_search(q, max_results=IK_MAX_PER_QUERY)
                logger.info(
                    "[IK_RETRIEVAL-A] Query '%s' → %d results", q[:50], len(results)
                )
                return results
            except Exception as exc:
                logger.warning(
                    "[IK_RETRIEVAL-A] Query failed '%s': %s", q[:50], exc
                )
                return []

        with ThreadPoolExecutor(max_workers=min(6, len(queries) or 1)) as pool:
            futs = {pool.submit(_run_one, q): q for q in queries}
            for fut in as_completed(futs):
                try:
                    for item in fut.result(timeout=20):
                        tid = str(
                            item.get("external_id") or item.get("tid") or ""
                        ).strip()
                        if tid and tid not in seen:
                            seen.add(tid)
                            all_results.append(item)
                except Exception as exc:
                    logger.warning("[IK_RETRIEVAL-A] Worker failed: %s", exc)

        return all_results

    def _strategy_b_landmark_seeds(
        self,
        dispute_type: str,
        statutes: list[str],
        query: str,
    ) -> list[dict]:
        """Strategy B: Fetch landmark seeds directly by tid."""
        seeds = get_seeds_for_case(dispute_type, statutes, query)
        results: list[dict] = []

        def _fetch_seed(seed: dict) -> dict | None:
            try:
                doc = self._ik_fetch_doc(seed["tid"])
                if doc:
                    doc["is_seed"] = True
                    doc["seed_why_relevant"] = seed["why_relevant"]
                    doc["citation_hint"] = seed["citation"]
                    logger.info(
                        "[IK_RETRIEVAL-B] Seed fetched: %s", seed["title"][:60]
                    )
                    return doc
                return None
            except Exception as exc:
                logger.warning(
                    "[IK_RETRIEVAL-B] Seed fetch failed tid=%s: %s",
                    seed["tid"], exc,
                )
                return None

        with ThreadPoolExecutor(max_workers=min(IK_FETCH_WORKERS, len(seeds) or 1)) as pool:
            futs = [pool.submit(_fetch_seed, s) for s in seeds]
            for fut in as_completed(futs):
                try:
                    doc = fut.result(timeout=30)
                    if doc:
                        results.append(doc)
                except Exception as exc:
                    logger.warning("[IK_RETRIEVAL-B] Worker failed: %s", exc)

        logger.info(
            "[IK_RETRIEVAL-B] %d/%d seeds fetched", len(results), len(seeds)
        )
        return results

    def _strategy_c_citation_graph(self, dispute_type: str) -> list[dict]:
        """
        Strategy C: Find cases that CITE the landmark cases.
        Uses the citedbyList field from IK /doc/ endpoint (already available
        through ik_fetch_doc).  Cases that cite R. Kalyani are already
        topically filtered — they are almost certainly FIR quashing cases.
        """
        # Landmark tids to find citing documents for
        LANDMARK_TIDS: dict[str, list[str]] = {
            "fir_quashing":           ["257876", "81340"],
            "civil_criminal_overlap": ["257876", "1233"],
            "cheating_forgery":       ["81340", "1198480"],
            "fir_quashing_ni_act":    ["1382608", "257876"],
        }

        tids = LANDMARK_TIDS.get(dispute_type, [])
        if not tids:
            return []

        results: list[dict] = []
        seen: set[str] = set()

        for tid in tids:
            try:
                doc = self._ik_fetch_doc(tid)
                if not doc:
                    continue
                # Extract citedbyList from the fetched document
                cited_by = doc.get("cited_by_list") or []
                for entry in cited_by[:15]:
                    # citedbyList entries: {tid, title, docsource}
                    entry_tid = str(
                        entry.get("tid") or entry.get("id") or ""
                    ).strip()
                    if not entry_tid or entry_tid in seen:
                        continue
                    seen.add(entry_tid)
                    results.append({
                        "external_id": entry_tid,
                        "title": entry.get("title", ""),
                        "docsource": entry.get("docsource", ""),
                        "_source": "indian_kanoon",
                        "_citation_graph_source": tid,
                    })
                logger.info(
                    "[IK_RETRIEVAL-C] tid=%s cited by %d docs (added %d)",
                    tid, len(cited_by), len(seen),
                )
            except Exception as exc:
                logger.warning(
                    "[IK_RETRIEVAL-C] Citation graph failed for tid=%s: %s",
                    tid, exc,
                )

        return results

    def _strategy_d_statute_combos(
        self,
        statutes: list[str],
        dispute_type: str,
    ) -> list[dict]:
        """Strategy D: Search by specific statute combinations + quash outcome."""
        if not statutes:
            return []

        sections = [
            s for s in statutes if re.search(r"\d", str(s))
        ][:4]
        if not sections:
            return []

        section_str = " ".join(str(s) for s in sections)
        queries = [
            f"quash {section_str} civil dispute High Court",
            f"{section_str} FIR quashed Supreme Court",
        ]

        results: list[dict] = []
        seen: set[str] = set()

        for q in queries:
            try:
                hits = self._ik_search(q, max_results=10)
                for h in hits:
                    tid = str(
                        h.get("external_id") or h.get("tid") or ""
                    ).strip()
                    if tid and tid not in seen:
                        seen.add(tid)
                        results.append(h)
                logger.info(
                    "[IK_RETRIEVAL-D] Statute combo '%s' → %d hits",
                    q[:50], len(hits),
                )
            except Exception as exc:
                logger.warning(
                    "[IK_RETRIEVAL-D] Failed '%s': %s", q[:50], exc
                )

        return results

    def _fetch_texts_parallel(self, candidates: list[dict]) -> list[dict]:
        """Fetch full text for candidates that don't already have it."""
        def _has_text(c: dict) -> bool:
            return any(
                c.get(f) and len(str(c.get(f, ""))) > 200
                for f in ["raw_content", "text", "full_text", "content", "doc_html"]
            )

        needs_fetch = [c for c in candidates if not _has_text(c)]
        already_fetched = [c for c in candidates if _has_text(c)]

        def _fetch_one(candidate: dict) -> dict:
            tid = str(
                candidate.get("external_id") or candidate.get("tid") or ""
            ).strip()
            if not tid:
                return candidate
            try:
                doc = self._ik_fetch_doc(tid)
                if doc:
                    candidate = {**candidate, **doc}
            except Exception as exc:
                logger.debug("[IK_RETRIEVAL] Text fetch failed for tid=%s: %s", tid, exc)
            return candidate

        fetched_new: list[dict] = []
        if needs_fetch:
            with ThreadPoolExecutor(
                max_workers=min(IK_FETCH_WORKERS, len(needs_fetch))
            ) as pool:
                futs = [pool.submit(_fetch_one, c) for c in needs_fetch]
                for fut in as_completed(futs):
                    try:
                        result = fut.result(timeout=30)
                        if _has_text(result):
                            fetched_new.append(result)
                    except Exception as exc:
                        logger.debug("[IK_RETRIEVAL] Fetch worker failed: %s", exc)

        return already_fetched + fetched_new

    def _ik_search(self, query: str, max_results: int = 20) -> list[dict]:
        """
        Call IK search API using services.indian_kanoon.ik_search —
        the same function used by LegalDimensionExtractor._search_ik_for_dimensions()
        and watchdog._search_indian_kanoon().
        """
        from services.indian_kanoon import ik_search

        resp = ik_search(query, pagenum=0)
        docs = (resp or {}).get("docs") or []
        return [
            {
                "external_id": str(d.get("tid", "")),
                "title": d.get("title", ""),
                "snippet": d.get("headline", ""),
                "docsource": d.get("docsource", ""),
                "_source": "indian_kanoon",
                "_query": query,
            }
            for d in docs[:max_results]
            if d.get("tid")
        ]

    def _ik_fetch_doc(self, tid: str) -> dict | None:
        """
        Fetch full judgment text by tid using services.indian_kanoon.ik_fetch_doc —
        the same function used by fetcher._fetch_one_ik_sync() bare fallback.
        """
        from services.indian_kanoon import ik_fetch_doc

        data = ik_fetch_doc(tid, maxcites=5, maxcitedby=10)
        if not data:
            return None

        doc_html = data.get("doc") or ""
        # Strip HTML for plain text (same as fetcher._strip_html)
        raw_content = re.sub(r"<[^>]+>", " ", doc_html)
        raw_content = re.sub(r"\s+", " ", raw_content).strip()

        if len(raw_content) < 500:
            return None

        return {
            "external_id": str(tid),
            "title": data.get("title", ""),
            "docsource": data.get("docsource", ""),
            "doc_html": doc_html,
            "raw_content": raw_content[:500_000],
            "text": raw_content[:500_000],
            "source": "indian_kanoon",
            "_source": "indian_kanoon",
            "cite_list": data.get("citeList") or [],
            "cited_by_list": data.get("citedbyList") or [],
        }
