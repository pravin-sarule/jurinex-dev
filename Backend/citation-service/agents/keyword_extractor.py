# """
# KeywordExtractorAgent: Generates structured legal search tokens from case documents.

# Uses a 4-tier token-extraction prompt (TOKENS not sentences) to produce:
#   Tier 1  — hyper-specific (statute + doctrine + fact, 3-6 words)
#   Tier 2  — specific (statute + doctrine, 3-6 words)
#   Tier 3  — doctrinal (doctrine name only, 2-4 words)
#   Tier 4  — landmark case name searches

# All IK queries are fetched in PARALLEL via ThreadPoolExecutor immediately
# after extraction. Each tier runs as independent tasks in the same pool.

# Context outputs:
#   context.metadata["keyword_sets"]     — flat ordered list of all search tokens
#   context.metadata["search_query"]     — primary seed (first tier_1 query)
#   context.metadata["keyword_data"]     — full parsed JSON from Claude
#   context.metadata["landmark_cases"]   — tier_4 case names
#   context.metadata["statutes"]         — tokens.statutory list
#   context.metadata["legal_issues"]     — tokens.doctrinal + tokens.factual
#   context.metadata["dimensions"]       — backward-compat dimension wrappers
#   context.metadata["candidates_ik"]    — IK results pre-fetched in parallel
#   context.metadata["ik_prefetched"]    — True so Watchdog skips duplicate IK search
# """

# from __future__ import annotations

# import json
# import logging
# import os
# import re
# from concurrent.futures import ThreadPoolExecutor, as_completed
# from typing import Any, Dict, List, Optional, Tuple

# from agents.base_agent import BaseAgent, AgentContext, AgentResult

# logger = logging.getLogger(__name__)

# # ── Configuration ──────────────────────────────────────────────────────────────
# _MAX_IK_PER_TIER   = int(os.environ.get("KEYWORD_EXTRACTOR_MAX_IK_PER_TIER", "3"))
# _MAX_LANDMARK_SEEDS = int(os.environ.get("KEYWORD_EXTRACTOR_MAX_LANDMARKS", "2"))
# _PER_QUERY_LIMIT   = int(os.environ.get("KEYWORD_EXTRACTOR_PER_QUERY_LIMIT", "5"))
# _IK_WORKERS        = max(4, min(12, int(os.environ.get("CITATION_WATCHDOG_WORKERS", "8"))))
# _MAX_IK_TOTAL      = int(os.environ.get("KEYWORD_EXTRACTOR_MAX_IK_TOTAL", "10"))


# # ── Prompt ─────────────────────────────────────────────────────────────────────
# _KEYWORD_EXTRACTION_PROMPT = """\
# You are a legal keyword extraction agent for Indian case law research.
# Read the Indian legal document below and produce BOOLEAN SEARCH QUERIES
# for Indian Kanoon using exact phrase matching and Boolean operators.

# ═══════════════════════════════════════════════════════
# CRITICAL RULES
# ═══════════════════════════════════════════════════════

# 1. Output BOOLEAN QUERIES, not plain keyword strings or sentences.
#    ❌ "Whether the High Court correctly upheld the sanction order..."
#    ❌ "section 197 CrPC sanction public servant"
#    ✅ "section 197 CrPC" AND "sanction" AND "public servant"

# 2. ALWAYS wrap multi-word legal phrases in double quotes.
#    ✅ "section 138 NI Act"   ✅ "dishonoured cheque"   ✅ "mens rea"

# 3. Connect query components with AND (required) or OR (alternatives):
#    AND — both terms must appear in the judgment
#    OR  — either term is acceptable (use for synonyms)

# 4. NEVER include filler words: "whether", "did", "the", "correctly",
#    "properly", "application", "issue of", "question of", "in this case",
#    "applicant", "respondent".

# 5. ALWAYS include at least one of:
#    - Section number + act  (e.g., "section 482 CrPC")
#    - Legal doctrine name   (e.g., "abuse of process")
#    - Landmark case name    (e.g., "Bhajan Lal")

# 6. Use Indian Kanoon vocabulary — exact phrases used in court headnotes
#    and ratio decidendi. Prioritise Supreme Court and High Court language.

# ═══════════════════════════════════════════════════════
# STEP 1: EXTRACT 4 TOKEN DIMENSIONS
# ═══════════════════════════════════════════════════════

# (a) STATUTORY  — every section + act as quoted phrases
#     Format: "section 420 IPC", "section 138 NI Act", "section 482 CrPC"

# (b) DOCTRINAL  — legal doctrine names as quoted phrases (2–4 words)
#     Format: "abuse of process", "civil dispute criminal cloak",
#     "mala fide FIR", "mens rea", "double jeopardy",
#     "legally enforceable debt", "ratio decidendi"

# (c) FACTUAL    — distinctive factual pattern as quoted phrase
#     Format: "dishonoured cheque", "forged letterhead",
#     "partnership dispute", "loan recovery", "without compensation"

# (d) PROCEDURAL — stage + relief as quoted phrase
#     Format: "quash FIR", "discharge application", "anticipatory bail"

