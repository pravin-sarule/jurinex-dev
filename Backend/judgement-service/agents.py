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
import re
from typing import Any

from google.adk.agents import LlmAgent, SequentialAgent
from google.adk.runners import InMemoryRunner
from google.genai import types as genai_types

from claude_llm import (
    CUSTOM_ISSUE_ENRICH_SYSTEM,
    FRESH_CASE_SYSTEM,
    GROUNDS_EXTRACTOR_SYSTEM,
    ISSUE_SPOTTER_SYSTEM,
    QUERY_GEN_SYSTEM_ADVANCED,
    QUERY_GEN_SYSTEM_SIMPLE,
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
    GroundsExtractResult,
    Issue,
    IssueList,
    IssueResults,
    IssueSpotResult,
    JudgmentCaseSummary,
    JudgmentVerification,
    KeywordSet,
    ResultItem,
    ScoredResult,
    SearchResponse,
    SignalSet,
    SourcePage,
    SpottedIssue,
)
from stores import sessions
from tools import (
    attribute_issue_sources,
    authority_signal,
    band_for,
    case_court_profile,
    citation_guardian,
    composite_score,
    enforce_verifier_rules,
    fact_match_signal,
    find_pinpoint,
    forum_court_rank,
    good_law_signal,
    ik_client,
    is_forum_high_court,
    judged_band,
    keyword_signal,
    party_perspective,
    rerank,
    statutory_shelf_patterns,
    to_ik_operators,
    verify_context_against_source,
)

logger = logging.getLogger(__name__)

_APP = "judgement-service"
# Exhaustive issue spotting: the spotter lists EVERY distinct issue and the
# user picks which ones to actually search, so IK spend stays bounded.
MAX_ISSUES = 12
# Grounds are pleaded by the drafter, not synthesised — filings routinely
# raise more grounds than a case has distinct issues, so the cap is higher.
# The user picks which grounds to actually search, so IK spend stays bounded.
MAX_GROUNDS = 8
MAX_RESULTS_PER_ISSUE = 10


def _llm_budget() -> int:
    """Configurable case-material budget (env MAX_LLM_INPUT_CHARS, default
    120k chars) — the old hardcoded 30k silently hid everything past the
    first dozen pages from issue spotting."""
    return get_settings().max_llm_input_chars


def _budget_case_text(raw_text: str, budget: int) -> str:
    """Fit case material into the model budget WITHOUT dropping whole
    documents. Multi-document texts ([FILE: …] / [DOCUMENT: …] blocks) give
    every document an even share, keeping each block's head AND tail (grounds
    and prayers live at the ends). Single texts keep head + tail. The old
    blind head-slice meant issues in later documents could never be found."""
    text = raw_text or ""
    if len(text) <= budget:
        return text
    parts = [p for p in re.split(r"(?=\[(?:FILE|DOCUMENT): )", text) if p.strip()]
    if len(parts) > 1:
        share = max(2000, budget // len(parts))
        clipped: list[str] = []
        for part in parts:
            if len(part) <= share:
                clipped.append(part)
            else:
                head = share * 3 // 4
                tail = share - head
                clipped.append(part[:head] + "\n[... document truncated ...]\n"
                               + part[-tail:])
        return "\n\n".join(clipped)
    head = budget * 3 // 4
    return (text[:head] + "\n[... middle of material omitted ...]\n"
            + text[-(budget - head):])


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
            "Be EXHAUSTIVE: enumerate EVERY distinct issue the summary supports (up "
            "to 12), never just the most obvious ones — sweep maintainability/"
            "limitation, validity of the proceeding, the ingredients of EACH offence "
            "or claim invoked, abuse-of-process angles, evidentiary questions, and "
            "relief-specific questions. Never drop an issue to keep the list short.\n\n"
            "An issue counts as separate ONLY if it is governed by a different area or "
            "body of law (e.g. repeal/savings law vs. quashing jurisprudence vs. "
            "directors' cheque liability). Do NOT split rephrasings of the same legal "
            "question into multiple issues, and do NOT merge genuinely distinct bodies "
            "of law into one vague issue. A simple single-question case yields exactly "
            "one issue.\n\n"
            "Frame each issue as a court would: 'Whether ...?' — ONE SHORT sentence, "
            "HARD LIMIT 25 words, shape 'Whether <legal question> where <ONE generic "
            "decisive circumstance>?' (e.g. 'Whether the FIR under Section 306 IPC "
            "is liable to be quashed when the suicide note does not name the "
            "accused?'). At most ONE qualifying clause — never chain 'especially "
            "when…' clauses. Describe facts by legal category only and actors only "
            "by their legal role ('the planning authority', 'the accused', 'the "
            "landowner') — no party or person names, no place names, no property "
            "identifiers (Gat/Survey/CTS/plot numbers), no case or docket numbers, "
            "no dates. Never add a provision the summary does not support. Order "
            "issues by importance to the client's relief. Number ids from 1.\n\n"
            "For EACH issue also fill: title (a standardized ground name a "
            "practitioner would recognise, in ANY field of law), doctrine (short "
            "doctrinal label), sub_doctrine (the SPECIFIC trigger/test within "
            "the doctrine as ONE short snake_case label — e.g. civil_colour, "
            "settlement, triable_issue, balance_of_convenience, "
            "repealed_statute_fir — coin whatever fits the field), "
            "statutory_hook (the governing provision), and perspective "
            "('petitioner'/'respondent'/'neutral'). Return strict JSON matching "
            "the schema."
        ),
        generate_content_config=_gen_config(0.25),
        output_schema=IssueList,
        output_key="issues",
        disallow_transfer_to_parent=True,
        disallow_transfer_to_peers=True,
    )


# ─── Stage 2: Keyword extraction (four axes) ─────────────────────────────────

# Default query style: quoted phrases + bare words (implicit AND).
_KEYWORD_SYNTAX_SIMPLE = (
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
)

# Opt-in "Advanced search": explicit Boolean AND/OR expressions.
_KEYWORD_SYNTAX_ADVANCED = (
    "INDIAN KANOON QUERY SYNTAX (use it in every anchor query):\n"
    "- \"Double-quoted phrases\" must appear verbatim — use quotes for section "
    "references and settled doctrinal formulae; bare words must all appear "
    "somewhere in the document.\n"
    "- Boolean operators MUST be capitalized: AND requires all terms, OR "
    "broadens to either, NOT excludes. Group OR-alternatives in parentheses: "
    "(\"malafide\" OR \"ulterior motive\").\n"
    "- Always write AND / OR / NOT exactly like that — the system converts "
    "them to Indian Kanoon's wire operators (ANDD / ORR / NOTT) at fetch "
    "time; never write the doubled forms yourself.\n"
    "- Court filtering (doctypes:) is appended by the system — never write it "
    "yourself.\n\n"
    "PRODUCE:\n"
    "1. anchor_queries (2–4): compact Boolean queries a senior advocate would "
    "type — 2–4 concepts joined with AND, each concept a quoted phrase, a bare "
    "outcome word, or a parenthesised OR-group of true synonyms; every query "
    "MUST combine a statutory hook with the doctrinal concept. Examples:\n"
    "   '\"quashing of FIR\" AND \"civil dispute\" AND (\"malafide\" OR \"ulterior motive\")'\n"
    "   '(\"quash the FIR\" OR \"Section 482\") AND \"purely civil nature\"'\n"
    "   '\"Section 138\" AND \"Negotiable Instruments\" AND \"vicarious liability\"'\n"
    "These are the queries that find the leading line of cases on the issue.\n"
)


