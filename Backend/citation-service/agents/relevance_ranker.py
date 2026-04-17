"""
RelevanceRanker Agent — scores each candidate judgment for relevance to the
controversy map and legal dimensions, then reorders context.judgement_ids.

Pipeline:
  1. Read context.judgement_ids + local_judgement_hints for title/ratio snippets
  2. Fetch missing titles from DB (judgement_get for gaps)
  3. Batch Gemini calls (up to 8 judgments per call) to score each 0-10
  4. Store scores in context.metadata["relevance_scores"]
  5. Drop IRRELEVANT judgments (score < 2) unless admin-uploaded
  6. Reorder context.judgement_ids by score descending

Score tiers:
  8-10  STRONG   — clearly on point, same factual matrix
  5-7   RELEVANT — on point on at least one dimension
  2-4   WEAK     — tangentially relevant
  0-1   IRRELEVANT — wrong area or too generic (dropped unless admin)
"""

from __future__ import annotations

import json
import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional, Tuple

from agents.base_agent import BaseAgent, AgentContext, AgentResult

logger = logging.getLogger(__name__)

_RANKER_WORKERS = max(2, min(6, int(os.environ.get("CITATION_RANKER_WORKERS", "4"))))
_MIN_RELEVANCE_SCORE = float(os.environ.get("CITATION_MIN_RELEVANCE_SCORE", "2.0"))
_BATCH_SIZE = int(os.environ.get("CITATION_RANKER_BATCH_SIZE", "8"))

_SCORE_PROMPT = """\
You are a senior Indian legal research analyst.

Your task: score each judgment below for its relevance to the legal dispute.

CONTROVERSY MAP
{controversy_section}

LEGAL DIMENSIONS (search axes):
{dimensions_section}

JUDGMENTS TO SCORE
{judgments_section}

SCORING RULES
- Score 8-10 (STRONG): clearly on point — same factual matrix, same offence/provision/ingredients, same relief
- Score 5-7 (RELEVANT): on point on at least one legal dimension; useful precedent
- Score 2-4 (WEAK): tangentially relevant; wrong area or facts but same broad domain
- Score 0-1 (IRRELEVANT): wrong area of law, too generic, or no connection to dispute

Return a JSON array with one object per judgment, in the same order:
[
  {{"id": "<id>", "score": <0-10 integer>, "tier": "STRONG|RELEVANT|WEAK|IRRELEVANT", "reasoning": "one sentence"}},
  ...
]
Return ONLY the JSON array. No markdown, no extra text.
"""


def _controversy_section(cm: Dict[str, Any]) -> str:
    if not cm:
        return "(not available)"
    lines = []
    if cm.get("central_controversy"):
        lines.append(f"Central dispute: {cm['central_controversy']}")
    if cm.get("factual_trigger"):
        lines.append(f"Factual trigger: {cm['factual_trigger']}")
    if cm.get("legal_claim"):
        lines.append(f"Legal claim: {cm['legal_claim']}")
    if cm.get("disputed_outcome"):
        lines.append(f"Disputed outcome: {cm['disputed_outcome']}")
    return "\n".join(lines) if lines else "(not available)"


def _dimensions_section(dims: List[Dict[str, Any]]) -> str:
    if not dims:
        return "(not available)"
    parts = []
    for d in dims[:5]:
        name = (d.get("name") or "").strip()
        reasoning = (d.get("reasoning") or "").strip()
        qs = d.get("queries") or {}
        sem = (qs.get("semantic_query") or "").strip()
        if name:
            parts.append(f"• {name}: {reasoning}" + (f"\n  Query: {sem[:120]}" if sem else ""))
    return "\n".join(parts) if parts else "(not available)"