# ═══════════════════════════════════════════════════════
# STEP 2: BUILD QUERIES IN 4 TIERS
# ═══════════════════════════════════════════════════════

# Use AND/OR Boolean operators between all quoted phrases.
# Each query component in quotes must be 2–5 words. No bare single words.

# TIER 1 — HYPER-SPECIFIC  (2–4 results expected)
#   Combine: statute (quoted) AND doctrine (quoted) AND factual qualifier
#   Use OR for alternate doctrines or factual synonyms.
#   Example: "section 138 NI Act" AND "dishonoured cheque" AND conviction
#   Example: "section 420 IPC" AND "section 482 CrPC" AND "civil dispute criminal cloak"
#   Example: "section 300A" AND "deprivation of property" AND "without compensation"

# TIER 2 — SPECIFIC  (10–30 results)
#   Combine: statute (quoted) AND doctrine OR alternate phrase
#   Example: "section 482 CrPC" AND ("quash FIR" OR "abuse of process")
#   Example: "section 138 NI Act" AND ("legally enforceable debt" OR "mens rea")
#   Example: "LARR Act" AND ("just compensation" OR "solatium") AND acquisition

# TIER 3 — DOCTRINAL  (50–200 results, catches landmark judgments)
#   Single exact quoted doctrine phrase — 2–4 words
#   Example: "civil dispute criminal cloak"
#   Example: "legally enforceable debt"
#   Example: "abuse of process of court"
#   Example: "double jeopardy"

# TIER 4 — CASE-NAME QUERIES
#   Landmark case names that directly apply to the issues extracted.
#   Use short recognisable citation forms:
#   Example: "G. Sagar Suri", "Bhajan Lal guidelines",
#   "Paramjeet Batra", "Inder Mohan Goswami"

# For every TIER 1 and TIER 2 query also produce an Indian Kanoon
# doctype variant by appending " doctypes: supremecourt" (or the
# appropriate HC doctype based on the jurisdiction in the document).

# ═══════════════════════════════════════════════════════
# STEP 3: INDIAN KANOON READY QUERIES
# ═══════════════════════════════════════════════════════

# Pick the 8–12 best Boolean queries for immediate copy-paste into Indian Kanoon.
# For each provide: the query, expected hit count range, and one-line reason.
# All queries must use "quoted phrases" AND/OR Boolean operators.

# ═══════════════════════════════════════════════════════
# SELF-CHECK (silent — do not print)
# ═══════════════════════════════════════════════════════
# □ Every tier_1 and tier_2 query uses AND/OR between "quoted phrases"
# □ tier_3 entries are single "quoted doctrine phrases"
# □ No filler words, no sentences, no plain keyword strings
# □ tier_1 has "section/act" AND "doctrine" in each query
# □ tier_4 has real recognisable case names
# □ At least 3 queries per tier
# □ Valid JSON

# ═══════════════════════════════════════════════════════
# OUTPUT — STRICT JSON ONLY (no preamble, no markdown outside the block)
# ═══════════════════════════════════════════════════════

# ```json
# {{
#   "case_identification": {{
#     "court": "",
#     "proceeding_type": "",
#     "sections_invoked": []
#   }},
#   "tokens": {{
#     "statutory": [],
#     "doctrinal": [],
#     "factual": [],
#     "procedural": []
#   }},
#   "search_queries": {{
#     "tier_1_hyperspecific": [],
#     "tier_2_specific": [],
#     "tier_3_doctrinal": [],
#     "tier_4_landmarks": []
#   }},
#   "indian_kanoon_ready": [
#     {{"query": "", "expected_hits": "", "why": ""}}
#   ],
#   "distinguishing_facts": []
# }}
# ```

# ═══════════════════════════════════════════════════════
# DOCUMENT
# ═══════════════════════════════════════════════════════

# {case_context}

# USER QUERY: {base_query}
# """


# # ── Helpers ────────────────────────────────────────────────────────────────────

# def _is_valid_query(q: str) -> bool:
#     """Reject garbage: '--', '-', '[placeholder]', < 5 chars, pure punctuation."""
#     q = (q or "").strip()
#     if not q or len(q) < 5:
#         return False
#     if re.match(r"^[-—–=_.\s]+$", q):
#         return False
#     if re.match(r"^\[.*\]$", q):
#         return False
#     if q.startswith("[") and "]" in q and len(q) < 30:
#         return False
#     # Boolean queries with AND/OR and quoted phrases are always valid
#     if re.search(r'\bAND\b|\bOR\b', q) and re.search(r'"[^"]{3,}"', q):
#         return True
#     # Reject full-sentence issue statements (too long, contain filler)
#     filler_words = ("whether", "did the", "does the", "was the", "correctly",
#                     "properly", "in this case", "question of", "issue of")
#     q_lower = q.lower()
#     if any(w in q_lower for w in filler_words):
#         return False
#     return True


# def _truncate_words(text: str, max_words: int) -> str:
#     words = text.split()
#     return " ".join(words[:max_words]) if len(words) > max_words else text