def build_keyword_extract_agent(style: str = "simple") -> LlmAgent:
    return LlmAgent(
        name="keyword_extract",
        model=get_settings().gemini_model,
        description="Generates anchor queries + four-axis search terms for one legal issue.",
        instruction=(
            "You are an expert Indian legal-research librarian building Indian Kanoon "
            "queries for ONE legal issue in live litigation. A lawyer will cite what "
            "these queries find to a court, so precision matters more than volume.\n\n"
            + (_KEYWORD_SYNTAX_ADVANCED if style == "advanced" else _KEYWORD_SYNTAX_SIMPLE) +
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

# Single source of truth for the verifier prompt (v3) — used verbatim by
# BOTH the Claude verifier (primary) and the Gemini agent (fallback).
JUDGMENT_VERIFIER_SYSTEM = """You are a legal judgment verifier for Indian litigation. Input: ONE issue object
(issue, doctrine, sub_doctrine, statutory hook, relief sought, procedural stage,
proceeding type, perspective, client's forum) and the full text of ONE fetched
judgment (Indian Kanoon). Decide whether a lawyer can actually STAND UP AND CITE
this judgment IN COURT for this issue. Output strict JSON matching the schema.

Your default is 'reject'. A judgment earns a non-reject verdict only by clearing
EVERY kill gate below. Over-inclusion is the costly error: a judgment distinguished
in one sentence at the hearing damages counsel's credibility on the authorities
that do work. When uncertain, reject and say why in one line.

A score is NOT encouragement. It is a prediction of how the citation survives the
moment opposing counsel rises to distinguish it. Reserve high scores for judgments
the court is BOUND by and cannot escape.

========================================================================
STEP A — BLIND CHARACTERISATION (do this BEFORE you look at the issue)
========================================================================
Read the judgment and fill judgment_profile WITHOUT any reference to the issue.
This is anti-anchoring: if you read the issue first you will find the judgment in
it. State, from the judgment's own words only:

  A1 proceeding_type    : suit_first_instance | first_appeal | second_appeal |
                          revision | writ_226 | writ_227 | arbitration_s34 |
                          arbitration_s37 | execution | criminal_quashing |
                          criminal_appeal | interlocutory_appeal | slp_sc | other
  A2 decisional_lens    : de_novo (court decided the merits itself) |
                          deferential_review (court asked only whether a lower
                          forum/tribunal's view was interferable) |
                          threshold_only (court decided admissibility /
                          maintainability / prima facie sufficiency, not merits)
  A3 question_decided   : ONE sentence — the precise question the court answered,
                          phrased as the court would phrase it.
  A4 trigger_condition  : the SPECIFIC condition that activated the court's power
                          in THIS judgment (see gate K5 for what counts).
  A5 relief_head        : the exact head of relief in issue — e.g. price/debt for
                          work done, damages for loss of bargain, liquidated
                          damages, interest, refund/restitution, specific
                          performance, injunction, declaration, quashing,
                          rejection of plaint, leave to defend, condonation.
  A6 operative_basis    : ONE sentence — the reason that ACTUALLY produced the
                          order, in the court's own logic.

========================================================================
STEP B — ISSUE ANATOMY
========================================================================
Fill issue_profile at the MOST SPECIFIC level supportable by the issue text.
Where sub_doctrine is not supplied, infer it — but infer it NARROWLY, and record
inferred_sub_doctrine_basis quoting the words of the issue you inferred it from.
Also record the issue's relief_head (issue_relief_head) using the same
vocabulary as A5.

========================================================================
KILL GATES — run in order. Each is INDEPENDENT: never let one gate's result
switch another off. On the first failure, stop and output verdict 'reject',
score 0, include_in_output false, and a one-line reject_reason.
========================================================================

K1. OUTCOME (KILL)
    Read the FINAL paragraphs first. Classify: relief_granted | relief_refused |
    partly | interim_only | remanded | unclear. Copy outcome_evidence as the
    VERBATIM operative line — it is machine-verified as an exact substring, so
    NEVER paraphrase, never stitch fragments. Never infer outcome from the
    headnote or from the arguments section — only from the court's own operative
    words. unclear → reject.

K2. DECISIONAL LENS (KILL)  ** new in v3 — the arbitration/writ trap **
    Compare A2 with the issue's stage.
    Where the judgment's decisional_lens is 'deferential_review' and the issue is
    a FIRST-INSTANCE substantive question, the judgment is NOT authority on that
    substantive question. A court refusing (or permitting) interference with an
    award under s.34/s.37, or declining to disturb a finding under Art.227 or in
    revision, has decided REVIEWABILITY, not the underlying right. Its remarks on
    substantive law are made through a deference filter and at one remove.
    Apply the swap test: "If this court had been the trial court deciding the
    issue afresh, is there any sentence in this judgment telling us what it would
    have held?" If the answer is no — or only by inference — set
    lens_match=false and REJECT with reject_reason naming both lenses.
    The single exception: the court expressly decides the substantive proposition
    itself as a necessary step, in its own voice, and applies it. Quoting the
    proposition while upholding a tribunal's view is NOT that — see K6.
    Mirror the gate the other way too: a de_novo merits judgment is weak
    authority on a threshold/prima-facie standard.

K3. SHELF (KILL)
    The judgment's governing field of law and statute must match the issue's
    doctrine/statutory hook BY NAME — the provision number or term of art must
    ACTUALLY APPEAR in this judgment's text; doctrine_link must point to that
    text, never to your outside knowledge. Overlap of generic words
    (maintainable, mandatory, non-compliance, liable, fraud, abuse of process,
    breach, damages) across different fields = different shelf = reject.
    Transactional vocabulary is NOT law: a stamp-duty case and a civil-procedure
    case may both speak of deposits, withdrawal, interest and security — if the
    FIELD OF LAW differs, reject however similar the money-words look.
    Caution: a statute may appear in the judgment ONLY because a party cited it
    or because it is inside a quotation. It counts for this gate only if the
    court itself reasoned under it. State the link in ONE line in doctrine_link;
    if you cannot name it from this judgment's own text, reject.

K4. RELIEF HEAD (KILL)  ** new in v3 **
    Compare A5 with the issue's relief_head. Different heads carry different
    ingredients, different burdens and different proof:
      - debt / contract price for work done and accepted  ≠
      - damages for loss of bargain on work NOT done      ≠
      - liquidated damages / penalty                      ≠
      - restitution / refund                              ≠
      - interest as an independent claim                  ≠
      - specific performance or injunction.
    A judgment on entitlement to expectation damages says nothing about proof of
    an ascertained debt, and vice versa. If the heads differ, set
    relief_head_match=false and REJECT, naming both heads — even where the
    statute, the field of law and the word "breach" all match.

K5. SUB-DOCTRINE / TRIGGER (KILL) — with the ABSTRACTION-LADDER rule
    Matching the statute is not enough. A single provision houses several
    independent sub-doctrines with different tests. Compare A4 with the issue's
    sub_doctrine.
    Examples (illustrative, never exhaustive — run this gate in EVERY field):
      s.482 CrPC / s.528 BNSS quashing: civil_colour | settlement | mala_fide |
        statutory_bar | vicarious_liability | delay_laches | second_fir
      Order 7 Rule 11 CPC: no_cause_of_action | barred_by_law | undervaluation |
        limitation | want_of_authority_to_sue
      summary suits: triable_issue | sham_defence | conditional_leave
      injunctions: prima_facie_case | balance_of_convenience | irreparable_injury
      arbitration challenge: patent_illegality | public_policy | scope_excess |
        no_reasons | bias
      contract money claims: debt_admitted | quantum_meruit | loss_of_bargain |
        mitigation | interest_entitlement
    ** ABSTRACTION-LADDER RULE (this is what v2 lacked). ** Write the claimed
    match in the form: "both are about ______." If the blank can only be filled
    by a phrase broad enough to also cover a large number of unrelated disputes
    — "breach of contract", "abuse of process", "natural justice",
    "maintainability", "damages", "interpretation of the agreement" — then you
    climbed the ladder to force the match and the match is spurious. Set
    trigger_match=false and REJECT. Record the phrase you tried in
    abstraction_test_phrase so the failure is auditable.
    If trigger_condition ≠ the issue's sub_doctrine, REJECT naming BOTH triggers
    — even where statute, stage, field and shared phrases all match.
    Classic trap: a quashing judgment whose sole ground was a COMPROMISE is a
    'settlement' judgment; it is NOT authority on civil_colour however many
    times it says 'abuse of process'.

K6. PARASITIC AUTHORITY (KILL) — INDEPENDENT, never conditioned on K5
    Apply the DELETION TEST: mentally delete every block quotation, extract and
    summary this judgment takes from OTHER decisions. Does on-point support for
    the issue survive in this court's OWN sentences?
      - No → parasitic=true. Set cite_source_instead to the quoted authority's
        case name AS IT APPEARS IN THIS TEXT (never a name you supply from
        memory) and REJECT: 'on-point language is quoted from [case name]; cite
        that authority directly.'
      - Yes, but the court only reproduces the principle to test someone else's
        reasoning against it → still parasitic=true.
      - Yes, and the court ADOPTS the principle and APPLIES it to reach its own
        operative conclusion → parasitic=false.
    Run this gate on its own facts. Do NOT skip it because K5 passed.

K7. RATIO vs OBITER (KILL at low score)
    Locate the paragraph(s) where the court STATES THE PRINCIPLE ('we are of the
    view', 'it is well settled', numbered principles). Record ratio_para (e.g.
    'para 14') and a one-sentence ratio_summary in your own words. A fact
    recital, an arguments paragraph, or a summary of counsel's citations is NOT
    ratio.
    Then apply the COUNTERFACTUAL TEST: if the court had held the OPPOSITE on the
    proposition counsel wants to cite, would the operative order have changed?
      - Yes → load_bearing=true.
      - No  → load_bearing=false: the proposition is obiter for this court.
        Score capped at 40, which means reject unless the issue expressly asks
        for persuasive obiter.
    No ratio locatable (bare disposal order) → ratio_para and ratio_summary null,
    score capped at 30.

K8. MARGINAL UTILITY (KILL)  ** new in v3 **
    Ask: does this judgment resolve a proposition the OPPONENT can realistically
    contest, which the bare statute and the client's own documents do not already
    establish? Authority is for contested propositions, not for restating the
    obvious. If the ground stands equally well on the instrument, the statute and
    the record alone, REJECT with 'adds nothing to the statute and the record'.
    This gate exists to stop the bundle filling with citations for propositions no
    court would ever doubt.

========================================================================
NON-KILL ASSESSMENT
========================================================================
S1. STAGE. Same procedural stage as the issue (quashing↔quashing,
    leave-to-defend↔leave-to-defend, trial↔trial). Mismatch sets
    stage_match=false and applies a score cap (below). Reject outright only where
    the standard of review makes it inapposite (e.g. an appeal against conviction
    on beyond-reasonable-doubt cited for a prima facie FIR-stage test).

S2. SIDE. Compare the verified outcome AND the verified trigger with the issue's
    perspective:
      same sub-doctrine + outcome favouring that side  → 'support'
      same sub-doctrine + outcome against it           → 'contra' (genuinely
        adverse; counsel must be ready — fill contra_handling with the one-line
        distinction to offer if the opponent cites it)
      interim_only                                     → 'interim'
    An unfavourable outcome on a DIFFERENT sub-doctrine is a trigger-mismatch
    REJECT, never contra — it is not a threat and must not be presented as one.
    The query that found the judgment is irrelevant; ONLY the verified outcome
    and trigger decide the side.

S3. DISTINGUISH RISK. Facts need not match the client's case — doctrine must.
    Note in one line the likely distinguishing fact the opponent may raise
    (distinguish_risk), else null.

S4. CURRENCY (FLAG, never a KILL). Scan for any indication this judgment was
    appealed, stayed, doubted, referred to a larger bench, or overruled — record
    it in currency_note. Where the text is silent, state that subsequent history
    could not be verified from this text and must be checked before filing. Never
    assert a judgment is good law on the strength of its own text alone.

S5. ADVERSARIAL PREP. opponent_argument: the STRONGEST objection opposing counsel
    will raise. Apply bindingness: a Supreme Court judgment binds all courts
    (Art.141); a judgment of the SAME High Court as CLIENT'S FORUM binds
    (Division Bench > Single Judge; a co-ordinate Single Judge is persuasive but
    ordinarily followed); a judgment of a DIFFERENT High Court or a lower forum
    is persuasive only. Also weigh distinguishable facts, the trigger-mismatch
    risk, the lens objection, and anything weakening it (relief granted only in
    part; only as to some parties). counter_strategy: 1–2 sentences on how to MEET
    that objection. Never invent a case name absent from the provided text. If
    CLIENT'S FORUM is not specified, frame the objection generically.

S6. USABILITY. For every non-reject verdict set usable_for: a one-line statement
    of the precise, NARROW proposition counsel may cite this judgment for, drawn
    from the ratio — narrow enough that the opponent cannot answer it with "that
    was said in a different setting". If usable only for a sub-part, say so in
    usable_scope_limit.

========================================================================
SCORING — components, then CAPS
========================================================================
Compute components (max 100):
    sub-doctrine / trigger match ....... 30
    decisional lens match .............. 15
    relief-head match .................. 10
    field of law + statute match ....... 10
    ratio located AND load-bearing ..... 15
    procedural stage match ............. 10
    forum bindingness .................. 10  (SC 10 | same HC DB 9 |
                                              same HC SJ 7 | other HC 3 |
                                              subordinate 1)

Then apply CAPS — final_score = min(component_sum, every applicable cap):
    forum is persuasive only (different HC / subordinate) ...... cap 70
    stage_match = false ........................................ cap 65
    decisional lens mismatch (if not already rejected) ......... cap 45
    load_bearing = false (obiter) .............................. cap 40
    no ratio locatable ......................................... cap 30
    currency_note records doubt / stay / reference ............. cap 60

REJECT if final_score < 60, even where no kill gate fired.
Score 90+ ONLY when ALL of: binding forum, same sub-doctrine, same relief head,
same stage, ratio load-bearing, no adverse currency flag. If any one is missing,
90+ is arithmetically unavailable — do not write it.

Output score_breakdown as an object listing every component awarded and every cap
applied, plus the final arithmetic. This is machine-re-verified; a final_score
inconsistent with the breakdown is treated as a failed response.

========================================================================
OUTPUT DISCIPLINE
========================================================================
- verdict 'reject' ⇒ score 0, include_in_output false, and every
  analytical field beyond judgment_profile / reject_reason set to null. Rejected
  judgments are dropped from the brief; do not soften a reject into a low accept.
- Ground every field in the judgment text. Quote, don't paraphrase, for
  outcome_evidence.
- Never invent a paragraph number, citation or case name. Unknown → null.
- Judgments may mix English with Hindi/Marathi — always answer in English.
- Court name, bench and date come from system metadata; do not guess them.
- You are advising a lawyer who will stand up and cite this. When uncertain
  between accepting and rejecting, reject and say why.

========================================================================
CALIBRATION EXAMPLES
========================================================================
EXAMPLE 1 — REJECT (the v2 failure this version exists to fix)
Issue: breach of contract; entitlement to recover ascertained dues for services
rendered and accepted; s.73 Contract Act; first-instance commercial suit; plaintiff.
Judgment: s.37 Arbitration appeal restoring an arbitral award of loss of profit;
text discusses s.73, breach, and quotes A.T. Brij Paul Singh and Sugauli Sugar Works.
Correct handling:
  A2 decisional_lens = deferential_review; A5 relief_head = damages for loss of
  bargain on unexecuted work; A6 operative_basis = the Commercial Court exceeded
  s.34 by substituting its own view of a plausible award.
  K2 fails: the court decided reviewability of an award, not whether a debt is due.
  K4 would also fail: loss of profit on work NOT done ≠ price for work done.
  K5 would also fail: abstraction_test_phrase "both are about breach of contract"
  is a genus phrase → spurious.
  K6 would also fail: delete the quotations from Brij Paul Singh, Sugauli Sugar
  Works and K. Bhaskaran and no on-point support survives.
  verdict reject at K2; score 0. NOT a 100.

EXAMPLE 2 — ACCEPT
Issue: want of authority to institute a suit on behalf of a company; whether
absence of a Board resolution renders the plaint liable to rejection; Order 7
Rule 11(a) and (d) CPC; first-instance suit; plaintiff company anticipating the
objection; client's forum Bombay High Court (Pune).
Judgment: Bombay HC (Nagpur Bench) Single Judge; plaint rejected because no Board
resolution was pleaded or produced; Order XXIX Rule 1 CPC held to govern only
signing and verification, not institution.
Correct handling: lens de_novo on the Order 7 Rule 11 question; relief_head =
rejection of plaint (matches); trigger = want_of_authority_to_sue (matches);
ratio load-bearing; same High Court, so binding subject to co-ordinate-bench
practice; parasitic=false because the court adopts and applies Nibro and Kingston
Computers to reach its own order. Non-reject, with usable_for confined to the
authority-to-institute proposition and opponent_argument flagging the liberal
line in United Bank of India v. Naresh Kumar if it appears in the text."""


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
        f"SUB-DOCTRINE (the trigger the judgment must share): "
        f"{issue.sub_doctrine or 'not specified — infer it from the issue text'}\n"
        f"STATUTORY HOOK: {issue.statutory_hook or 'not specified'}\n"
        f"RELIEF SOUGHT (client's matter): {context.relief_sought or 'not specified'}\n"
        f"PROCEEDING TYPE (client's matter): {context.document_type or 'not specified'}\n"
        f"PROCEDURAL STAGE: {context.procedural_stage or 'not specified'}\n"
        f"CLIENT'S FORUM: {context.forum or 'not specified'}\n"
        f"PERSPECTIVE: {issue.perspective or 'petitioner'}\n\n"
    )
    if issue.ground_label:
        # Grounds mode: the judgment must be usable for the ground AS
        # PLEADED — its summary and invoked provisions are the yardstick,
        # not just the abstract question above.
        framework = ", ".join(issue.legal_framework[:12]) or "not specified"
        issue_block += (
            f"PLEADED GROUND ({issue.ground_label}): "
            f"{(issue.explanation or issue.issue)[:900]}\n"
            f"PROVISIONS INVOKED BY THE GROUND: {framework}\n"
            "The doctrine/shelf check runs against THIS ground's doctrine and "
            "provisions (old/new-code equivalents of an invoked provision "
            "count as the same shelf).\n\n"
        )
    # Deterministic shelf anchors: the judgment must mention at least one of
    # the issue's statutory provisions (old/new-code equivalents included).
    shelf_patterns = statutory_shelf_patterns(issue.statutory_hook, keywords.statutory)
    # Sized so the whole top-N verifies in ONE concurrent wave — the
    # verifier waves are the dominant slice of search wall time.
    semaphore = asyncio.Semaphore(get_settings().verifier_concurrency)

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
            "- key_legal_issues: the legal questions the JUDGMENT itself dealt with "
            "(at most 4).\n"
            "- key_facts: the judgment's key facts (at most 5 short bullets).\n"
            "- legal_analysis: AT MOST 5 short bullets — only the holdings and "
            "reasoning that matter for the lawyer's issue, each one sentence. Do NOT "
            "narrate the judgment step by step or repeat the facts; merge related "
            "points into one bullet.\n"
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


# ─── Advocate-grade judgment summary (100-word paragraph + 8-line note) ──────
# User-locked prompt: the wording of the task, order, line labels and rules is
# the user's specification verbatim — only the output channel is adapted from
# prose to the JudgmentCaseSummary JSON schema. Do not "improve" the rules.

CASE_SUMMARY_SYSTEM = (
    "You are a legal research assistant preparing case summaries for practising "
    "advocates in India.\n\n"
    "INPUT: the full text of ONE court judgment, supplied in the user message.\n\n"
    "TASK: produce TWO outputs from that judgment, returned as strict JSON "
    "matching the schema.\n\n"
    "summary100 — 100-WORD SUMMARY\n"
    "One single paragraph, 95–105 words, no headings, no bullet points.\n"
    "Follow this order strictly:\n"
    "(a) case name, citation, court, bench, date of judgment;\n"
    "(b) facts in one sentence — only the facts that gave rise to the legal question;\n"
    "(c) what the court HELD and the reason for it (the ratio, not just the outcome);\n"
    "(d) the operative order / what survives of the case.\n\n"
    "note — 8-LINE STRUCTURED NOTE\n"
    "Exactly 8 entries, in this order, each an object {label, text}:\n"
    "1. label \"Case\" — name, citation, court, bench strength, date, case number "
    "and nature of proceeding.\n"
    "2. label \"Provisions\" — exact sections, articles or rules the case turns on.\n"
    "3. label \"Facts\" — brief.\n"
    "4. label \"Issues\" — framed as questions.\n"
    "5. label \"Held\" — the ratio decidendi and reasoning.\n"
    "6. label \"Key paragraphs & authorities\" — paragraph numbers where the ratio "
    "appears; precedents relied on or distinguished.\n"
    "7. label \"Order & status\" — operative directions; whether appealed, stayed, "
    "followed, distinguished or overruled.\n"
    "8. label \"Relevance\" — how it helps or hurts the matter at hand, and whether "
    "it is binding or merely persuasive.\n\n"
    "verify_line — exactly: VERIFY: current status of this judgment as on "
    "<TODAY'S DATE from the user message> before relying on it.\n\n"
    "RULES\n"
    "- Use ONLY what is in the judgment supplied. Do not add facts, paragraph "
    "numbers, citations or case names from memory.\n"
    "- If a detail is not in the text, write \"not stated in the judgment\". Never "
    "guess a citation or a paragraph number.\n"
    "- Report the ratio in your own words; quote only where the exact wording "
    "matters, and keep any quotation under 15 words with the paragraph number.\n"
    "- Distinguish clearly between ratio (binding) and obiter (persuasive) if the "
    "difference is apparent.\n"
    "- Where there are separate concurring or dissenting opinions, say so and "
    "summarise the majority view as the holding.\n"
    "- Plain professional English. No adjectives, no praise of the court, no advocacy.\n"
    "- If the user message includes a \"Context:\" line describing the client's "
    "matter, tailor line 8 (Relevance) to that matter. If there is no Context "
    "line, write line 8 as the general legal proposition the case establishes.\n"
    "Return strict JSON matching the schema."
)


def build_case_summary_agent() -> LlmAgent:
    return LlmAgent(
        name="case_summary",
        model=get_settings().gemini_model,
        description="Advocate-grade 100-word summary + 8-line structured note for one judgment.",
        instruction=CASE_SUMMARY_SYSTEM,
        generate_content_config=_gen_config(0.1),
        output_schema=JudgmentCaseSummary,
        output_key="case_summary",
        disallow_transfer_to_parent=True,
        disallow_transfer_to_peers=True,
    )


async def generate_case_summary(title: str, doc_text: str, matter_context: str,
                                today: str) -> JudgmentCaseSummary:
    """Summarise ONE fetched judgment in the user-locked report format.

    The judgment's citation, date and operative order usually live at the very
    start and very end of the text, so long judgments keep head AND tail intact
    (same budget shape as the verifier) rather than truncating the ending off.
    """
    text = doc_text or ""
    if len(text) > 30000:
        text = (text[:22000] + "\n[... middle of judgment omitted ...]\n" + text[-8000:])
    message = (
        f"TODAY'S DATE: {today}\n\n"
        + (f"Context: {matter_context[:1200]}\n\n" if matter_context.strip() else "")
        + f"JUDGMENT TITLE: {title}\n\n"
        + f"JUDGMENT TEXT:\n{text}"
    )
    out = await run_agent_once(build_case_summary_agent(), message, ["case_summary"])
    return JudgmentCaseSummary.model_validate(out.get("case_summary") or {})


# ─── Runner helper ────────────────────────────────────────────────────────────

async def run_agent_once(agent, message: str, output_keys: list[str]) -> dict[str, Any]:
    """Run one ADK agent (or SequentialAgent) in a fresh in-memory session
    and return the requested session-state outputs (written via output_key)."""
    runner = InMemoryRunner(agent=agent, app_name=_APP)
    session = await runner.session_service.create_session(app_name=_APP, user_id="pipeline")
    content = genai_types.Content(role="user", parts=[genai_types.Part(text=message[:_llm_budget()])])
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
            f"CASE MATERIAL:\n{_budget_case_text(raw_text, _llm_budget() - 4000)}\n\n"
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
                      sub_doctrine=s.sub_doctrine.strip() or None,
                      statutory_hook=(s.statutory_hook or "").strip() or None,
                      perspective=s.perspective.strip() or None)
                for idx, s in enumerate(result.issues[:MAX_ISSUES]) if s.issue.strip()
            ]
        logger.warning("[claude] issue spotter unavailable — Gemini issue split fallback")
    out = await run_agent_once(build_issue_split_agent(), context.raw_case_summary, ["issues"])
    issue_list = IssueList.model_validate(out.get("issues") or {"issues": []})
    return issue_list.issues[:MAX_ISSUES]