def _judgment_blurb(jid: str, hints: Dict[str, Any], j_detail: Optional[Dict[str, Any]]) -> str:
    """Build a short description of a judgment for the scoring prompt."""
    title = ""
    ratio = ""
    court = ""

    # Try local_judgement_hints first (populated by Watchdog)
    h = hints.get(jid) or {}
    title = str(h.get("title") or h.get("case_name") or "").strip()
    court = str(h.get("court") or h.get("court_code") or "").strip()
    ratio = str(h.get("ratio") or h.get("holding_text") or h.get("summary_text") or "").strip()

    # Fill from DB detail if available
    if j_detail:
        if not title:
            title = str(j_detail.get("title") or j_detail.get("case_name") or "").strip()
        if not court:
            court = str(j_detail.get("court_code") or j_detail.get("court") or "").strip()
        if not ratio:
            cd = j_detail.get("citation_data") or {}
            if isinstance(cd, dict):
                ratio = str(
                    cd.get("holding_text") or cd.get("summary_text") or
                    cd.get("ratio_decidendi") or ""
                ).strip()
            if not ratio:
                ratio = str(j_detail.get("raw_content") or j_detail.get("full_text") or "")[:400].strip()

    title = title[:120] if title else "(untitled)"
    ratio = ratio[:300] if ratio else "(no summary)"
    court = court[:60] if court else ""

    blurb = f"Title: {title}"
    if court:
        blurb += f"\nCourt: {court}"
    blurb += f"\nSummary: {ratio}"
    return blurb


def _score_batch(
    batch: List[Tuple[str, str]],   # [(jid, blurb), ...]
    controversy_sec: str,
    dimensions_sec: str,
    agent: "RelevanceRankerAgent",
    run_id: Optional[str],
    user_id: str,
) -> Dict[str, Dict[str, Any]]:
    """Call Gemini to score a batch of judgments. Returns {jid: {score, tier, reasoning}}."""
    judgments_section_lines = []
    for i, (jid, blurb) in enumerate(batch):
        judgments_section_lines.append(f"[{i + 1}] id={jid}\n{blurb}")
    judgments_section = "\n\n".join(judgments_section_lines)

    prompt = _SCORE_PROMPT.format(
        controversy_section=controversy_sec,
        dimensions_section=dimensions_sec,
        judgments_section=judgments_section,
    )

    try:
        raw = agent._gemini(
            prompt,
            max_tokens=1024,
            temperature=0.1,
            run_id=run_id,
            user_id=user_id,
            operation="relevance_rank",
        )
        text = (raw or "").strip()
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"```\s*$", "", text).strip()
        items = json.loads(text)
        if not isinstance(items, list):
            raise ValueError("not a list")

        out: Dict[str, Dict[str, Any]] = {}
        for item in items:
            if not isinstance(item, dict):
                continue
            jid_raw = str(item.get("id") or "").strip()
            if not jid_raw:
                continue
            try:
                score = float(item.get("score") or 0)
            except (TypeError, ValueError):
                score = 0.0
            score = max(0.0, min(10.0, score))
            tier = str(item.get("tier") or "WEAK").upper()
            reasoning = str(item.get("reasoning") or "").strip()
            out[jid_raw] = {"score": score, "tier": tier, "reasoning": reasoning}
        return out
    except Exception as exc:
        logger.warning("[RELEVANCE_RANKER] Gemini scoring batch failed: %s", exc)
        # Fallback: give every judgment a default "RELEVANT" score
        return {jid: {"score": 5.0, "tier": "RELEVANT", "reasoning": "scoring unavailable"} for jid, _ in batch}