# def _get_ik_token() -> Optional[str]:
#     return (
#         os.environ.get("INDIAN_KANOON_TOKEN")
#         or os.environ.get("INDIAN_KANOON_API_TOKEN")
#         or os.environ.get("IK_API_TOKEN")
#     )


# def _db_log(run_id, agent, stage, level, msg, meta=None):
#     if not run_id:
#         return
#     try:
#         from db.client import agent_log_insert
#         agent_log_insert(run_id, None, agent, stage, level, msg, meta)
#     except Exception:
#         pass


# # ══════════════════════════════════════════════════════════════════════════════
# # KEYWORD EXTRACTOR AGENT
# # ══════════════════════════════════════════════════════════════════════════════

# class KeywordExtractorAgent(BaseAgent):
#     """
#     Token-based citation seed generator.

#     Pipeline:
#       1. Run the 4-tier token-extraction prompt → JSON output.
#       2. Parse JSON → statutory/doctrinal/factual/procedural tokens.
#       3. Build keyword_sets: tier_1 → tier_2 → tier_3 → ik_ready queries.
#       4. Parallel IK pre-fetch: ALL tiers submitted to ThreadPoolExecutor at once.
#       5. Build dimension wrappers for backward compat with Watchdog.
#     """

#     name        = "keyword_extractor"
#     description = "Extracts 4-tier search tokens (not sentences) for keyword-based citation retrieval."

#     # ── JSON parser ───────────────────────────────────────────────────────────

#     def _parse_claude_json(self, raw: str) -> Dict[str, Any]:
#         """Strip markdown fences and parse Claude's JSON output."""
#         text = raw.strip()
#         # Remove ```json ... ``` or ``` ... ``` fences
#         text = re.sub(r"^```(?:json)?\s*\n?", "", text, flags=re.M)
#         text = re.sub(r"\n?```\s*$", "", text, flags=re.M)
#         # Sometimes Claude wraps in a single code block — strip leading/trailing
#         text = text.strip()
#         # Find the outermost { ... } block if there's extra text around it
#         m = re.search(r"\{.*\}", text, re.DOTALL)
#         if m:
#             text = m.group(0)
#         return json.loads(text)

#     def _extract_tiers(self, data: Dict[str, Any]) -> Dict[str, List[str]]:
#         """
#         Extract and validate all query lists from parsed JSON.
#         Applies _is_valid_query and strips IK doctype variants into a
#         separate key so the plain queries go to ES/local search.
#         """
#         sq = data.get("search_queries") or {}

#         def _clean_list(lst: Any) -> List[str]:
#             if not isinstance(lst, list):
#                 return []
#             out = []
#             for item in lst:
#                 q = str(item).strip().strip("\"'")
#                 if _is_valid_query(q):
#                     out.append(q)
#             return out

#         ik_ready_raw = data.get("indian_kanoon_ready") or []
#         ik_ready_queries: List[str] = []
#         for item in ik_ready_raw:
#             if isinstance(item, dict):
#                 q = str(item.get("query") or "").strip()
#             else:
#                 q = str(item).strip()
#             if _is_valid_query(q):
#                 ik_ready_queries.append(q)

#         return {
#             "tier_1":    _clean_list(sq.get("tier_1_hyperspecific")),
#             "tier_2":    _clean_list(sq.get("tier_2_specific")),
#             "tier_3":    _clean_list(sq.get("tier_3_doctrinal")),
#             "tier_4":    _clean_list(sq.get("tier_4_landmarks")),
#             "ik_ready":  ik_ready_queries,
#         }

#     # ── IK search helpers ─────────────────────────────────────────────────────

#     def _ik_search_one(
#         self,
#         query: str,
#         tier: str,
#         dim_id: Any,
#     ) -> List[Dict[str, Any]]:
#         """
#         Single IK API call. Strips 'doctypes: xxx' suffix before sending
#         (IK doctype filtering is handled separately via the doctypes param).
#         """
#         from services.indian_kanoon import ik_search

#         # Extract doctype hint if present, strip from query text
#         doctype_match = re.search(r"doctypes\s*:\s*(\w+)", query, flags=re.I)
#         doctype_hint = doctype_match.group(1).lower() if doctype_match else "judgments"
#         clean_q = re.sub(r"doctypes\s*:\s*\w+", "", query, flags=re.I).strip()
#         # Only strip surrounding quotes for plain-keyword queries, not Boolean queries
#         if not re.search(r'\bAND\b|\bOR\b|"[^"]{3,}"', clean_q):
#             clean_q = clean_q.strip("\"'")
#         if not clean_q:
#             return []

#         try:
#             resp = ik_search(clean_q, pagenum=0, doctypes=doctype_hint)
#             docs = (resp or {}).get("docs") or []
#             out = []
#             for d in docs[:_PER_QUERY_LIMIT]:
#                 out.append({
#                     "external_id":     str(d.get("tid", "")),
#                     "title":           d.get("title", ""),
#                     "snippet":         d.get("headline", ""),
#                     "docsource":       d.get("docsource", ""),
#                     "_source":         "indian_kanoon",
#                     "_dimension_id":   dim_id,
#                     "_dimension_name": f"{tier} Query",
#                     "_query_type":     tier,
#                     "_query":          clean_q,
#                 })
#             logger.info("[KE] IK [%s] %r → %d result(s)", tier, clean_q[:60], len(out))
#             return out
#         except Exception as exc:
#             logger.warning("[KE] IK search failed %r: %s", clean_q[:60], exc)
#             return []