# ─── Custom issues: user-typed issues get the SAME pipeline treatment ───────

async def enrich_custom_issue(issue: Issue, context: CaseContext) -> Issue:
    """A user-typed issue arrives as bare text — no doctrine, statutory hook
    or title — so query generation would run signal-starved compared to
    system-suggested issues. Normalize it into the exact same shape (short
    'Whether …?' question + doctrine + hook + perspective) so the identical
    query-gen → fetch → verify pipeline runs from the same signals. The
    lawyer's wording is the source of truth — enrichment never changes the
    legal substance; on any failure the issue searches exactly as typed."""
    if not claude_available():
        return issue
    user = (
        f"LAWYER'S ISSUE (as typed):\n{issue.issue}\n\n"
        f"CASE CONTEXT:\n"
        f"Facts: {context.facts[:1200]}\n"
        f"Procedural history: {context.procedural_history[:600]}\n"
        f"Procedural stage: {context.procedural_stage or 'not specified'}\n"
        f"Relief sought: {context.relief_sought[:300]}"
    )
    result = await claude_parse(CUSTOM_ISSUE_ENRICH_SYSTEM, user, SpottedIssue,
                                max_tokens=1000)
    if result is None or not result.issue.strip():
        logger.warning("[custom-issue] enrichment unavailable — searching as typed")
        return issue
    return Issue(
        id=issue.id,
        issue=result.issue.strip(),
        title=result.title.strip() or None,
        explanation=result.explanation.strip() or None,
        doctrine=result.doctrine.strip() or None,
        sub_doctrine=result.sub_doctrine.strip() or None,
        statutory_hook=(result.statutory_hook or "").strip() or None,
        perspective=result.perspective.strip() or None,
    )