class RelevanceRankerAgent(BaseAgent):
    """
    Scores judgements for relevance to the controversy and reorders
    context.judgement_ids by score descending.  Drops IRRELEVANT
    judgements (score < _MIN_RELEVANCE_SCORE) unless admin-uploaded.

    Must run AFTER Clerk (so all canonical_ids are in DB) and
    BEFORE Librarian (so Librarian gets a pre-sorted list).
    """
    name        = "relevance_ranker"
    description = "Scores and reranks judgements by relevance to the controversy map."

    def run(self, context: AgentContext) -> AgentResult:
        run_id  = context.metadata.get("run_id")
        user_id = context.metadata.get("user_id") or context.user_id or "anonymous"

        jids = list(context.judgement_ids or [])
        if not jids:
            return AgentResult(data={"ranked": 0, "dropped": 0})

        try:
            from db.client import agent_log_insert
            agent_log_insert(run_id, None, self.name, self.name, "INFO",
                f"🎯 RelevanceRanker scoring {len(jids)} judgment(s)…",
                {"total": len(jids)})
        except Exception:
            pass

        cm       = context.metadata.get("controversy_map") or {}
        dims     = context.dimensions or context.metadata.get("dimensions") or []
        hints    = context.metadata.get("local_judgement_hints") or {}

        controversy_sec = _controversy_section(cm)
        dimensions_sec  = _dimensions_section(dims)

        # Build (jid, blurb) pairs — fetch from DB only for those with no hint data
        jid_blurbs: List[Tuple[str, str]] = []
        jids_need_db: List[str] = []

        for jid in jids:
            h = hints.get(jid) or {}
            has_enough = bool(
                (h.get("title") or h.get("case_name")) and
                (h.get("ratio") or h.get("holding_text") or h.get("summary_text"))
            )
            if not has_enough:
                jids_need_db.append(jid)

        # Batch DB fetch for missing data
        db_details: Dict[str, Any] = {}
        if jids_need_db:
            try:
                from db.client import judgements_fetch_by_canonical_ids
                rows = judgements_fetch_by_canonical_ids(jids_need_db, approved_only=False, exclude_low_hierarchy=False)
                for row in rows:
                    cid = str(row.get("canonical_id") or "").strip()
                    if cid:
                        db_details[cid] = row
            except Exception as exc:
                logger.warning("[RELEVANCE_RANKER] DB fetch for blurbs failed: %s", exc)

        for jid in jids:
            blurb = _judgment_blurb(jid, hints, db_details.get(jid))
            jid_blurbs.append((jid, blurb))

        # Score in parallel batches
        scores: Dict[str, Dict[str, Any]] = {}
        batches: List[List[Tuple[str, str]]] = [
            jid_blurbs[i:i + _BATCH_SIZE]
            for i in range(0, len(jid_blurbs), _BATCH_SIZE)
        ]

        def _run_batch(batch: List[Tuple[str, str]]) -> Dict[str, Dict[str, Any]]:
            return _score_batch(batch, controversy_sec, dimensions_sec, self, run_id, user_id)

        with ThreadPoolExecutor(max_workers=_RANKER_WORKERS) as pool:
            futures = {pool.submit(_run_batch, b): b for b in batches}
            for fut in as_completed(futures):
                try:
                    result = fut.result()
                    scores.update(result)
                except Exception as exc:
                    logger.warning("[RELEVANCE_RANKER] batch future failed: %s", exc)
                    for jid, _ in futures[fut]:
                        if jid not in scores:
                            scores[jid] = {"score": 5.0, "tier": "RELEVANT", "reasoning": "batch error"}

        # Identify admin-uploaded judgments (always pass)
        admin_cids: set = set()
        for jid in jids:
            h = hints.get(jid) or {}
            if h.get("is_local_admin") or str(h.get("source_type") or "").lower().startswith("admin"):
                admin_cids.add(jid)

        # Filter + sort
        filtered: List[Tuple[str, float]] = []
        dropped: List[str] = []
        for jid in jids:
            s = scores.get(jid) or {}
            score = float(s.get("score") or 5.0)
            is_admin = jid in admin_cids
            if score < _MIN_RELEVANCE_SCORE and not is_admin:
                dropped.append(jid)
                logger.info(
                    "[RELEVANCE_RANKER] DROPPED (score=%.1f tier=%s): %s",
                    score, s.get("tier", "?"), jid,
                )
            else:
                filtered.append((jid, score))

        # Sort descending by score
        filtered.sort(key=lambda x: x[1], reverse=True)
        ranked_ids = [jid for jid, _ in filtered]

        # Persist
        context.metadata["relevance_scores"] = scores
        context.metadata["relevance_dropped"] = dropped
        context.judgement_ids = ranked_ids

        logger.info(
            "[RELEVANCE_RANKER] %d ranked | %d dropped (threshold=%.1f)",
            len(ranked_ids), len(dropped), _MIN_RELEVANCE_SCORE,
        )

        try:
            from db.client import agent_log_insert
            strong  = sum(1 for s in scores.values() if float(s.get("score") or 0) >= 8)
            relevant = sum(1 for s in scores.values() if 5 <= float(s.get("score") or 0) < 8)
            weak    = sum(1 for s in scores.values() if 2 <= float(s.get("score") or 0) < 5)
            agent_log_insert(run_id, None, self.name, self.name, "INFO",
                f"✅ RelevanceRanker done — 🟢 {strong} STRONG | 🟡 {relevant} RELEVANT | 🔴 {weak} WEAK | ✗ {len(dropped)} dropped",
                {"ranked": len(ranked_ids), "dropped": len(dropped),
                 "strong": strong, "relevant": relevant, "weak": weak})
        except Exception:
            pass

        return AgentResult(data={
            "ranked": len(ranked_ids),
            "dropped": len(dropped),
            "scores": {jid: s.get("score") for jid, s in scores.items()},
        })