#     def _prefetch_ik_parallel(
#         self,
#         tiers: Dict[str, List[str]],
#         run_id: Optional[str],
#         user_id: str,
#     ) -> List[Dict[str, Any]]:
#         """
#         Submit ALL tier queries to ThreadPoolExecutor simultaneously.

#         Task allocation per tier:
#           tier_1 (hyper-specific)  → up to _MAX_IK_PER_TIER queries, dim_id=1
#           tier_2 (specific)        → up to _MAX_IK_PER_TIER queries, dim_id=2
#           tier_3 (doctrinal)       → up to 3 queries,                 dim_id=3
#           tier_4 (landmark seeds)  → up to _MAX_LANDMARK_SEEDS,       dim_id="landmark"
#           ik_ready                 → remaining slots,                 dim_id=4

#         Every task runs in parallel; results are deduplicated by IK tid.
#         """
#         tasks: List[Tuple[str, str, Any]] = []

#         seen_q: set = set()

#         def _add(lst: List[str], tier_name: str, dim_id: Any, max_n: int):
#             for q in lst[:max_n]:
#                 if q not in seen_q:
#                     seen_q.add(q)
#                     tasks.append((q, tier_name, dim_id))

#         _add(tiers["tier_1"],   "tier_1_hyperspecific", 1, _MAX_IK_PER_TIER)
#         _add(tiers["tier_2"],   "tier_2_specific",      2, _MAX_IK_PER_TIER)
#         _add(tiers["tier_3"],   "tier_3_doctrinal",     3, 3)
#         _add(tiers["tier_4"],   "landmark_seed",        "landmark", _MAX_LANDMARK_SEEDS)
#         _add(tiers["ik_ready"], "ik_ready",             4, _MAX_IK_PER_TIER)

#         # Hard cap — never exceed _MAX_IK_TOTAL API calls regardless of tier config
#         if len(tasks) > _MAX_IK_TOTAL:
#             tasks = tasks[:_MAX_IK_TOTAL]
#             logger.info("[KE] IK tasks capped at %d", _MAX_IK_TOTAL)

#         if not tasks:
#             return []

#         t1_n  = sum(1 for _, t, _ in tasks if t == "tier_1_hyperspecific")
#         t2_n  = sum(1 for _, t, _ in tasks if t == "tier_2_specific")
#         lm_n  = sum(1 for _, t, _ in tasks if t == "landmark_seed")
#         total = len(tasks)

#         _db_log(run_id, self.name, self.name, "INFO",
#                 f"📚 IK parallel pre-fetch — {total} tasks "
#                 f"(T1={t1_n} T2={t2_n} T3={total-t1_n-t2_n-lm_n} LM={lm_n})",
#                 {"task_count": total, "workers": _IK_WORKERS})

#         logger.info("[KE] IK parallel pre-fetch: %d tasks across %d workers", total, _IK_WORKERS)

#         raw_batches: List[List[Dict]] = []
#         with ThreadPoolExecutor(max_workers=_IK_WORKERS) as pool:
#             fut_map = {
#                 pool.submit(self._ik_search_one, q, tier_name, dim_id): (q, tier_name)
#                 for q, tier_name, dim_id in tasks
#             }
#             for fut in as_completed(fut_map):
#                 q, tier_name = fut_map[fut]
#                 try:
#                     results = fut.result(timeout=20)
#                     # Mark landmark seeds for downstream traceability/ranking.
#                     if tier_name == "landmark_seed":
#                         for r in results:
#                             r["is_seed"] = True
#                             r["_dimension_name"] = "Landmark Precedent"
#                     raw_batches.append(results)
#                 except Exception as exc:
#                     logger.warning("[KE] IK task error %r: %s", q[:60], exc)

#         # Record usage
#         try:
#             from utils.usage_tracker import record_ik
#             record_ik(run_id, user_id, "search", count=total)
#         except Exception:
#             pass

#         # Deduplicate by IK tid
#         seen_tids: set = set()
#         candidates: List[Dict[str, Any]] = []
#         for batch in raw_batches:
#             for c in batch:
#                 tid = (c.get("external_id") or "").strip()
#                 if not tid or tid in seen_tids:
#                     continue
#                 seen_tids.add(tid)
#                 candidates.append(c)

#         logger.info("[KE] IK parallel pre-fetch done — %d unique candidates from %d tasks",
#                     len(candidates), total)
#         _db_log(run_id, self.name, self.name, "INFO",
#                 f"✅ IK pre-fetch: {len(candidates)} unique candidates",
#                 {"candidates": len(candidates), "tasks": total,
#                  "tids": [c["external_id"] for c in candidates[:20]]})
#         return candidates

#     # ── Dimension builder (backward compat with Watchdog/FetcherAgent) ─────────