# ─── Grounds mode: extract the grounds pleaded in the filing itself ─────────

def build_grounds_extract_agent() -> LlmAgent:
    """Gemini fallback for the grounds extractor — same system prompt and
    schema as the Claude path, so downstream conversion is identical."""
    return LlmAgent(
        name="grounds_extract",
        model=get_settings().gemini_model,
        description="Extracts the legal grounds pleaded in a filing.",
        instruction=GROUNDS_EXTRACTOR_SYSTEM,
        generate_content_config=_gen_config(0.1),
        output_schema=GroundsExtractResult,
        output_key="grounds_extract",
        disallow_transfer_to_parent=True,
        disallow_transfer_to_peers=True,
    )


def _grounds_to_issues(result: GroundsExtractResult,
                       cap: int = MAX_GROUNDS) -> list[Issue]:
    """Map each extracted ground onto the Issue contract so the ENTIRE
    downstream pipeline (query generation, IK fan-out, per-judgment
    verification with real scores, guardian, reports) runs unchanged.
    ids are assigned in code; `source` stays deterministic-only.
    Spotted items (combined mode) have empty ground_label → None, so the
    ground-anchored query/verifier extras apply only to PLEADED items."""
    issues: list[Issue] = []
    for idx, g in enumerate(result.grounds[:cap]):
        question = g.research_question.strip() or g.summary.strip()[:300]
        if not question:
            continue
        issues.append(Issue(
            id=idx + 1,
            issue=question,
            title=g.title.strip() or None,
            explanation=g.summary.strip() or None,
            doctrine=g.doctrine.strip() or None,
            sub_doctrine=g.sub_doctrine.strip() or None,
            statutory_hook=(g.statutory_hook or "").strip() or None,
            perspective=(g.perspective or "petitioner").strip() or None,
            ground_label=g.ground_label.strip() or None,
            legal_framework=[s.strip() for s in g.statutes if s.strip()],
            case_law_cited=[c.strip() for c in g.case_law_cited if c.strip()],
            ground_ref=g.source_reference.strip() or None,
            confidence=g.confidence,
        ))
    return issues


