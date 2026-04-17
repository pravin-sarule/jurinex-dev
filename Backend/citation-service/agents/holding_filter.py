"""
agents/holding_filter.py

The holding-level LLM filter — the layer that determines true legal relevance.

For each candidate judgment, extracts the holding/conclusion paragraph and
asks Gemini: "Does this court's decision actually help this lawyer's argument?"

This is the only mechanism that can cross the gap between keyword retrieval
and true legal relevance. No query improvement can replace this.

Uses Gemini Flash for speed and cost efficiency (~50 judgments per case run).
Synchronous implementation using ThreadPoolExecutor to match the existing
pipeline patterns.
"""

from __future__ import annotations

import json
import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# HOLDING EXTRACTION PROMPT
# ---------------------------------------------------------------------------

HOLDING_EXTRACTION_PROMPT = """You are extracting the legal holding from an Indian court judgment.

The "holding" is the court's actual decision and reasoning — typically found:
- Near the end of the judgment
- After phrases like "we hold", "we are of the view", "accordingly", "in the result",
  "for the foregoing reasons", "we find", "it is held"
- In the final 20% of the judgment text

Extract ONLY the holding — the court's actual conclusion on the legal question.
Do NOT include facts, arguments of counsel, or procedural history.
Maximum 200 words.

If you cannot find a clear holding, return the last 3 paragraphs of the judgment.

Return ONLY the holding text. No preamble, no explanation.

JUDGMENT TEXT:
{judgment_text}
"""

# ---------------------------------------------------------------------------
# RELEVANCE SCORING PROMPT
# ---------------------------------------------------------------------------

RELEVANCE_SCORING_PROMPT = """You are a senior Indian advocate doing a pre-citation check.

A lawyer is making this legal argument:

LAWYER'S CONTROVERSY:
Dispute type: {dispute_type}
Key legal question: {key_legal_question}
Lawyer argues (petitioner position): {petitioner_position}
Opponent argues (respondent position): {respondent_position}
Relief sought: {relief_sought}
Applicable sections: {applicable_statutes}

PROPOSED CITATION:
Case: {case_name}
Court: {court_name} | Year: {year}
Holding: {holding_text}

TASK:
Decide whether this judgment's HOLDING actually helps the lawyer's argument.

Score the holding on these criteria:
1. Does the holding address the same legal question the lawyer is arguing?
2. Does the holding support the petitioner's position?
3. Is it directly citable or only analogous?
4. Would a Bombay/Maharashtra High Court accept this citation as relevant?

Return ONLY valid JSON — no preamble, no explanation:
{{
  "relevance_verdict": "DIRECTLY_RELEVANT" | "ANALOGOUS" | "IRRELEVANT",
  "supports": "petitioner" | "respondent" | "neutral",
  "holding_summary": "<one sentence: what the court actually held>",
  "citation_value": "<one sentence: exactly why a lawyer would cite this>",
  "relevance_score": <float 0.0 to 1.0>,
  "include_in_report": <true | false>
}}

Scoring guide:
- DIRECTLY_RELEVANT (score 0.8-1.0): holding squarely answers the legal question, same type of dispute
- ANALOGOUS (score 0.5-0.79): similar legal principle, different context, citable with framing
- IRRELEVANT (score 0.0-0.49): different legal question, wrong context, do not cite
"""

# ---------------------------------------------------------------------------
# EMPTY CONTROVERSY fallback
# ---------------------------------------------------------------------------

EMPTY_CONTROVERSY = {
    "dispute_type": "unknown",
    "key_legal_question": "",
    "petitioner_position": "",
    "respondent_position": "",
    "relief_sought": "",
    "applicable_statutes": [],
}