#     def _build_dimensions(
#         self,
#         tiers: Dict[str, List[str]],
#         statutes: List[str],
#         doctrines: List[str],
#         factuals: List[str],
#     ) -> List[Dict[str, Any]]:
#         """
#         Map tier groups to the dimension dict format consumed by Watchdog ES search.
#         """
#         dims: List[Dict[str, Any]] = []
#         dim_id = 1

#         def _qs(q: str) -> str:
#             return _truncate_words(q, 15)

#         def _sem(qs: List[str], extras: List[str]) -> str:
#             return " ".join(filter(None, qs[:3] + extras[:2]))[:600]

#         # Dim 1 — Tier 1: hyper-specific
#         t1 = tiers.get("tier_1") or []
#         if t1:
#             prov = _qs(statutes[0]) if statutes else _qs(t1[0])
#             dims.append({
#                 "dimension_id": dim_id,
#                 "name": "Hyper-Specific Keyword Search",
#                 "reasoning": "Statute + doctrine + factual qualifier — highest precision.",
#                 "queries": {
#                     "sc_query":        _qs(t1[0]),
#                     "hc_query":        _qs(t1[1] if len(t1) > 1 else t1[0]),
#                     "provision_query": prov,
#                     "semantic_query":  _sem(t1, doctrines),
#                 },
#             })
#             dim_id += 1

#         # Dim 2 — Tier 2: specific
#         t2 = tiers.get("tier_2") or []
#         if t2:
#             dims.append({
#                 "dimension_id": dim_id,
#                 "name": "Specific Keyword Search",
#                 "reasoning": "Statute + doctrine combination — medium precision.",
#                 "queries": {
#                     "sc_query":        _qs(t2[0]),
#                     "hc_query":        _qs(t2[1] if len(t2) > 1 else t2[0]),
#                     "provision_query": _qs(t2[0]),
#                     "semantic_query":  _sem(t2, doctrines + factuals),
#                 },
#             })
#             dim_id += 1

#         # Dim 3 — Tier 3: doctrinal
#         t3 = tiers.get("tier_3") or []
#         if t3:
#             dims.append({
#                 "dimension_id": dim_id,
#                 "name": "Doctrinal Search",
#                 "reasoning": "Doctrine-only queries to surface landmark judgments.",
#                 "queries": {
#                     "sc_query":        _qs(t3[0]),
#                     "hc_query":        _qs(t3[1] if len(t3) > 1 else t3[0]),
#                     "provision_query": _qs(t3[0]),
#                     "semantic_query":  _sem(t3, doctrines),
#                 },
#             })
#             dim_id += 1

#         # Dim 4 — Tier 4: landmark case seeds
#         t4 = tiers.get("tier_4") or []
#         for case_name in t4[:2]:
#             dims.append({
#                 "dimension_id": dim_id,
#                 "name": f"Landmark: {case_name[:50]}",
#                 "reasoning": "Landmark precedent seed search.",
#                 "queries": {
#                     "sc_query":        _qs(case_name),
#                     "hc_query":        _qs(case_name),
#                     "provision_query": _qs(case_name),
#                     "semantic_query":  case_name[:600],
#                 },
#             })
#             dim_id += 1

#         return dims

#     # ── Main run ───────────────────────────────────────────────────────────────

#     def run(self, context: AgentContext) -> AgentResult:
#         run_id  = context.metadata.get("run_id")
#         files   = context.metadata.get("case_file_context") or []
#         query   = (context.query or "").strip()
#         user_id = context.metadata.get("user_id") or context.user_id or "anonymous"

#         _db_log(run_id, self.name, self.name, "INFO",
#                 f"🔍 Keyword Extractor — {len(files)} file(s) | query={query[:80]!r}",
#                 {"file_count": len(files), "query": query})

#         # ── Nothing to work with ──────────────────────────────────────────────
#         if not files and not query:
#             _cm = context.metadata.get("controversy_map") or {}
#             fallback = str(_cm.get("controversy_query") or _cm.get("central_controversy") or "").strip()
#             context.metadata.update({
#                 "search_query":  fallback,
#                 "keyword_sets":  [fallback] if fallback else [],
#                 "dimensions":    [],
#                 "keyword_data":  {},
#             })
#             context.dimensions = []
#             return AgentResult(data={"keyword_sets_count": int(bool(fallback)),
#                                      "dimensions_count": 0,
#                                      "message": "No case context; using controversy fallback."})

#         # ── Build case context string ─────────────────────────────────────────
#         parts: List[str] = []
#         for f in files[:15]:
#             name    = f.get("name") or f.get("filename") or "document"
#             snippet = (f.get("snippet") or f.get("content") or "")[:5000].strip()
#             if snippet:
#                 parts.append(f"[{name}]\n{snippet}")
#         case_context_str = "\n\n".join(parts)[:14000]

#         if not case_context_str and not query:
#             context.metadata["keyword_sets"] = []
#             context.dimensions = []
#             return AgentResult(data={"keyword_sets_count": 0, "dimensions_count": 0})