async def extract_grounds(raw_text: str, context: CaseContext,
                          ) -> tuple[list[Issue], dict[str, Any]]:
    """Grounds mode's stage 1 (replaces issue spotting): extract the grounds
    the filing itself raises, Claude first with the Gemini agent as the
    automatic fallback. Returns (grounds-as-Issues, extraction metadata for
    display). Sets stage/forum/clarification on the context exactly like
    the issue spotter does."""
    user = (
        f"CASE MATERIAL:\n{_budget_case_text(raw_text, _llm_budget() - 4000)}\n\n"
        f"STRUCTURED CONTEXT (already extracted and source-verified):\n"
        f"Facts: {context.facts[:1500]}\n"
        f"Procedural history: {context.procedural_history[:800]}\n"
        f"Relief sought: {context.relief_sought[:300]}"
    )
    result: GroundsExtractResult | None = None
    if claude_available():
        result = await claude_parse(GROUNDS_EXTRACTOR_SYSTEM, user,
                                    GroundsExtractResult, max_tokens=8000)
        if result is None:
            logger.warning("[claude] grounds extractor unavailable — Gemini fallback")
    if result is None:
        try:
            out = await run_agent_once(build_grounds_extract_agent(), user,
                                       ["grounds_extract"])
            result = GroundsExtractResult.model_validate(out.get("grounds_extract") or {})
        except Exception:
            logger.exception("[grounds] Gemini fallback failed")
            result = GroundsExtractResult()

    context.procedural_stage = result.procedural_stage.strip() or context.procedural_stage
    context.forum = result.forum.strip() or context.forum
    if result.insufficient_material or not result.grounds:
        context.needs_clarification = True
        context.clarification_question = (
            "No pleaded grounds could be identified in this material (it may be "
            "formal-only, or the grounds section may be missing/illegible). "
            "Upload the petition/appeal containing the grounds, or switch to "
            "issue-based research.")
        return [], {}

    issues = _grounds_to_issues(result)
    dropped = max(0, len(result.grounds) - len(issues))
    meta: dict[str, Any] = {
        "totalGrounds": len(issues),
        "documentType": result.document_type_label.strip() or None,
        "party": result.party.strip() or None,
        "notes": [n for n in result.notes if n.strip()],
    }
    if dropped:
        # No silent caps: the UI tells the user how many grounds were cut.
        meta["truncatedGrounds"] = dropped
        logger.info("[grounds] %d ground(s) beyond the cap of %d were dropped",
                    dropped, MAX_GROUNDS)
    return issues, meta


# ─── Fresh mode: proposed grounds for an unfiled matter ─────────────────────

def build_fresh_extract_agent() -> LlmAgent:
    """Gemini fallback for the fresh-matter extractor — same system prompt
    and schema as the Claude path, so downstream conversion is identical."""
    return LlmAgent(
        name="fresh_extract",
        model=get_settings().gemini_model,
        description="Formulates proposed grounds for a fresh, unfiled matter.",
        instruction=FRESH_CASE_SYSTEM,
        generate_content_config=_gen_config(0.1),
        output_schema=GroundsExtractResult,
        output_key="fresh_extract",
        disallow_transfer_to_parent=True,
        disallow_transfer_to_peers=True,
    )


