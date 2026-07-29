"""
ADK agent topology for the judgement-service search pipeline.

LlmAgents exist only where a model genuinely needs to reason:
  - classify + extract (the Agentic Document Context Service, Section 5)
  - issue_split (Stage 1)
  - keyword_extract (Stage 2, one call per issue)

Everything else — IK fetch, re-rank, scoring, precision layers, the
CitationGuardian, response assembly — is deterministic Python in tools.py.

Per the spec's ADK note: the number of issues is only known at runtime, so
fan-out cannot be a static ParallelAgent. `issue_fanout` below is the
custom async orchestrator that spins one per-issue pipeline per issue and
gathers them, sharing the IK client's rate-limit semaphore. The document
context stage, whose shape IS fixed, is a real ADK SequentialAgent.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from google.adk.agents import LlmAgent, SequentialAgent
from google.adk.runners import InMemoryRunner
from google.genai import types as genai_types

from claude_llm import (
    ISSUE_SPOTTER_SYSTEM,
    QUERY_GEN_SYSTEM,
    claude_available,
    claude_parse,
)
from config import get_settings
from schemas import (
    Candidate,
    CaseContext,
    CaseContextDraft,
    CitationAnalysis,
    DocClassification,
    Issue,
    IssueList,
    IssueResults,
    IssueSpotResult,
    JudgmentVerification,
    KeywordSet,
    ResultItem,
    ScoredResult,
    SearchResponse,
    SignalSet,
    SourcePage,
)
from stores import sessions
from tools import (
    attribute_issue_sources,
    authority_signal,
    band_for,
    citation_guardian,
    composite_score,
    court_rank,
    enforce_verifier_rules,
    fact_match_signal,
    find_pinpoint,
    good_law_signal,
    ik_client,
    judged_band,
    keyword_signal,
    party_perspective,
    rerank,
    statutory_shelf_patterns,
    verify_context_against_source,
)

logger = logging.getLogger(__name__)

_APP = "judgement-service"
MAX_ISSUES = 6
MAX_RESULTS_PER_ISSUE = 10
MAX_LLM_INPUT_CHARS = 30000


def _gen_config(temperature: float) -> genai_types.GenerateContentConfig:
    return genai_types.GenerateContentConfig(temperature=temperature)


# ─── Agentic Document Context Service (Section 5) ────────────────────────────

def build_classify_agent() -> LlmAgent:
    return LlmAgent(
        name="doc_classify",
        model=get_settings().gemini_model,
        description="Classifies the uploaded legal document type.",
        instruction=(
            "You are a legal document classifier for Indian legal practice. "
            "Read the document text provided by the user and classify it as one of: "
            "petition, judgment, brief, note, mixed.\n"
            "- petition: a plea/application filed before a court (writ, quash, bail, etc.)\n"
            "- judgment: a court's decision/order (has coram, holdings, disposal)\n"
            "- brief: a structured client/case brief prepared by counsel\n"
            "- note: an informal note, email or rough case description\n"
            "- mixed: combination (e.g. judgment plus lawyer's instruction)\n"
            "Return strict JSON matching the schema."
        ),
        generate_content_config=_gen_config(0.1),
        output_schema=DocClassification,
        output_key="doc_classification",
        disallow_transfer_to_parent=True,
        disallow_transfer_to_peers=True,
    )


def build_extract_agent() -> LlmAgent:
    return LlmAgent(
        name="context_extract",
        model=get_settings().gemini_model,
        description="Extracts structured case context from the document.",
        instruction=(
            "You are extracting structured case context from an Indian legal document "
            "for downstream precedent search. The document type is: {doc_classification}.\n\n"
            "Extract:\n"
            "- parties: who is who, as a list of {{role, name}} entries "
            "(roles like petitioner, respondent, applicant, State).\n"
            "- facts: the fact pattern, in the document's own framing where possible.\n"
            "- procedural_history: what has happened so far (FIR, orders, appeals).\n"
            "- relief_sought: the outcome the lawyer's client wants.\n"
            "- raw_case_summary: ONE clean prose paragraph combining the above.\n\n"
            "ANTI-INVENTION RULES (absolute):\n"
            "1. Use ONLY information present in the document. Never add facts, dates, "
            "party names, section numbers or statute names that are not in the text.\n"
            "2. If something is unknown, leave that field as an empty string — do NOT guess.\n"
            "3. Copy section numbers and statute names EXACTLY as written in the source.\n"
            "Return strict JSON matching the schema."
        ),
        generate_content_config=_gen_config(0.1),
        output_schema=CaseContextDraft,
        output_key="case_context_draft",
        disallow_transfer_to_parent=True,
        disallow_transfer_to_peers=True,
    )


def build_document_context_agent() -> SequentialAgent:
    """Fixed-shape stage → real ADK SequentialAgent: classify, then extract.
    Steps 4 (completeness) and 5 (anti-invention guard) are deterministic
    and run in code after this agent (verify_context_against_source)."""
    return SequentialAgent(
        name="document_context_agent",
        sub_agents=[build_classify_agent(), build_extract_agent()],
    )


# ─── Stage 1: Issue split ────────────────────────────────────────────────────

def build_issue_split_agent() -> LlmAgent:
    return LlmAgent(
        name="issue_split",
        model=get_settings().gemini_model,
        description="Splits a case summary into distinct legal issues.",
        instruction=(
            "You are an expert Indian litigator. Split the case summary provided by "
            "the user into its DISTINCT legal issues for precedent research.\n\n"
            "An issue counts as separate ONLY if it is governed by a different area or "
            "body of law (e.g. repeal/savings law vs. quashing jurisprudence vs. "
            "directors' cheque liability). Do NOT split rephrasings of the same legal "
            "question into multiple issues, and do NOT merge genuinely distinct bodies "
            "of law into one vague issue. A simple single-question case yields exactly "
            "one issue.\n\n"
            "Frame each issue as a court would: 'Whether ...'. Each issue must be "
            "SELF-CONTAINED — downstream precedent search sees ONLY the issue text, so "
            "name the governing provision and the decisive facts inside it wherever the "
            "summary provides them (e.g. 'Whether the FIR under Section 306 IPC is "
            "liable to be quashed when the suicide note does not name the accused', "
            "not 'Whether the FIR should be quashed'). Never add a provision the "
            "summary does not support. Order issues by importance to the client's "
            "relief. Number ids from 1. Return strict JSON matching the schema."
        ),
        generate_content_config=_gen_config(0.25),
        output_schema=IssueList,
        output_key="issues",
        disallow_transfer_to_parent=True,
        disallow_transfer_to_peers=True,
    )


# ─── Stage 2: Keyword extraction (four axes) ─────────────────────────────────

def build_keyword_extract_agent() -> LlmAgent:
    return LlmAgent(
        name="keyword_extract",
        model=get_settings().gemini_model,
        description="Generates anchor queries + four-axis search terms for one legal issue.",
        instruction=(
            "You are an expert Indian legal-research librarian building Indian Kanoon "
            "queries for ONE legal issue in live litigation. A lawyer will cite what "
            "these queries find to a court, so precision matters more than volume.\n\n"
            "INDIAN KANOON SEARCH BEHAVIOUR:\n"
            "- Space-separated words must ALL appear somewhere in the document (AND).\n"
            "- \"Double-quoted phrases\" must appear verbatim — use quotes for section "
            "references and settled doctrinal formulae.\n\n"
            "PRODUCE:\n"
            "1. anchor_queries (2–4): complete, high-precision queries a senior advocate "
            "would type — each MUST combine a statutory hook with the doctrinal concept, "
            "optionally plus ONE distinctive fact word. Examples:\n"
            "   '\"Section 482\" quashing matrimonial dispute'\n"
            "   '\"Section 138\" \"Negotiable Instruments\" director vicarious liability'\n"
            "   '\"Section 34\" IPC common intention murder'\n"
            "These are the queries that find the leading line of cases on the issue.\n"
            "2. 12–16 single terms across four DISTINCT axes:\n"
            "- doctrinal: doctrines/tests/principles (e.g. 'inherent powers to quash', "
            "'abuse of process of law', 'parity in bail')\n"
            "- statutory: specific sections + statutes (e.g. 'Section 482 CrPC', "
            "'Section 6 General Clauses Act')\n"
            "- factual: fact-pattern phrases a judgment would contain (e.g. "
            "'civil dispute given criminal colour')\n"
            "- outcome: disposal language (e.g. 'FIR quashed', 'proceedings set aside')\n\n"
            "RULES:\n"
            "1. NEVER fabricate a section number or statute name, and never attach a "
            "section to the wrong statute ('Section 138 IPC' is wrong — it is "
            "'Section 138 NI Act'). Use ONLY provisions given in, or necessarily implied "
            "by, the issue and case summary.\n"
            "2. NEW-CODE MAPPING (critical): almost all precedent predates the 2023 "
            "codes. If the issue cites BNS / BNSS / BSA provisions, ALSO search the "
            "equivalent IPC / CrPC / Evidence Act provisions (e.g. Section 103 BNS ↔ "
            "Section 302 IPC; Section 528 BNSS ↔ Section 482 CrPC; Section 85 BNS ↔ "
            "Section 498A IPC), and keep the new-code term too. Map only equivalences "
            "you are certain of — when unsure, keep the statute name WITHOUT inventing "
            "a section number.\n"
            "3. NO morphological near-duplicates of one phrase ('X law', 'X act', "
            "'X section' are one term, not three) — a lexical engine treats those as "
            "noise, not as distinct angles.\n"
            "4. Each axis term must be a realistic search string a lawyer would type, "
            "2–7 words. Do not put quotes inside axis terms (the system adds them); "
            "quotes are allowed ONLY inside anchor_queries.\n"
            "5. Factual terms must come from THIS case's distinctive facts, not "
            "generic filler like 'criminal case' or 'court proceedings'.\n"
            "Return strict JSON matching the schema."
        ),
        generate_content_config=_gen_config(0.25),
        output_schema=KeywordSet,
        output_key="keywords",
        disallow_transfer_to_parent=True,
        disallow_transfer_to_peers=True,
    )


# ─── Judgment verifier (PROMPT 3 — one judgment vs one issue) ────────────────

# Single source of truth for the verifier prompt — used verbatim by BOTH
# the Claude verifier (primary) and the Gemini agent (fallback).
JUDGMENT_VERIFIER_SYSTEM = (
            "You are a legal judgment verifier for Indian litigation. Input: ONE "
            "issue object (issue, doctrine, statutory hook, procedural stage, "
            "perspective) and the text of ONE fetched judgment (Indian Kanoon). "
            "Decide whether this judgment is USABLE for this issue. Output strict "
            "JSON matching the schema.\n\n"
            "CHECKS — run in this order; if a KILL check fails, stop and output "
            "verdict 'reject' with a one-line reject_reason:\n"
            "1. OUTCOME (KILL). Read the FINAL paragraphs first. Classify: "
            "relief_granted | relief_refused | partly | interim_only | unclear. Copy "
            "outcome_evidence as the VERBATIM operative line — it is machine-verified "
            "as an exact substring of the judgment, so NEVER paraphrase. Never infer "
            "the outcome from the headnote or the arguments section — only from the "
            "court's own operative words. unclear → reject.\n"
            "2. SHELF (KILL). The judgment's governing doctrine and statute must "
            "match the issue's doctrine/statutory hook BY NAME — the provision "
            "number or term of art must ACTUALLY APPEAR in this judgment's text; "
            "doctrine_link must point to it, never to your outside knowledge. "
            "Overlap of generic words (maintainable, mandatory, non-compliance, "
            "liable, fraud) across different fields of law = different shelf = "
            "reject. Transactional vocabulary is NOT law: a stamp-duty/revenue "
            "case and a civil-procedure case may both speak of deposits, "
            "withdrawal, interest and security — if the FIELD OF LAW differs from "
            "the issue's, reject however similar the money-words look. State the "
            "doctrinal link in ONE line in doctrine_link; if you cannot name it "
            "from this judgment's own text, reject.\n"
            "3. STAGE. Same procedural stage as the issue (quashing↔quashing, "
            "leave-to-defend↔leave-to-defend, trial↔trial). A different stage sets "
            "stage_match=false and lowers the score — reject only if the standard "
            "of review makes the judgment inapposite.\n"
            "4. RATIO. Locate the paragraph(s) where the court STATES THE PRINCIPLE "
            "('we are of the view', 'it is well settled', numbered principles). "
            "Record ratio_para (e.g. 'para 14') and a one-sentence ratio_summary in "
            "your own words. A fact-recital or arguments paragraph is NOT ratio. If "
            "no ratio is locatable (bare disposal order), set both to null — the "
            "score is capped at 30.\n"
            "5. SIDE. Compare the verified outcome with the issue's perspective: "
            "outcome supporting that side → 'support'; opposite → 'contra' (still "
            "valuable — the opponent will cite it); interim_only → 'interim'. The "
            "query that found the judgment is irrelevant; ONLY the verified outcome "
            "decides the side.\n"
            "6. DISTINGUISH RISK. Facts need not match the client's case — doctrine "
            "must. Note in one line the likely distinguishing fact the opponent may "
            "raise (distinguish_risk), else null.\n"
            "7. ADVERSARIAL PREP. opponent_argument: the STRONGEST objection opposing "
            "counsel will raise against citing this judgment for this issue — apply "
            "the bindingness rules: a Supreme Court judgment binds all courts "
            "(Article 141); a judgment of the SAME High Court as CLIENT'S FORUM is "
            "binding (note Division Bench > Single Judge); a judgment of a DIFFERENT "
            "High Court or a lower forum has persuasive value only. Also consider "
            "distinguishable facts and anything in the text that weakens it. "
            "counter_strategy: 1–2 sentences on how counsel should MEET that "
            "objection (e.g. 'persuasive but consistent with the Supreme Court's "
            "settled test — pair it with a binding authority from the client's own "
            "High Court in this result set', or 'emphasise the identical ratio; the "
            "factual difference does not touch the principle'). Never invent a case "
            "name that does not appear in the provided text. If CLIENT'S FORUM is "
            "not specified, frame the objection generically ('if the matter is "
            "outside this High Court, this is persuasive only').\n\n"
            "SCORING (0–100): doctrine match 40, stage match 20, ratio located 20, "
            "forum/recency 20. Shelf-fail or outcome-unclear = reject regardless of "
            "the other points.\n\n"
            "RULES:\n"
            "- Ground every field in the judgment text. Quote, don't paraphrase, "
            "for outcome_evidence. Never invent a paragraph number or citation — "
            "unknown → null.\n"
            "- Judgments may mix English with Hindi/Marathi — always answer in "
            "English.\n"
            "- Court name, bench and date are recorded by the system from metadata; "
            "do not guess them."
)


def build_judgment_verifier_agent() -> LlmAgent:
    return LlmAgent(
        name="judgment_verifier",
        model=get_settings().gemini_model,
        description="Verifies whether ONE fetched judgment is usable for ONE issue.",
        instruction=JUDGMENT_VERIFIER_SYSTEM,
        generate_content_config=_gen_config(0.1),
        output_schema=JudgmentVerification,
        output_key="judgment_verification",
        disallow_transfer_to_parent=True,
        disallow_transfer_to_peers=True,
    )


_VERIFIER_CONCURRENCY = 6
_VERIFIER_DOC_BUDGET = 22000  # chars of judgment text per verification call


async def verify_judgments(issue: Issue, context: CaseContext,
                           candidates: list[Candidate],
                           keywords: KeywordSet) -> dict[str, JudgmentVerification]:
    """PROMPT-3 verification: one grounded call PER fetched judgment, run
    concurrently, then deterministic rule enforcement (evidence substring,
    shelf/ratio caps, side re-derived from the verified outcome). Failed
    docs are simply unverified; {} on total failure — the pipeline degrades
    to embedding-only ranking, never breaks."""
    judged = [c for c in candidates if c.doc_text]
    if not judged:
        return {}
    issue_block = (
        f"ISSUE: {issue.issue}\n"
        f"DOCTRINE: {issue.doctrine or 'not specified'}\n"
        f"STATUTORY HOOK: {issue.statutory_hook or 'not specified'}\n"
        f"PROCEDURAL STAGE: {context.procedural_stage or 'not specified'}\n"
        f"CLIENT'S FORUM: {context.forum or 'not specified'}\n"
        f"PERSPECTIVE: {issue.perspective or 'petitioner'}\n\n"
    )
    # Deterministic shelf anchors: the judgment must mention at least one of
    # the issue's statutory provisions (old/new-code equivalents included).
    shelf_patterns = statutory_shelf_patterns(issue.statutory_hook, keywords.statutory)
    semaphore = asyncio.Semaphore(_VERIFIER_CONCURRENCY)

    async def _verify_one(cand: Candidate) -> tuple[str, JudgmentVerification | None]:
        text = cand.doc_text or ""
        if len(text) > _VERIFIER_DOC_BUDGET:
            # keep the tail intact — the operative order lives there
            text = (text[:_VERIFIER_DOC_BUDGET - 9000]
                    + "\n[... middle of judgment omitted ...]\n" + text[-9000:])
        pinpoint, _ref = find_pinpoint(cand, issue.issue, keywords)
        message = (
            issue_block
            + f"JUDGMENT: {cand.title} ({cand.court}, {cand.year or 'year n/a'})\n"
            + (f"MOST RELEVANT PASSAGE (lexical match): {pinpoint[:600]}\n\n" if pinpoint else "\n")
            + f"JUDGMENT TEXT:\n{text}"
        )
        settings = get_settings()
        verdict: JudgmentVerification | None = None
        async with semaphore:
            # Claude first (sharper on shelf/field-of-law distinctions than
            # flash); Gemini agent is the automatic fallback.
            if settings.verifier_use_claude and claude_available():
                verdict = await claude_parse(
                    JUDGMENT_VERIFIER_SYSTEM, message, JudgmentVerification,
                    max_tokens=3000, model=settings.judgement_verifier_claude_model)
            if verdict is None:
                try:
                    out = await run_agent_once(build_judgment_verifier_agent(), message,
                                               ["judgment_verification"])
                    verdict = JudgmentVerification.model_validate(
                        out.get("judgment_verification") or {})
                except Exception:
                    logger.exception("[verifier] doc %s failed for issue %s",
                                     cand.doc_id, issue.id)
                    return cand.doc_id, None
        return cand.doc_id, enforce_verifier_rules(verdict, cand.doc_text,
                                                   issue.perspective, shelf_patterns)

    results = await asyncio.gather(*(_verify_one(c) for c in judged))
    return {doc_id: v for doc_id, v in results if v is not None}


# ─── Per-citation report analysis ────────────────────────────────────────────

def build_citation_analysis_agent() -> LlmAgent:
    return LlmAgent(
        name="citation_analysis",
        model=get_settings().gemini_model,
        description="Drafts a grounded legal-intelligence report for one judgment.",
        instruction=(
            "You are preparing a citation report for an Indian lawyer, analysing ONE "
            "judgment against ONE legal issue from their case.\n\n"
            "Produce:\n"
            "- why_this_helps: 1–2 sentences on why this judgment addresses the issue.\n"
            "- key_legal_issues: the legal questions the JUDGMENT itself dealt with.\n"
            "- key_facts: the judgment's key facts (short bullets).\n"
            "- legal_analysis: what the court held/reasoned, incl. how it applied "
            "earlier authorities, as short bullets.\n"
            "- ratio_decidendi: the binding principle of the judgment, 1–3 sentences.\n\n"
            "GROUNDING RULES (absolute):\n"
            "1. Use ONLY the judgment text provided by the user. Never add case names, "
            "citations, section numbers, dates or facts that are not in that text.\n"
            "2. If the text does not support a field, leave it empty rather than guess.\n"
            "3. Do NOT assess how strong the match is — relevance scores are computed "
            "separately; write analysis, not scores.\n"
            "Return strict JSON matching the schema."
        ),
        generate_content_config=_gen_config(0.15),
        output_schema=CitationAnalysis,
        output_key="citation_analysis",
        disallow_transfer_to_parent=True,
        disallow_transfer_to_peers=True,
    )


async def generate_citation_analysis(issue_text: str, case_summary: str,
                                     title: str, doc_text: str) -> CitationAnalysis:
    message = (
        f"CLIENT'S LEGAL ISSUE:\n{issue_text}\n\n"
        f"CLIENT'S CASE (context only):\n{case_summary[:2000]}\n\n"
        f"JUDGMENT TITLE: {title}\n\n"
        f"JUDGMENT TEXT:\n{doc_text[:24000]}"
    )
    out = await run_agent_once(build_citation_analysis_agent(), message, ["citation_analysis"])
    return CitationAnalysis.model_validate(out.get("citation_analysis") or {})


# ─── Runner helper ────────────────────────────────────────────────────────────

async def run_agent_once(agent, message: str, output_keys: list[str]) -> dict[str, Any]:
    """Run one ADK agent (or SequentialAgent) in a fresh in-memory session
    and return the requested session-state outputs (written via output_key)."""
    runner = InMemoryRunner(agent=agent, app_name=_APP)
    session = await runner.session_service.create_session(app_name=_APP, user_id="pipeline")
    content = genai_types.Content(role="user", parts=[genai_types.Part(text=message[:MAX_LLM_INPUT_CHARS])])
    async for _event in runner.run_async(user_id="pipeline", session_id=session.id, new_message=content):
        pass
    session = await runner.session_service.get_session(
        app_name=_APP, user_id="pipeline", session_id=session.id)
    state = session.state if session else {}
    return {key: state.get(key) for key in output_keys}


# ─── Claude stages: issue spotting + query generation ───────────────────────

async def spot_issues(raw_text: str, context: CaseContext) -> list[Issue]:
    """Stage 1 on Claude (spec issue-spotter prompt): procedural stage first,
    then stage-framed issues with doctrine + statutory hook + perspective.
    Falls back to the Gemini issue-split agent when Claude is unavailable."""
    if claude_available():
        user = (
            f"CASE MATERIAL:\n{raw_text[:MAX_LLM_INPUT_CHARS - 4000]}\n\n"
            f"STRUCTURED CONTEXT (already extracted and source-verified):\n"
            f"Facts: {context.facts[:1500]}\n"
            f"Procedural history: {context.procedural_history[:800]}\n"
            f"Relief sought: {context.relief_sought[:300]}"
        )
        result = await claude_parse(ISSUE_SPOTTER_SYSTEM, user, IssueSpotResult)
        if result is not None:
            context.procedural_stage = result.procedural_stage.strip() or None
            context.forum = result.forum.strip() or None
            if result.insufficient_material:
                context.needs_clarification = True
                context.clarification_question = (
                    "The material is formal-only (index/vakalatnama/cover pages) — "
                    "no legal issue can be researched from it. Please describe what "
                    "happened, under which provision, and what relief you seek.")
                return []
            return [
                Issue(id=idx + 1, issue=s.issue.strip(),
                      title=s.title.strip() or None,
                      explanation=s.explanation.strip() or None,
                      doctrine=s.doctrine.strip() or None,
                      statutory_hook=(s.statutory_hook or "").strip() or None,
                      perspective=s.perspective.strip() or None)
                for idx, s in enumerate(result.issues[:MAX_ISSUES]) if s.issue.strip()
            ]
        logger.warning("[claude] issue spotter unavailable — Gemini issue split fallback")
    out = await run_agent_once(build_issue_split_agent(), context.raw_case_summary, ["issues"])
    issue_list = IssueList.model_validate(out.get("issues") or {"issues": []})
    return issue_list.issues[:MAX_ISSUES]


async def generate_queries(issue: Issue, context: CaseContext,
                           failed_queries: list[str] | None = None,
                           sibling_issues: list[str] | None = None) -> KeywordSet:
    """Stage 2 on Claude (spec query-gen prompt): support anchors + contra
    queries + four lexical axes, built from doctrine + statutory hook +
    stage — never from party facts. Gemini keyword agent as fallback.

    failed_queries: reformulation mode — the previous round's queries found
    no usable judgment, so the model must produce a genuinely DIFFERENT set
    (broader doctrine phrasing, alternate statutory citation forms, fewer
    restrictive quoted phrases)."""
    retry_note = ""
    if failed_queries:
        tried = "\n".join(f"- {q}" for q in failed_queries[:24])
        retry_note = (
            "\n\nREFORMULATION REQUIRED — a previous attempt with the queries below "
            "found NO usable judgment. Produce a genuinely DIFFERENT set:\n"
            "- broaden the doctrinal phrasing (synonyms, the classic test's own words);\n"
            "- use alternate statutory citation forms ('482 Cr.P.C.', 'Section 482 of "
            "the Code', bare section number + Act keyword);\n"
            "- use FEWER and SHORTER quoted phrases (exact quotes were likely too "
            "restrictive);\n"
            "- drop fact-specific words that returned nothing; go up one level of "
            "generality on the doctrine while keeping the statutory hook.\n"
            f"DO NOT repeat any of these failed queries:\n{tried}"
        )
    siblings_note = ""
    if sibling_issues:
        listed = "\n".join(f"- {s}" for s in sibling_issues[:5])
        siblings_note = (f"\n\nOTHER ISSUES IN THIS CASE (searched separately — keep THIS "
                         f"issue's queries clearly distinct from theirs):\n{listed}")
    if claude_available():
        user = (
            f"ISSUE: {issue.issue}\n"
            f"TITLE: {issue.title or 'not specified'}\n"
            f"DOCTRINE: {issue.doctrine or 'not specified'}\n"
            f"STATUTORY HOOK: {issue.statutory_hook or 'not specified'}\n"
            f"PERSPECTIVE: {issue.perspective or 'neutral'}\n"
            f"PROCEDURAL STAGE: {context.procedural_stage or 'not specified'}\n\n"
            f"CASE SUMMARY (context only — never build queries from party facts):\n"
            f"{context.raw_case_summary[:1500]}"
            f"{siblings_note}"
            f"{retry_note}"
        )
        result = await claude_parse(QUERY_GEN_SYSTEM, user, KeywordSet, max_tokens=4000)
        if result is not None and result.all_terms():
            return result
        logger.warning("[claude] query generation unavailable — Gemini keyword fallback")
    keyword_message = (
        f"Case summary (context only):\n{context.raw_case_summary}\n\n"
        f"Legal issue to generate search terms for:\n{issue.issue}"
        f"{retry_note}"
    )
    out = await run_agent_once(build_keyword_extract_agent(), keyword_message, ["keywords"])
    return KeywordSet.model_validate(out.get("keywords") or {})


# ─── Per-issue pipeline (Stage 2 → fetch → rerank → layers → score) ──────────

async def _issue_round(issue: Issue, context: CaseContext, keywords: KeywordSet,
                       exclude: set[str] | None = None) -> dict[str, Any]:
    """One complete fetch → rerank → verify → score round for one issue.
    Returns {candidates, scored}; the caller decides whether to retry with
    reformulated queries when nothing usable survives."""
    settings = get_settings()

    # IK fetch — union across anchor/contra/axis queries, dedupe, cap.
    pool = await ik_client.fanout_and_fetch(keywords, exclude=exclude)
    if not pool:
        return {"candidates": {}, "scored": []}

    # Re-rank THIS issue's pool against THIS issue's text only.
    semantic = await rerank(issue.issue, pool)
    pool.sort(key=lambda c: semantic.get(c.doc_id, 0.0), reverse=True)

    # Fetch full text for the top N only (each /doc call is billed) —
    # needed for the relevance judge, party perspective, good-law markers,
    # pinpoints, and pinpoint verification by the guardian.
    top = pool[:settings.ik_full_doc_top_n]
    texts = await asyncio.gather(*(ik_client.fetch_doc_text(c.doc_id) for c in top))
    for cand, text in zip(top, texts):
        cand.doc_text = text

    # PROMPT-3 verification: is each fetched judgment USABLE for this issue?
    # Verified score blends into the semantic signal (and therefore bands);
    # KILL-check rejects go straight to RED; the verified outcome — never
    # the query role — decides support/contra. Verifier failure degrades to
    # embedding-only ranking.
    verifications: dict[str, JudgmentVerification] = {}
    if settings.relevance_judge_enabled and settings.relevance_judge_weight > 0:
        verifications = await verify_judgments(issue, context, top, keywords)

    weights = settings.phase_weights
    judge_w = settings.relevance_judge_weight
    scored: list[ScoredResult] = []
    for cand in pool:
        sem = semantic.get(cand.doc_id, 0.0)
        verdict = verifications.get(cand.doc_id)
        ai, side, rejected = None, None, False
        if verdict is not None:
            ai = max(0.0, min(1.0, verdict.score / 100.0))
            sem = min(1.0, (1 - judge_w) * sem + judge_w * ai)
            rejected = verdict.verdict == "reject"
            side = verdict.verdict if verdict.verdict in ("support", "contra", "interim") else None
        auth_value, court_label = authority_signal(cand)
        party_value, party_label = party_perspective(cand, context)
        # The VERIFIED outcome overrides the regex party heuristic.
        if side == "support":
            party_value, party_label = 1.0, "favourable"
        elif side == "contra":
            party_value, party_label = 0.0, "adverse"
        elif side == "interim":
            party_value, party_label = 0.5, "neutral"
        gl_value, gl_label = good_law_signal(cand)
        signals = SignalSet(
            semantic_match=round(sem, 4),
            keyword_match=keyword_signal(cand, keywords),
            ai_relevance=ai,
            authority=auth_value,
            good_law_status=gl_value,
            good_law_status_label=gl_label,
            party_fit=party_value,
            party_fit_label=party_label,
            fact_match=fact_match_signal(cand, context),
        )
        result = composite_score(signals, weights)
        result.doc_id = cand.doc_id
        # KILL checks (outcome unclear / wrong shelf) are a hard RED gate.
        result.band = "RED" if rejected else judged_band(band_for(sem), ai, bool(verifications))
        result.side = side
        if verdict is not None and not rejected:
            result.outcome_evidence = verdict.outcome_evidence or None
            result.doctrine_link = verdict.doctrine_link or None
            result.distinguish_risk = verdict.distinguish_risk
            result.opponent_argument = verdict.opponent_argument or None
            result.counter_strategy = verdict.counter_strategy or None
        if cand.doc_text and result.band in ("GREEN", "YELLOW"):
            result.pinpoint, result.pinpoint_ref = find_pinpoint(cand, issue.issue, keywords)
        scored.append(result)

    # Surface ONLY judgments verified relevant. When the judge ran, a result
    # must have been read and passed (ai_relevance present, band survived the
    # RED gate) — similarity-only candidates are never shown, and an empty
    # list is the honest answer over off-point filler. The unverified
    # GREEN/YELLOW (and last-resort RED) paths exist only for degraded mode,
    # where no judgment text could be verified at all. Red-flagged
    # (overruled) results sink to the bottom regardless of score.
    surfaced = [r for r in scored if r.band in ("GREEN", "YELLOW")]
    if verifications:
        surfaced = [r for r in surfaced if r.breakdown.ai_relevance is not None]
    elif not surfaced:
        surfaced = sorted(scored, key=lambda r: r.score, reverse=True)[:MAX_RESULTS_PER_ISSUE]
    # Support (petitioner-side) authorities lead; within a side, bench-wise
    # (Supreme Court → High Courts → tribunals → district), top score first.
    # Contra follow clearly labelled; red-flagged (overruled) sink last.
    side_rank = {"support": 0, None: 1, "interim": 2, "contra": 3}
    court_by_id = {c.doc_id: c.court for c in pool}
    surfaced.sort(key=lambda r: (r.red_flag, side_rank.get(r.side, 1),
                                 court_rank(court_by_id.get(r.doc_id, "")), -r.score))
    surfaced = surfaced[:MAX_RESULTS_PER_ISSUE]

    return {
        "candidates": {c.doc_id: c for c in pool},
        "scored": surfaced,
    }


async def _process_issue(issue: Issue, context: CaseContext,
                         pre_keywords: KeywordSet | None = None) -> dict[str, Any]:
    """Per-issue pipeline with automatic query reformulation: if the first
    round yields NO usable judgment for this issue, a genuinely different
    query set is generated (for this issue only) and one more round runs —
    already-fetched documents are excluded, so only fresh candidates are
    read. Still empty after the retry → honest empty list."""
    # Stage 2 — query generation (already done at analyze time for suggested
    # issues; generated live for custom/user-typed ones).
    keywords = pre_keywords if pre_keywords and pre_keywords.all_terms() \
        else await generate_queries(issue, context)
    if not keywords.all_terms():
        logger.warning("[pipeline] issue %s produced no keywords — skipping fetch", issue.id)
        return {"issue": issue, "keywords": keywords, "candidates": {}, "scored": []}

    round1 = await _issue_round(issue, context, keywords)
    if round1["scored"]:
        return {"issue": issue, "keywords": keywords, **round1}

    # No usable judgment — reformulate ONCE for this issue and fetch fresh.
    tried = list(keywords.anchor_queries) + list(keywords.contra_queries) + keywords.all_terms()
    logger.info("[pipeline] issue %s: no usable judgment — reformulating queries and retrying",
                issue.id)
    retry_keywords = await generate_queries(issue, context, failed_queries=tried)
    if not retry_keywords.all_terms():
        return {"issue": issue, "keywords": keywords, **round1}
    round2 = await _issue_round(issue, context, retry_keywords,
                                exclude=set(round1["candidates"].keys()))
    return {
        "issue": issue,
        "keywords": retry_keywords,
        # Closed world: the guardian pool carries BOTH rounds' fetches.
        "candidates": {**round1["candidates"], **round2["candidates"]},
        "scored": round2["scored"],
    }


async def issue_fanout(issues: list[Issue], context: CaseContext,
                       keywords_map: dict[str, KeywordSet] | None = None,
                       ) -> list[dict[str, Any]]:
    """Dynamic-cardinality fan-out: one per-issue pipeline per issue, run
    concurrently. IK rate limiting is enforced inside the shared client
    semaphore, not here. One issue failing never kills the request."""
    keywords_map = keywords_map or {}

    async def _safe(issue: Issue) -> dict[str, Any]:
        try:
            return await _process_issue(issue, context, keywords_map.get(str(issue.id)))
        except Exception:
            logger.exception("[pipeline] issue %s failed", issue.id)
            return {"issue": issue, "keywords": None, "candidates": {}, "scored": []}

    return list(await asyncio.gather(*(_safe(i) for i in issues[:MAX_ISSUES])))


# ─── Response assembly (deterministic) ───────────────────────────────────────

def _chips(cand: Candidate, result: ScoredResult, court_label: str) -> list[str]:
    chips = [court_label]
    if cand.num_citedby > 0:
        chips.append(f"cited {cand.num_citedby} times")
    label = result.breakdown.good_law_status_label
    if label == "overruled":
        chips.append("overruled — do not rely")
    elif label == "review":
        chips.append("review before relying")
    elif label == "valid":
        chips.append("still good law")
    if result.side == "support":
        chips.append("supports your case")
    elif result.side == "contra":
        chips.append("contra authority — relief refused")
    elif result.side == "interim":
        chips.append("interim order only")
    elif result.breakdown.party_fit_label:
        chips.append(result.breakdown.party_fit_label)
    ai = result.breakdown.ai_relevance
    if ai is not None:
        # The judge read the judgment — its verdict IS the on-point figure.
        chips.append(f"{round(ai * 100)}% on point")
        if ai >= 0.75:
            chips.append("verified on point")
    else:
        # Never present raw text similarity as an on-point claim.
        chips.append(f"similarity {round(result.breakdown.semantic_match * 100)}% — unverified")
    if result.band == "YELLOW":
        chips.append("moderate confidence")
    return chips


def _signals_payload(result: ScoredResult) -> dict[str, Any]:
    """Signal-agnostic explainability payload: only signals that exist
    appear; consumers render one chip per key. New layers = new keys,
    never an API change."""
    b = result.breakdown
    payload: dict[str, Any] = {
        "semantic": b.semantic_match,
        "keyword": b.keyword_match,
    }
    if b.ai_relevance is not None:
        payload["aiRelevance"] = b.ai_relevance
    if b.authority is not None:
        payload["authority"] = b.authority
    if b.good_law_status_label is not None:
        payload["goodLaw"] = b.good_law_status_label
    if b.party_fit_label is not None:
        payload["party"] = b.party_fit_label
    if b.fact_match is not None:
        payload["factMatch"] = b.fact_match
    return payload


def assemble_response(
    session_id: str,
    context: CaseContext,
    fanout_results: list[dict[str, Any]],
) -> SearchResponse:
    """Runs the CitationGuardian (always — no bypass), then builds the
    Section 11 response and persists the session for /refine."""
    issues_out: list[IssueResults] = []
    total_drops = 0
    session_issues: list[dict[str, Any]] = []

    for entry in fanout_results:
        issue: Issue = entry["issue"]
        candidates: dict[str, Candidate] = entry["candidates"]
        scored: list[ScoredResult] = entry["scored"]

        clean, drops = citation_guardian.verify(scored, candidates)
        total_drops += len(drops)

        items: list[ResultItem] = []
        for result in clean:
            cand = candidates[result.doc_id]
            _, court_label = authority_signal(cand)
            pin = None
            if result.pinpoint:
                pin = f"{result.pinpoint_ref}: {result.pinpoint}" if result.pinpoint_ref else result.pinpoint
            items.append(ResultItem(
                docId=result.doc_id,
                title=cand.title,
                court=cand.court,
                year=cand.year,
                band=result.band,
                score=result.score,
                redFlag=result.red_flag,
                pinpoint=pin,
                url=cand.source_url,
                headline=cand.headline,
                matchedTerms=list(cand.matched_terms),
                side=result.side,
                outcomeEvidence=result.outcome_evidence,
                doctrineLink=result.doctrine_link,
                distinguishRisk=result.distinguish_risk,
                opponentArgument=result.opponent_argument,
                counterStrategy=result.counter_strategy,
                signals=_signals_payload(result),
                chips=_chips(cand, result, court_label),
            ))
        keywords = entry.get("keywords")
        issues_out.append(IssueResults(id=issue.id, issue=issue.issue,
                                       title=issue.title,
                                       keywords=keywords, results=items))
        session_issues.append({
            "id": issue.id,
            "issue": issue.issue,
            "title": issue.title,
            "keywords": keywords.model_dump() if keywords else None,
            "results": [item.model_dump() for item in items],
            "candidateMeta": {
                doc_id: {"title": c.title, "headline": c.headline,
                         "court": c.court, "year": c.year, "numCitedby": c.num_citedby}
                for doc_id, c in candidates.items()
            },
        })

    response = SearchResponse(
        sessionId=session_id,
        needsClarification=context.needs_clarification,
        clarificationQuestion=context.clarification_question,
        caseContext=context,
        issues=issues_out,
        guardianDropped=total_drops,
    )
    existing = sessions.load(session_id) or {}
    existing.update({
        "caseContext": context.model_dump(),
        "issues": session_issues,
    })
    sessions.save(session_id, existing)
    return response


# ─── Root pipeline ────────────────────────────────────────────────────────────

async def analyze_case(raw_text: str, source_text: str | None = None,
                       pages: list[SourcePage] | None = None,
                       ) -> tuple[str, CaseContext, list[Issue]]:
    """Phase 1: Agentic Document Context Service (classify → extract via ADK
    SequentialAgent, then deterministic completeness + anti-invention guard)
    followed by Stage 1 issue split. No Indian Kanoon spend happens here.
    The analysis is persisted to the session so /search/run can pick it up.
    """
    source = source_text or raw_text
    session_id = sessions.new_session_id()

    out = await run_agent_once(
        build_document_context_agent(), raw_text,
        ["doc_classification", "case_context_draft"],
    )
    classification = DocClassification.model_validate(
        out.get("doc_classification") or {"document_type": "mixed"})
    draft = CaseContextDraft.model_validate(out.get("case_context_draft") or {})
    context = verify_context_against_source(draft, source, classification.document_type)

    issues: list[Issue] = []
    issue_keywords: dict[str, Any] = {}
    # Ambiguous input → ask, never guess (Phase D hook, live now).
    if not context.needs_clarification:
        # Stage 1 on Claude (issue-spotter prompt; Gemini fallback inside).
        issues = await spot_issues(raw_text, context)
        if pages:
            # Deterministic 'file, page N' attribution — never LLM-written.
            attribute_issue_sources(issues, pages)
        if not issues and not context.needs_clarification:
            logger.warning("[pipeline] issue spotting returned no issues")
            context.needs_clarification = True
            context.clarification_question = (
                "No distinct legal issue could be identified. Please describe "
                "the legal question you want precedents for.")
        if issues:
            # Stage 2 up-front: the UI shows each issue's IK queries under its
            # title, and /search/run reuses them — generated exactly once.
            # Sibling titles ride along so no two issues share boilerplate queries.
            def _siblings(current: Issue) -> list[str]:
                return [f"Issue {j.id}: {j.title or j.issue[:70]}"
                        for j in issues if j.id != current.id]
            keyword_sets = await asyncio.gather(
                *(generate_queries(i, context, sibling_issues=_siblings(i)) for i in issues))
            for issue_obj, kw in zip(issues, keyword_sets):
                # Card shows the 4 support queries (matching the lawyer-facing
                # format); contra queries still run in the search itself.
                issue_obj.queries = list(kw.anchor_queries)
                issue_keywords[str(issue_obj.id)] = kw.model_dump()

    sessions.save(session_id, {
        "caseContext": context.model_dump(),
        "suggestedIssues": [i.model_dump() for i in issues],
        "issueKeywords": issue_keywords,
        "issues": [],
    })
    return session_id, context, issues


async def run_issue_search(session_id: str, context: CaseContext,
                           issues: list[Issue]) -> SearchResponse:
    """Phase 2: per-issue fan-out (Stage 2 → fetch → rerank → layers →
    score), then CitationGuardian + assembler — deterministic, always on,
    no bypass. Keywords generated at analyze time are reused here."""
    keywords_map: dict[str, KeywordSet] = {}
    session = sessions.load(session_id) or {}
    for issue_id, dump in (session.get("issueKeywords") or {}).items():
        try:
            keywords_map[str(issue_id)] = KeywordSet.model_validate(dump)
        except Exception:
            logger.warning("[pipeline] stored keywords for issue %s invalid — regenerating", issue_id)
    fanout_results = await issue_fanout(issues, context, keywords_map)
    return assemble_response(session_id, context, fanout_results)


async def run_search_pipeline(raw_text: str, source_text: str | None = None) -> SearchResponse:
    """The one-shot root orchestrator (spec Sections 4 and 11): document
    context → issue split → fan-out → guardian → assembler."""
    session_id, context, issues = await analyze_case(raw_text, source_text)
    if context.needs_clarification:
        return SearchResponse(
            sessionId=session_id,
            needsClarification=True,
            clarificationQuestion=context.clarification_question,
            caseContext=context,
            issues=[],
        )
    return await run_issue_search(session_id, context, issues)