#         # ── Call Claude ───────────────────────────────────────────────────────
#         prompt = _KEYWORD_EXTRACTION_PROMPT.format(
#             case_context=case_context_str or "(no document content provided)",
#             base_query=query or "(no query provided)",
#         )

#         logger.info("[KE] Calling Claude for 4-tier token extraction…")
#         raw = self._claude(
#             prompt,
#             max_tokens=2500,
#             temperature=0.1,
#             run_id=run_id,
#             user_id=user_id,
#             operation="keyword_extract",
#         )

#         if not raw:
#             logger.warning("[KE] Claude returned empty — falling back to base query")
#             kws = [query] if query else []
#             context.metadata["keyword_sets"] = kws
#             context.metadata["search_query"]  = query
#             context.dimensions = []
#             return AgentResult(data={"keyword_sets_count": len(kws), "dimensions_count": 0,
#                                      "message": "Claude returned empty; using base query."})

#         # ── Parse JSON ────────────────────────────────────────────────────────
#         data: Dict[str, Any] = {}
#         try:
#             data = self._parse_claude_json(raw)
#         except (json.JSONDecodeError, Exception) as exc:
#             logger.warning("[KE] JSON parse failed (%s) — falling back to base query", exc)
#             # Log raw response to help debug
#             logger.debug("[KE] Raw Claude response:\n%s", raw[:2000])
#             _db_log(run_id, self.name, self.name, "WARNING",
#                     f"JSON parse failed: {exc}. Raw (first 500 chars): {raw[:500]}")

#         # ── Extract tokens and tiers ──────────────────────────────────────────
#         tokens                 = data.get("tokens") or {}
#         statutes: List[str]   = [str(s).strip() for s in (tokens.get("statutory") or []) if str(s).strip()]
#         doctrines: List[str]  = [str(d).strip() for d in (tokens.get("doctrinal") or []) if str(d).strip()]
#         factuals: List[str]   = [str(f).strip() for f in (tokens.get("factual") or []) if str(f).strip()]
#         procedural: List[str] = [str(p).strip() for p in (tokens.get("procedural") or []) if str(p).strip()]
#         legal_issues          = factuals + procedural
#         distinguishing_factors = [str(x) for x in (data.get("distinguishing_facts") or [])]

#         tiers = self._extract_tiers(data)
#         landmark_cases = tiers["tier_4"]

#         # ── Build flat keyword_sets ───────────────────────────────────────────
#         # Priority: tier_1 → tier_2 → tier_3 → ik_ready
#         # (tier_4 are landmark seeds for IK, not for ES local search)
#         seen_kw: set = set()
#         keyword_sets: List[str] = []

#         def _add_kw(lst: List[str], max_n: int = 999):
#             for q in lst[:max_n]:
#                 # Strip doctype suffix for local/ES search
#                 q_clean = re.sub(r"\s+doctypes\s*:\s*\w+", "", q, flags=re.I).strip()
#                 if q_clean and q_clean not in seen_kw and _is_valid_query(q_clean):
#                     seen_kw.add(q_clean)
#                     keyword_sets.append(q_clean)

#         _add_kw(tiers["tier_1"])
#         _add_kw(tiers["tier_2"])
#         _add_kw(tiers["tier_3"])
#         _add_kw(tiers["ik_ready"])
#         # Also add raw statutory and doctrinal tokens as fallback searches
#         _add_kw(statutes[:3], 3)
#         _add_kw(doctrines[:3], 3)

#         # Fallback when Claude produced nothing valid
#         if not keyword_sets:
#             _cm = context.metadata.get("controversy_map") or {}
#             for _fb_key in ("controversy_query", "central_controversy", "factual_trigger", "legal_claim"):
#                 _fb = str(_cm.get(_fb_key) or "").strip()
#                 if _fb and _fb not in seen_kw:
#                     seen_kw.add(_fb)
#                     keyword_sets.append(_fb)
#             if keyword_sets:
#                 logger.warning("[KE] No valid queries from Claude — using controversy_map fallback (%d)", len(keyword_sets))
#             elif query:
#                 keyword_sets = [query]
#                 logger.warning("[KE] No valid queries from Claude — using base query as fallback")

#         # Primary seed = first tier_1 query or first keyword
#         primary_query = (tiers["tier_1"] or keyword_sets or [query])[0] if (tiers["tier_1"] or keyword_sets or query) else query

#         # ── Build dimensions ──────────────────────────────────────────────────
#         dimensions = self._build_dimensions(tiers, statutes, doctrines, factuals)

#         # ── Log extracted tokens ──────────────────────────────────────────────
#         logger.info(
#             "[KE] Extracted — T1=%d T2=%d T3=%d T4=%d IK-ready=%d | "
#             "%d keyword_sets | %d dims | %d statutes | %d doctrines",
#             len(tiers["tier_1"]), len(tiers["tier_2"]),
#             len(tiers["tier_3"]), len(tiers["tier_4"]),
#             len(tiers["ik_ready"]),
#             len(keyword_sets), len(dimensions),
#             len(statutes), len(doctrines),
#         )
#         for i, q in enumerate(keyword_sets[:10], 1):
#             logger.info("  [KW %02d] %s", i, q[:120])