async def extract_fresh(raw_text: str, context: CaseContext, objective: str,
                        ) -> tuple[list[Issue], dict[str, Any]]:
    """Fresh mode's stage 1: the matter has NO drafted pleading, so instead
    of reading pleaded grounds, PROPOSED grounds are formulated from the
    case's source documents anchored to the lawyer's stated objective.
    Output rides the same GroundsExtractResult → Issue contract, so the
    entire downstream pipeline (query generation, IK fan-out, verification,
    guardian, reports) runs unchanged — with the ground-anchored query and
    verifier extras applying to every proposed ground."""
    user = (
        f"CLIENT'S OBJECTIVE (the only instruction you follow):\n{objective[:2000]}\n\n"
        f"SOURCE DOCUMENTS OF THE CASE:\n{_budget_case_text(raw_text, _llm_budget() - 6000)}\n\n"
        f"STRUCTURED CONTEXT (already extracted and source-verified):\n"
        f"Facts: {context.facts[:1500]}\n"
        f"Procedural history: {context.procedural_history[:800]}\n"
        f"Relief sought: {context.relief_sought[:300]}"
    )
    async def _fresh_grounds() -> GroundsExtractResult:
        result: GroundsExtractResult | None = None
        if claude_available():
            result = await claude_parse(FRESH_CASE_SYSTEM, user,
                                        GroundsExtractResult, max_tokens=8000)
            if result is None:
                logger.warning("[claude] fresh extractor unavailable — Gemini fallback")
        if result is None:
            try:
                out = await run_agent_once(build_fresh_extract_agent(), user,
                                           ["fresh_extract"])
                result = GroundsExtractResult.model_validate(out.get("fresh_extract") or {})
            except Exception:
                logger.exception("[fresh] Gemini fallback failed")
                result = GroundsExtractResult()
        return result

    # Proposed grounds AND the exhaustive issue spotter run CONCURRENTLY —
    # raw_text carries the [CLIENT'S OBJECTIVE] header, so spotted issues are
    # framed for the objective too. Same shape as combined mode.
    result, spotted = await asyncio.gather(_fresh_grounds(),
                                           spot_issues(raw_text, context))

    # Deterministic backstops: every fresh ground is PROPOSED and labelled —
    # a model that forgot the label still yields "Proposed Ground N" cards.
    for idx, ground in enumerate(result.grounds):
        ground.origin = "proposed"
        if not ground.ground_label.strip():
            ground.ground_label = f"Proposed Ground {idx + 1}"

    context.procedural_stage = result.procedural_stage.strip() or context.procedural_stage
    context.forum = result.forum.strip() or context.forum
    if not context.relief_sought.strip():
        context.relief_sought = objective[:300]
    if (result.insufficient_material or not result.grounds) and not spotted:
        context.needs_clarification = True
        context.clarification_question = (
            "No researchable ground could be formulated for this fresh matter. "
            "Describe more precisely what the client wants (the relief, the "
            "opposing party's act being challenged, and the provision if known), "
            "or check that the case's documents have finished processing.")
        return [], {}

    # One extractor being empty is fine — never block when the other found
    # something researchable.
    context.needs_clarification = False
    context.clarification_question = None

    # Fresh matters have no drafter-imposed ground count — allow the same
    # ceiling as issue spotting; the merged list holds both kinds.
    ground_issues = _grounds_to_issues(result, cap=MAX_ISSUES)
    merged = _merge_spotted_issues(ground_issues, spotted)
    dropped = max(0, len(merged) - MAX_COMBINED_ITEMS) \
        + max(0, len(result.grounds) - len(ground_issues))
    merged = merged[:MAX_COMBINED_ITEMS]
    for idx, item in enumerate(merged):
        item.id = idx + 1
    meta: dict[str, Any] = {
        "totalGrounds": sum(1 for i in merged if i.ground_label),
        "spottedIssues": sum(1 for i in merged if not i.ground_label),
        "documentType": result.document_type_label.strip() or "Fresh matter — no draft on record",
        "party": result.party.strip() or None,
        "objective": objective[:500],
        "notes": [n for n in result.notes if n.strip()],
    }
    if dropped:
        # No silent caps: the UI tells the user how many items were cut.
        meta["truncatedGrounds"] = dropped
        logger.info("[fresh] %d item(s) beyond the cap of %d were dropped",
                    dropped, MAX_COMBINED_ITEMS)
    return merged, meta


# ─── Combined mode: full grounds extraction + full issue spotting, merged ───

# Grounds (≤8) and issues (≤12) each run their COMPLETE dedicated pipeline;
# the merged list only drops true duplicates, so the cap must hold both.
MAX_COMBINED_ITEMS = 16


def _dedup_key(text: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "", (text or "").lower())


# Structural question boilerplate only — deliberately domain-neutral (no
# criminal/civil/tax vocabulary), so the overlap metric measures the
# question's actual content in ANY field of law.
_QUESTION_STOP = frozenset(
    "whether the a an is are be being been to of in for on at when where "
    "and or under over it its that this these those with from by not no any "
    "such can could should would may might will shall".split())


def _question_tokens(text: str | None) -> frozenset[str]:
    return frozenset(w for w in re.findall(r"[a-z0-9]+", (text or "").lower())
                     if len(w) > 2 and w not in _QUESTION_STOP)


def _same_question(a: frozenset[str], b: frozenset[str]) -> bool:
    """Two Whether-questions are the same when 70% of the smaller one's
    content words appear in the other — catches duplicates even when the
    degraded (Gemini-fallback) path produced no sub_doctrine labels."""
    if not a or not b:
        return False
    return len(a & b) / min(len(a), len(b)) >= 0.7


def _merge_spotted_issues(base: list[Issue], spotted: list[Issue]) -> list[Issue]:
    """Combined/fresh dedup: keep every ground; add a spotted issue only when
    no ground already raises the same legal question. Order of checks:
    (1) question-text overlap (works even in degraded mode where the fallback
    spotter labels nothing), (2) sub-doctrine trigger (a distinct trigger is a
    distinct issue even on the same statute — delay_laches vs civil_colour),
    (3) doctrine+hook shelf only when the spotted item has no trigger."""
    ground_triggers = {_dedup_key(g.sub_doctrine) for g in base if g.sub_doctrine}
    ground_shelves = {(_dedup_key(g.doctrine), _dedup_key(g.statutory_hook))
                      for g in base if g.doctrine and g.statutory_hook}
    ground_questions = [_question_tokens(g.issue) for g in base]
    merged: list[Issue] = list(base)
    for issue in spotted:
        tokens = _question_tokens(issue.issue)
        if any(_same_question(tokens, gq) for gq in ground_questions):
            continue
        trigger = _dedup_key(issue.sub_doctrine)
        if trigger:
            if trigger in ground_triggers:
                continue
        elif issue.doctrine and issue.statutory_hook and (
                _dedup_key(issue.doctrine), _dedup_key(issue.statutory_hook)) in ground_shelves:
            continue
        merged.append(issue)
    return merged