class HoldingFilter:
    """
    Filters a list of judgment candidates by reading their holdings and
    scoring each against the case controversy.

    Synchronous implementation using ThreadPoolExecutor, matching existing
    pipeline concurrency patterns (ClerkAgent, FetcherAgent, etc.).

    Usage:
        hf = HoldingFilter()
        filtered = hf.filter(candidates, controversy_map)
    """

    def __init__(self):
        self.max_workers = int(os.getenv("HOLDING_FILTER_CONCURRENCY", "8"))
        self.min_score = float(os.getenv("HOLDING_FILTER_MIN_SCORE", "0.50"))
        self._api_key = (
            os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        )
        self._model = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
        # Resolve prompts once at construction (DB → default)
        self._extraction_prompt = HOLDING_EXTRACTION_PROMPT
        self._extraction_max_tokens = 400
        self._scoring_prompt = RELEVANCE_SCORING_PROMPT
        self._scoring_temp = 0.0
        self._scoring_max_tokens = 512
        try:
            from utils.prompt_resolver import resolve_prompt as _resolve_prompt
            _ep = _resolve_prompt(
                name="HoldingExtractor",
                agent_type="citation",
                default_prompt=HOLDING_EXTRACTION_PROMPT,
                default_model=self._model,
                default_temperature=0.0,
                default_max_tokens=400,
            )
            self._extraction_prompt = _ep.prompt
            self._extraction_max_tokens = _ep.max_tokens
            _sp = _resolve_prompt(
                name="HoldingRelevanceScorer",
                agent_type="citation",
                default_prompt=RELEVANCE_SCORING_PROMPT,
                default_model=self._model,
                default_temperature=0.0,
                default_max_tokens=512,
            )
            self._scoring_prompt = _sp.prompt
            self._scoring_temp = _sp.temperature
            self._scoring_max_tokens = _sp.max_tokens
        except Exception as _exc:
            logger.debug("[HOLDING_FILTER] prompt_resolver unavailable: %s", _exc)

    def filter(
        self,
        candidates: list[dict],
        controversy_map: dict,
        max_candidates: int = 100,
    ) -> list[dict]:
        """
        Main entry point.
        Input:  up to max_candidates raw judgment candidates (with text)
        Output: candidates where include_in_report == True, sorted by relevance_score
        """
        if not candidates:
            logger.warning("[HOLDING_FILTER] Received 0 candidates — nothing to filter")
            return []

        controversy = controversy_map or EMPTY_CONTROVERSY
        batch = candidates[:max_candidates]

        logger.info(
            "[HOLDING_FILTER] Starting filter: %d candidates | dispute_type=%s | min_score=%.2f",
            len(batch),
            controversy.get("dispute_type"),
            self.min_score,
        )

        passed: list[dict] = []
        failed_count = 0
        irrelevant_count = 0

        def _score_one(candidate: dict) -> tuple[dict, dict | None]:
            return candidate, self._score_candidate(candidate, controversy)

        with ThreadPoolExecutor(max_workers=min(self.max_workers, len(batch))) as pool:
            futures = {pool.submit(_score_one, c): c for c in batch}
            for fut in as_completed(futures):
                try:
                    candidate, result = fut.result(timeout=60)
                    if result is None:
                        irrelevant_count += 1
                    else:
                        passed.append(result)
                except Exception as exc:
                    candidate = futures[fut]
                    logger.error(
                        "[HOLDING_FILTER] Error scoring %s: %s",
                        candidate.get("title", "unknown")[:60],
                        exc,
                    )
                    failed_count += 1

        # Sort by relevance_score descending
        passed.sort(key=lambda x: x.get("holding_filter_score", 0), reverse=True)

        logger.info(
            "[HOLDING_FILTER] Complete: %d in → %d passed | %d irrelevant | %d errors",
            len(batch), len(passed), irrelevant_count, failed_count,
        )
        return passed

    def _score_candidate(
        self,
        candidate: dict,
        controversy: dict,
    ) -> dict | None:
        """
        Score one candidate. Returns enriched candidate dict if relevant, None if not.
        """
        case_name = candidate.get("title", candidate.get("case_name", "Unknown"))

        full_text = self._get_text(candidate)
        if not full_text or len(full_text) < 200:
            logger.debug("[HOLDING_FILTER] Skipping %s — no text", case_name[:60])
            return None

        holding = self._extract_holding(full_text, case_name)
        if not holding:
            holding = full_text[-500:]

        score_result = self._score_holding(holding, candidate, controversy)
        if score_result is None:
            return None

        relevance_score = score_result.get("relevance_score", 0)
        include = score_result.get("include_in_report", False)

        logger.debug(
            "[HOLDING_FILTER] %s → %s | score=%.2f | include=%s",
            case_name[:60],
            score_result.get("relevance_verdict"),
            relevance_score,
            include,
        )

        if not include or relevance_score < self.min_score:
            return None

        # Enrich the candidate with filter results
        candidate = dict(candidate)  # shallow copy to avoid mutating original
        candidate["holding_text"] = holding
        candidate["holding_filter_score"] = relevance_score
        candidate["holding_filter_verdict"] = score_result.get("relevance_verdict")
        candidate["holding_filter_supports"] = score_result.get("supports")
        candidate["holding_summary"] = score_result.get("holding_summary", "")
        candidate["citation_value"] = score_result.get("citation_value", "")

        candidate.setdefault("citation_data", {}).update({
            "holding_text": holding,
            "holding_summary": score_result.get("holding_summary", ""),
            "applicability": (
                "direct"
                if score_result.get("relevance_verdict") == "DIRECTLY_RELEVANT"
                else "analogous"
            ),
            "supports": score_result.get("supports", "neutral"),
            "applicability_score": relevance_score,
            "relevance_tier": (
                "HIGH" if relevance_score >= 0.75
                else "MEDIUM" if relevance_score >= 0.55
                else "LOW"
            ),
            "relevance_reason": score_result.get("citation_value", ""),
        })

        return candidate

    def _get_text(self, candidate: dict) -> str:
        """Extract text from candidate — try multiple possible field names."""
        for field in ["raw_content", "text", "full_text", "judgment_text", "content", "raw_text", "doc_html"]:
            val = candidate.get(field)
            if val and isinstance(val, str) and len(val) > 100:
                clean = re.sub(r"<[^>]+>", " ", val)
                clean = re.sub(r"\s+", " ", clean).strip()
                return clean
        return ""

    def _extract_holding(self, full_text: str, case_name: str) -> str:
        """
        Extract holding paragraph from judgment text.
        Rule-based first, then last-20% heuristic, then Gemini as last resort.
        """
        # Rule-based: look for holding indicators
        holding_patterns = [
            r"(?:we hold|it is held|accordingly|in the result|for (?:the |these |foregoing )?reasons?|"
            r"we find|we are of the (?:view|opinion)|in (?:our )?view|the appeal (?:is|shall be)|"
            r"the petition (?:is|shall be)|the FIR (?:is|shall be) quashed).{100,800}",
        ]
        for pattern in holding_patterns:
            match = re.search(pattern, full_text, re.IGNORECASE | re.DOTALL)
            if match:
                start = match.start()
                holding_raw = full_text[max(0, start - 50): start + 600]
                if len(holding_raw) >= 100:
                    return holding_raw.strip()

        # Last 20% heuristic
        chunk = full_text[int(len(full_text) * 0.80):]
        if len(chunk) >= 100:
            return chunk[:800].strip()

        # Gemini extraction as last resort (only for long texts)
        if len(full_text) > 2000 and self._api_key:
            try:
                prompt = self._extraction_prompt.format(
                    judgment_text=full_text[-3000:]
                )
                result = self._call_gemini(prompt, max_tokens=self._extraction_max_tokens)
                if result and len(result) > 50:
                    return result.strip()
            except Exception as exc:
                logger.debug(
                    "[HOLDING_FILTER] Gemini holding extraction failed for %s: %s",
                    case_name[:60], exc,
                )

        return full_text[-400:].strip()

    def _score_holding(
        self,
        holding: str,
        candidate: dict,
        controversy: dict,
    ) -> dict | None:
        """Score the holding against the controversy using Gemini Flash."""
        if not self._api_key:
            # No API key — use a permissive default (pass seeds through)
            return {
                "relevance_verdict": "ANALOGOUS",
                "supports": "petitioner",
                "holding_summary": holding[:200],
                "citation_value": "Relevance scoring unavailable — GEMINI_API_KEY not set",
                "relevance_score": 0.60,
                "include_in_report": True,
            }

        prompt = self._scoring_prompt.format(
            dispute_type=controversy.get("dispute_type", "unknown"),
            key_legal_question=controversy.get("key_legal_question") or "Not specified",
            petitioner_position=controversy.get("petitioner_position") or "Not specified",
            respondent_position=controversy.get("respondent_position") or "Not specified",
            relief_sought=controversy.get("relief_sought") or "Not specified",
            applicable_statutes=", ".join(controversy.get("applicable_statutes") or []),
            case_name=candidate.get("title", candidate.get("case_name", "Unknown")),
            court_name=candidate.get("docsource", candidate.get("court", "Unknown")),
            year=candidate.get("year", "Unknown"),
            holding_text=holding[:600],
        )

        try:
            raw = self._call_gemini(prompt, max_tokens=self._scoring_max_tokens)
            if not raw:
                return None
            raw = re.sub(r"```(?:json)?", "", raw).strip().strip("`").strip()
            return json.loads(raw)
        except (json.JSONDecodeError, Exception) as exc:
            logger.warning(
                "[HOLDING_FILTER] Score parse failed for %s: %s",
                candidate.get("title", "unknown")[:60],
                exc,
            )
            return None

    def _call_gemini(self, prompt: str, max_tokens: int = 512) -> Optional[str]:
        """
        Call Gemini synchronously.
        Uses the same google-genai Client pattern as base_agent._gemini() and clerk._gemini_extract().
        """
        if not self._api_key:
            return None
        try:
            from google import genai
            client = genai.Client(api_key=self._api_key)
            resp = client.models.generate_content(
                model=self._model,
                contents=prompt,
                config=genai.types.GenerateContentConfig(
                    temperature=0.0,
                    max_output_tokens=max_tokens,
                ),
            )
            return resp.text or ""
        except Exception as exc:
            logger.warning("[HOLDING_FILTER] Gemini call failed: %s", exc)
            return None