#         # ── Store context ─────────────────────────────────────────────────────
#         keyword_data: Dict[str, Any] = {
#             "statutes":             statutes,
#             "doctrines":            doctrines,
#             "factuals":             factuals,
#             "procedural":           procedural,
#             "tiers":                tiers,
#             "landmark_cases":       landmark_cases,
#             "distinguishing_facts": distinguishing_factors,
#             "case_identification":  data.get("case_identification") or {},
#             "raw_json":             data,
#         }

#         context.metadata["keyword_data"]    = keyword_data
#         context.metadata["keyword_sets"]    = keyword_sets
#         context.metadata["search_query"]    = primary_query
#         context.metadata["dimensions"]      = dimensions
#         context.dimensions                   = dimensions
#         context.metadata["landmark_cases"]  = landmark_cases
#         context.metadata["statutes"]        = statutes
#         context.metadata["legal_issues"]    = legal_issues
#         context.metadata["citation_finder_mode"] = 1 if files else 2

#         _db_log(run_id, self.name, self.name, "INFO",
#                 f"✅ Tokens extracted — {len(keyword_sets)} queries | "
#                 f"{len(dimensions)} dims | T1={len(tiers['tier_1'])} "
#                 f"T2={len(tiers['tier_2'])} T3={len(tiers['tier_3'])} "
#                 f"T4={len(tiers['tier_4'])}",
#                 {
#                     "keyword_sets_count":   len(keyword_sets),
#                     "dimensions_count":     len(dimensions),
#                     "tier_counts": {
#                         "tier_1": len(tiers["tier_1"]),
#                         "tier_2": len(tiers["tier_2"]),
#                         "tier_3": len(tiers["tier_3"]),
#                         "tier_4": len(tiers["tier_4"]),
#                     },
#                     "statutes_count":        len(statutes),
#                     "doctrines_count":       len(doctrines),
#                     "landmark_cases_count":  len(landmark_cases),
#                     "keywords_preview":      keyword_sets[:6],
#                     "landmark_cases":        landmark_cases[:5],
#                 })

#         # ── IK parallel pre-fetch ─────────────────────────────────────────────
#         # All tier queries fire simultaneously in one ThreadPoolExecutor pool.
#         any_tier_has_queries = any(tiers[k] for k in ("tier_1", "tier_2", "tier_3", "tier_4", "ik_ready"))
#         if _get_ik_token() and any_tier_has_queries:
#             try:
#                 ik_candidates = self._prefetch_ik_parallel(tiers, run_id=run_id, user_id=user_id)
#                 context.metadata["candidates_ik"] = ik_candidates
#                 context.metadata["ik_prefetched"] = True
#             except Exception as exc:
#                 logger.warning("[KE] IK parallel pre-fetch failed: %s", exc)
#         else:
#             logger.info("[KE] IK pre-fetch skipped — no token or no tier queries")

#         return AgentResult(data={
#             "search_query":        primary_query,
#             "augmented":           True,
#             "keyword_sets_count":  len(keyword_sets),
#             "dimensions_count":    len(dimensions),
#             "tier_1_count":        len(tiers["tier_1"]),
#             "tier_2_count":        len(tiers["tier_2"]),
#             "tier_3_count":        len(tiers["tier_3"]),
#             "tier_4_count":        len(tiers["tier_4"]),
#             "ik_ready_count":      len(tiers["ik_ready"]),
#             "landmark_cases_count": len(landmark_cases),
#             "statutes_count":       len(statutes),
#             "doctrines_count":      len(doctrines),
#             "message": (
#                 f"Extracted {len(keyword_sets)} search tokens across 4 tiers "
#                 f"(T1={len(tiers['tier_1'])}, T2={len(tiers['tier_2'])}, "
#                 f"T3={len(tiers['tier_3'])}, T4={len(tiers['tier_4'])}), "
#                 f"{len(landmark_cases)} landmark seeds"
#             ),
#         })


from __future__ import annotations

import json
import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional

from agents.base_agent import BaseAgent, AgentContext, AgentResult

logger = logging.getLogger(__name__)

# ── CONFIG ─────────────────────────────────────────────────────────

_MAX_IK_PER_TIER = 3
_MAX_LANDMARKS = 2
_MAX_TOTAL_TASKS = 10
_WORKERS = 8


# ───────────────────────────────────────────────────────────────────
# 🔧 UTILITIES
# ───────────────────────────────────────────────────────────────────

def _normalize_for_ik(q: str) -> str:
    if not q:
        return ""

    q = q.strip()

    # Remove filler words
    q = re.sub(r"\b(whether|issue|question|case of|application|matter)\b", "", q, flags=re.I)

    phrases = re.findall(r'"[^"]{3,}"', q)

    if not phrases:
        words = [w for w in re.findall(r'\w+', q) if len(w) > 3][:5]
        phrases = [f'"{w}"' for w in words]

    q = " AND ".join(dict.fromkeys(phrases))
    return re.sub(r"\s+AND\s+AND\s+", " AND ", q).strip()