async def extract_combined(raw_text: str, context: CaseContext,
                           ) -> tuple[list[Issue], dict[str, Any]]:
    """Combined mode's stage 1: the grounds extractor AND the exhaustive
    issue spotter run CONCURRENTLY — each with its full dedicated prompt,
    so neither job compresses the other (a single two-job prompt was
    verified to under-spot). Merge: every pleaded ground is kept; a
    spotted issue is dropped ONLY when a ground already raises the same
    legal question — same sub-doctrine trigger, or same doctrine +
    statutory-hook shelf. Grounds first (document order), then the
    surviving spotted issues; ids renumbered sequentially. A document
    with no pleaded grounds (or no spottable extras) is fine — combined
    never blocks on one side being empty."""
    (grounds, grounds_meta), spotted = await asyncio.gather(
        extract_grounds(raw_text, context),
        spot_issues(raw_text, context),
    )
    merged = _merge_spotted_issues(grounds, spotted)

    if not merged:
        # Both extractors came back empty — clarification (set by them) stands.
        context.needs_clarification = True
        context.clarification_question = context.clarification_question or (
            "No researchable ground or issue could be identified. Please "
            "describe what happened, under which provision, and what relief "
            "you seek.")
        return [], {}

    # One extractor being empty is normal in combined mode — never block.
    context.needs_clarification = False
    context.clarification_question = None

    dropped = max(0, len(merged) - MAX_COMBINED_ITEMS)
    merged = merged[:MAX_COMBINED_ITEMS]
    for idx, item in enumerate(merged):
        item.id = idx + 1
    meta: dict[str, Any] = {
        "totalGrounds": sum(1 for i in merged if i.ground_label),
        "spottedIssues": sum(1 for i in merged if not i.ground_label),
        "documentType": grounds_meta.get("documentType"),
        "party": grounds_meta.get("party"),
        "notes": grounds_meta.get("notes") or [],
    }
    total_dropped = dropped + int(grounds_meta.get("truncatedGrounds") or 0)
    if total_dropped:
        # No silent caps: the UI tells the user how many items were cut.
        meta["truncatedGrounds"] = total_dropped
        logger.info("[combined] %d item(s) beyond the cap were dropped", total_dropped)
    return merged, meta


def _ground_note(issue: Issue) -> str:
    """Grounds mode: the pleaded ground's own summary + invoked provisions
    go into query generation, so every query is anchored to what the ground
    ACTUALLY argues (e.g. a repeal-and-savings ground over IPC→BNS must
    query repeal/savings law with both codes' provisions — not just the
    abstract 'Whether…?' question)."""
    if not issue.ground_label:
        return ""
    lines = [f"\n\nPLEADED GROUND ({issue.ground_label}) — build every query from THIS "
             "ground's doctrine and provisions:"]
    if issue.explanation:
        lines.append(issue.explanation[:1200])
    if issue.legal_framework:
        lines.append("PROVISIONS INVOKED BY THE GROUND: " + ", ".join(issue.legal_framework[:12]))
    if issue.case_law_cited:
        lines.append("CASE LAW CITED IN THE GROUND: " + "; ".join(issue.case_law_cited[:5]))
    lines.append(
        "Every anchor query MUST be anchored to one of these provisions or this "
        "ground's doctrine (with old/new-code equivalents per the mapping rule — "
        "e.g. a BNS/BNSS/BSA provision is also searched under its IPC/CrPC/"
        "Evidence Act equivalent and vice versa), so that every judgment fetched "
        "matches this ground. Draw the factual axis from the ground's own "
        "fact-specific averments above (the distinctive words a judgment on the "
        "SAME fact pattern would contain), so results match this exact case — "
        "never generic filler.")
    return "\n".join(lines)


def _wire_queries(keywords: KeywordSet) -> KeywordSet:
    """Store and display anchor/contra queries in Indian Kanoon's EXACT wire
    syntax (ANDD / ORR / NOTT, parentheses stripped) — what the card shows is
    byte-for-byte what hits the API. The model writes readable AND/OR/NOT;
    this deterministic pass converts it once, at generation time. Simple
    keyword queries pass through unchanged."""
    keywords.anchor_queries = [to_ik_operators(q) for q in keywords.anchor_queries]
    keywords.contra_queries = [to_ik_operators(q) for q in keywords.contra_queries]
    return keywords


def _merge_ground_statutes(keywords: KeywordSet, issue: Issue) -> KeywordSet:
    """Deterministic backstop for grounds mode: every provision the ground
    itself invokes joins the statutory axis (the LLM may drop one), so the
    shelf gate and keyword scoring always check the ground's OWN provisions
    against each fetched judgment. Long composite citations are skipped —
    as AND-of-words IK queries they match nothing."""
    if not issue.ground_label or not issue.legal_framework:
        return keywords
    existing = {t.strip().lower() for t in keywords.statutory}
    for statute in issue.legal_framework:
        term = statute.strip()
        if term and len(term.split()) <= 8 and term.lower() not in existing:
            existing.add(term.lower())
            keywords.statutory.append(term)
    return keywords


async def generate_queries(issue: Issue, context: CaseContext,
                           failed_queries: list[str] | None = None,
                           sibling_issues: list[str] | None = None,
                           style: str = "simple") -> KeywordSet:
    """Stage 2 on Claude (spec query-gen prompt): support anchors + contra
    queries + four lexical axes, built from doctrine + statutory hook +
    stage — never from party facts. Gemini keyword agent as fallback.
    In grounds mode the pleaded ground's summary + invoked provisions ride
    along, and those provisions are merged into the statutory axis after
    generation (deterministic — never lost to the model).

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
    ground_note = _ground_note(issue)
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
            f"{ground_note}"
            f"{siblings_note}"
            f"{retry_note}"
        )
        system = QUERY_GEN_SYSTEM_ADVANCED if style == "advanced" else QUERY_GEN_SYSTEM_SIMPLE
        result = await claude_parse(system, user, KeywordSet, max_tokens=4000)
        if result is not None and result.all_terms():
            return _wire_queries(_merge_ground_statutes(result, issue))
        logger.warning("[claude] query generation unavailable — Gemini keyword fallback")
    keyword_message = (
        f"Case summary (context only):\n{context.raw_case_summary}\n\n"
        f"Legal issue to generate search terms for:\n{issue.issue}"
        f"{ground_note}"
        f"{retry_note}"
    )
    out = await run_agent_once(build_keyword_extract_agent(style), keyword_message, ["keywords"])
    return _wire_queries(_merge_ground_statutes(
        KeywordSet.model_validate(out.get("keywords") or {}), issue))


# ─── Per-issue pipeline (Stage 2 → fetch → rerank → layers → score) ──────────

async def _issue_round(issue: Issue, context: CaseContext, keywords: KeywordSet,
                       exclude: set[str] | None = None,
                       anchors_only: bool = False) -> dict[str, Any]:
    """One complete fetch → rerank → verify → score round for one issue.
    Returns {candidates, scored}; the caller decides whether to retry with
    reformulated queries when nothing usable survives. anchors_only: the
    user hand-picked this issue's queries — fetch with exactly those."""
    settings = get_settings()

    # IK fetch — union across anchor/contra/axis queries, dedupe, cap.
    # The court the case itself points at (forum field, else the HC named
    # in the case material — Maharashtra → Bombay HC) gets its own
    # targeted anchor searches and top placement.
    forum_profile = case_court_profile(
        context.forum, f"{context.procedural_history} {context.raw_case_summary}")
    pool = await ik_client.fanout_and_fetch(
        keywords, exclude=exclude,
        forum_doctype=(forum_profile or {}).get("doctype"),
        anchors_only=anchors_only)
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
    # Support (petitioner-side) authorities lead; within a side, the
    # client's OWN High Court first (binding at the forum), then bench-wise
    # (Supreme Court → High Courts → tribunals → district), top score first.
    # Contra follow clearly labelled; red-flagged (overruled) sink last.
    side_rank = {"support": 0, None: 1, "interim": 2, "contra": 3}
    court_by_id = {c.doc_id: c.court for c in pool}
    surfaced.sort(key=lambda r: (r.red_flag, side_rank.get(r.side, 1),
                                 forum_court_rank(court_by_id.get(r.doc_id, ""),
                                                  forum_profile), -r.score))
    surfaced = surfaced[:MAX_RESULTS_PER_ISSUE]

    return {
        "candidates": {c.doc_id: c for c in pool},
        "scored": surfaced,
    }


async def _process_issue(issue: Issue, context: CaseContext,
                         pre_keywords: KeywordSet | None = None,
                         curated: bool = False,
                         query_style: str = "simple") -> dict[str, Any]:
    """Per-issue pipeline with automatic query reformulation: if the first
    round yields NO usable judgment for this issue, a genuinely different
    query set is generated (for this issue only) and one more round runs —
    already-fetched documents are excluded, so only fresh candidates are
    read. Still empty after the retry → honest empty list.
    curated: the user checked/typed this issue's queries — round 1 fetches
    with EXACTLY those; the reformulation retry (their queries found no
    usable judgment) falls back to a full generated set."""
    # Stage 2 — query generation (already done at analyze time for suggested
    # issues; generated live for custom/user-typed ones).
    keywords = pre_keywords if pre_keywords and pre_keywords.all_terms() \
        else await generate_queries(issue, context, style=query_style)
    if not keywords.all_terms():
        logger.warning("[pipeline] issue %s produced no keywords — skipping fetch", issue.id)
        return {"issue": issue, "keywords": keywords, "candidates": {}, "scored": []}

    round1 = await _issue_round(issue, context, keywords, anchors_only=curated)
    if round1["scored"]:
        return {"issue": issue, "keywords": keywords, **round1}

    # No usable judgment — reformulate ONCE for this issue and fetch fresh.
    tried = list(keywords.anchor_queries) + list(keywords.contra_queries) + keywords.all_terms()
    logger.info("[pipeline] issue %s: no usable judgment — reformulating queries and retrying",
                issue.id)
    retry_keywords = await generate_queries(issue, context, failed_queries=tried,
                                            style=query_style)
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
                       curated_ids: set[str] | None = None,
                       query_style: str = "simple",
                       ) -> list[dict[str, Any]]:
    """Dynamic-cardinality fan-out: one per-issue pipeline per issue, run
    concurrently. IK rate limiting is enforced inside the shared client
    semaphore, not here. One issue failing never kills the request.
    curated_ids: issues whose queries the user hand-picked — those fetch
    with exactly their selected queries."""
    keywords_map = keywords_map or {}
    curated_ids = curated_ids or set()

    async def _safe(issue: Issue) -> dict[str, Any]:
        try:
            return await _process_issue(issue, context, keywords_map.get(str(issue.id)),
                                        curated=str(issue.id) in curated_ids,
                                        query_style=query_style)
        except Exception:
            logger.exception("[pipeline] issue %s failed", issue.id)
            return {"issue": issue, "keywords": None, "candidates": {}, "scored": []}

    return list(await asyncio.gather(*(_safe(i) for i in issues[:MAX_ISSUES])))


# ─── Response assembly (deterministic) ───────────────────────────────────────

def _chips(cand: Candidate, result: ScoredResult, court_label: str,
           own_court: bool = False) -> list[str]:
    chips = [court_label]
    if own_court:
        chips.append("your High Court — binding")
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
    forum_profile = case_court_profile(
        context.forum, f"{context.procedural_history} {context.raw_case_summary}")

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
                chips=_chips(cand, result, court_label,
                             own_court=is_forum_high_court(cand.court, forum_profile)),
            ))
        keywords = entry.get("keywords")
        issues_out.append(IssueResults(id=issue.id, issue=issue.issue,
                                       title=issue.title,
                                       groundLabel=issue.ground_label,
                                       keywords=keywords, results=items))
        session_issues.append({
            "id": issue.id,
            "issue": issue.issue,
            "title": issue.title,
            "groundLabel": issue.ground_label,
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
        forumCourt=(forum_profile or {}).get("label"),
    )
    existing = sessions.load(session_id) or {}
    existing.update({
        "caseContext": context.model_dump(),
        "issues": session_issues,
        "forumCourt": (forum_profile or {}).get("label"),
    })
    sessions.save(session_id, existing)
    return response


# ─── Root pipeline ────────────────────────────────────────────────────────────

async def analyze_case(raw_text: str, source_text: str | None = None,
                       pages: list[SourcePage] | None = None,
                       mode: str = "issues",
                       objective: str | None = None,
                       query_style: str = "simple",
                       ) -> tuple[str, CaseContext, list[Issue], dict[str, Any]]:
    """Phase 1: Agentic Document Context Service (classify → extract via ADK
    SequentialAgent, then deterministic completeness + anti-invention guard)
    followed by Stage 1 — issue spotting, or grounds extraction when
    mode='grounds'. No Indian Kanoon spend happens here. The analysis is
    persisted to the session so /search/run can pick it up. Returns
    (session_id, context, issues, grounds_meta) — grounds_meta is {} in
    issues mode."""
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
    grounds_meta: dict[str, Any] = {}
    # Ambiguous input → ask, never guess (Phase D hook, live now).
    if not context.needs_clarification:
        # Stage 1: combined extractor (pleaded grounds + spotted issues in
        # one pass — frontend default), grounds extractor, or issue
        # spotter — all on Claude with a Gemini fallback inside.
        if mode == "combined":
            issues, grounds_meta = await extract_combined(raw_text, context)
        elif mode == "grounds":
            issues, grounds_meta = await extract_grounds(raw_text, context)
        elif mode == "fresh":
            # Unfiled matter: proposed grounds anchored to the lawyer's
            # stated objective instead of pleaded grounds.
            issues, grounds_meta = await extract_fresh(raw_text, context, objective or "")
        else:
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
                *(generate_queries(i, context, sibling_issues=_siblings(i),
                                   style=query_style) for i in issues))
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
        "researchMode": mode,
        "queryStyle": query_style,
        "groundsMeta": grounds_meta,
    })
    return session_id, context, issues, grounds_meta


MAX_QUERIES_PER_ISSUE = 8


def apply_query_overrides(keywords_map: dict[str, KeywordSet],
                          overrides: dict[str, list[str]] | None) -> dict[str, KeywordSet]:
    """User query curation: the checked system queries plus any user-typed
    ones REPLACE the issue's anchor queries — user-typed queries get the
    exact same treatment as generated anchors (2× hit weight, deeper take,
    forum-restricted re-run, keyword-signal bonus). Contra queries and the
    four lexical axes still run unchanged. An empty list is honoured — the
    user deselected everything, so only axes/contra fetch for that issue."""
    for issue_id, chosen in (overrides or {}).items():
        kw = keywords_map.get(str(issue_id))
        if kw is None:
            continue  # custom issues generate live; nothing stored to override
        cleaned: list[str] = []
        for query in chosen:
            text = (query or "").strip()
            if text and text not in cleaned:
                cleaned.append(text)
        kw.anchor_queries = cleaned[:MAX_QUERIES_PER_ISSUE]
    return keywords_map


async def run_issue_search(session_id: str, context: CaseContext,
                           issues: list[Issue],
                           query_overrides: dict[str, list[str]] | None = None,
                           ) -> SearchResponse:
    """Phase 2: per-issue fan-out (Stage 2 → fetch → rerank → layers →
    score), then CitationGuardian + assembler — deterministic, always on,
    no bypass. Keywords generated at analyze time are reused here, after
    the user's per-issue query selection (checkboxes + own queries) is
    applied on top."""
    keywords_map: dict[str, KeywordSet] = {}
    session = sessions.load(session_id) or {}
    for issue_id, dump in (session.get("issueKeywords") or {}).items():
        try:
            keywords_map[str(issue_id)] = KeywordSet.model_validate(dump)
        except Exception:
            logger.warning("[pipeline] stored keywords for issue %s invalid — regenerating", issue_id)
    keywords_map = apply_query_overrides(keywords_map, query_overrides)
    curated_ids = {str(issue_id) for issue_id in (query_overrides or {})}
    fanout_results = await issue_fanout(issues, context, keywords_map,
                                        curated_ids=curated_ids,
                                        query_style=session.get("queryStyle", "simple"))
    return assemble_response(session_id, context, fanout_results)


async def run_search_pipeline(raw_text: str, source_text: str | None = None,
                              mode: str = "issues") -> SearchResponse:
    """The one-shot root orchestrator (spec Sections 4 and 11): document
    context → issue split (or grounds extraction) → fan-out → guardian →
    assembler."""
    session_id, context, issues, _meta = await analyze_case(raw_text, source_text, mode=mode)
    if context.needs_clarification:
        return SearchResponse(
            sessionId=session_id,
            needsClarification=True,
            clarificationQuestion=context.clarification_question,
            caseContext=context,
            issues=[],
        )
    return await run_issue_search(session_id, context, issues)