def _extract_case_citations(text: str) -> List[str]:
    return list(set(re.findall(r"\b[A-Z][a-zA-Z]+ vs\.? [A-Z][a-zA-Z]+\b", text)))


def _apply_ranking_boost(results: List[Dict]) -> List[Dict]:
    for r in results:
        score = r.get("_score_boost", 1.0)
        court = (r.get("docsource") or "").lower()

        if "supreme court" in court:
            score += 3
        elif "high court" in court:
            score += 2
        else:
            score += 0.5

        r["_final_score"] = score

    return sorted(results, key=lambda x: -x["_final_score"])


# ───────────────────────────────────────────────────────────────────
# 🚀 AGENT
# ───────────────────────────────────────────────────────────────────

class KeywordExtractorAgent(BaseAgent):

    name = "keyword_extractor"
    description = "Precision-first legal keyword extractor + hybrid retrieval"

    # ── Local DB ───────────────────────────────────────────────────

    def _search_local_db(self, query: str) -> List[Dict]:
        try:
            from services.local_db import search_documents

            return search_documents(
                query=query,
                top_k=5,
                filters={"court_priority": ["supreme_court", "high_court"]}
            )
        except Exception:
            return []

    # ── Hybrid Search ──────────────────────────────────────────────

    def _hybrid_search(self, query: str, tier: str, dim_id: Any) -> List[Dict]:
        results = []
        query = _normalize_for_ik(query)

        # Local DB first
        local = self._search_local_db(query)
        for r in local:
            r["_source"] = "local_db"
            r["_score_boost"] = 3.0
            r["_query_type"] = tier
        results.extend(local)

        # IK search
        try:
            from services.indian_kanoon import ik_search

            resp = ik_search(query, pagenum=0, doctypes="judgments")
            docs = (resp or {}).get("docs") or []

            for d in docs[:5]:
                results.append({
                    "external_id": str(d.get("tid", "")),
                    "title": d.get("title", ""),
                    "snippet": d.get("headline", ""),
                    "docsource": d.get("docsource", ""),
                    "_source": "indian_kanoon",
                    "_score_boost": 1.0,
                    "_query_type": tier,
                    "_dimension_id": dim_id,
                })
        except Exception:
            pass

        return results

    # ── Parallel Retrieval ─────────────────────────────────────────

    def _prefetch_hybrid_parallel(self, tiers, context_text):
        tasks = []
        seen = set()

        # Tier 0 — Precision
        precision = []
        for s in tiers.get("tier_1", [])[:2]:
            for d in tiers.get("tier_3", [])[:2]:
                precision.append(f"{s} AND {d}")

        # Citation-based
        for c in _extract_case_citations(context_text)[:3]:
            precision.append(f'"{c}"')

        def add(lst, tier, dim, max_n):
            for q in lst[:max_n]:
                q = _normalize_for_ik(q)
                if q not in seen:
                    seen.add(q)
                    tasks.append((q, tier, dim))

        add(precision, "tier_0", 0, 3)
        add(tiers.get("tier_1", []), "tier_1", 1, 3)
        add(tiers.get("tier_2", []), "tier_2", 2, 3)
        add(tiers.get("tier_3", []), "tier_3", 3, 2)
        add(tiers.get("tier_4", []), "landmark", 4, 2)

        tasks = tasks[:_MAX_TOTAL_TASKS]

        results = []
        seen_ids = set()

        with ThreadPoolExecutor(max_workers=_WORKERS) as pool:
            futures = {
                pool.submit(self._hybrid_search, q, t, d): q
                for q, t, d in tasks
            }

            for fut in as_completed(futures):
                try:
                    batch = fut.result()
                    for r in batch:
                        tid = r.get("external_id") or r.get("id")
                        if tid and tid not in seen_ids:
                            seen_ids.add(tid)
                            results.append(r)
                except Exception:
                    pass

        return _apply_ranking_boost(results)

    # ── Main Run ───────────────────────────────────────────────────

    def run(self, context: AgentContext) -> AgentResult:
        query = context.query or ""
        files = context.metadata.get("case_file_context") or []

        # Build context text
        parts = []
        for f in files[:10]:
            parts.append((f.get("content") or "")[:2000])

        case_text = "\n".join(parts) or query

        # ── Call Claude (same as your existing)
        prompt = f"Extract legal search queries:\n\n{case_text}\n\nQuery: {query}"

        raw = self._claude(prompt, max_tokens=1500, temperature=0.1)

        tiers = {"tier_1": [], "tier_2": [], "tier_3": [], "tier_4": []}

        try:
            data = json.loads(raw)
            tiers = data.get("search_queries") or tiers
        except Exception:
            tiers["tier_1"] = [query]

        # ── Hybrid retrieval
        results = self._prefetch_hybrid_parallel(tiers, case_text)

        context.metadata["candidates_ik"] = results[:15]
        context.metadata["ik_prefetched"] = True

        return AgentResult(
            data={
                "results": len(results),
                "top_results": results[:5],
                "message": "Hybrid legal retrieval complete"
            }
        )