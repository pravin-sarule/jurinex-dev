"""
Every Pydantic contract in the judgement-service search pipeline.

The `signals` object on a result is the explainability contract: whatever
per-signal breakdown the scorer produced is passed through untouched, and
consumers render one chip per key — new precision layers appear as new
keys, never as schema changes.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

Band = Literal["GREEN", "YELLOW", "RED"]
PartyFit = Literal["favourable", "adverse", "neutral"]


# ─── Section 5: Agentic Document Context Service ────────────────────────────

class CaseContext(BaseModel):
    document_type: Literal["petition", "judgment", "brief", "note", "mixed"]
    # quashing / bail / discharge / leave to defend / trial / appeal / writ /
    # execution — set by the issue spotter; every issue is framed at this
    # stage's standard of review and the judge scores stage-match.
    procedural_stage: str | None = None
    # The court seised of the matter (e.g. "Bombay High Court, Aurangabad
    # Bench") — drives binding-vs-persuasive reasoning in adversarial prep.
    forum: str | None = None
    parties: dict[str, str] = Field(default_factory=dict)
    facts: str = ""
    procedural_history: str = ""
    relief_sought: str = ""
    raw_case_summary: str = ""  # feeds issue_split_agent
    needs_clarification: bool = False
    clarification_question: str | None = None
    source_confidence: Literal["high", "medium", "low"] = "medium"
    # User-locked client side: 'petitioner'/'respondent' forces every
    # ground/issue perspective, steers query outcomes to that side, and
    # drops adverse (contra) judgments from the surfaced results. None =
    # the system infers the side from the case material (behaviour before
    # this field existed).
    client_role: Literal["petitioner", "respondent"] | None = None


class DocClassification(BaseModel):
    """Output of the classify step (LlmAgent, low temp)."""
    document_type: Literal["petition", "judgment", "brief", "note", "mixed"]
    reason: str = ""


class PartyEntry(BaseModel):
    role: str  # e.g. "petitioner", "respondent", "applicant", "State"
    name: str


class CaseContextDraft(BaseModel):
    """Raw extraction output, before the deterministic completeness check
    and anti-invention guard produce the final CaseContext.

    NOTE: this model is a Gemini response_schema — it must stay free of
    open-ended dicts (additionalProperties is rejected by the Developer
    API), hence parties is a typed list here and a dict on CaseContext."""
    parties: list[PartyEntry] = Field(default_factory=list)
    facts: str = ""
    procedural_history: str = ""
    relief_sought: str = ""
    raw_case_summary: str = ""


# ─── Stage 1: Issue split ────────────────────────────────────────────────────

class Issue(BaseModel):
    id: int
    issue: str
    # Standardized ground name (e.g. "Civil Dispute Given Criminal Colour")
    # + a 2–3 sentence fact-specific explanation, for display.
    title: str | None = None
    explanation: str | None = None
    # ── Grounds mode extras (None/[] in issues mode) ──
    # The document's own label for the ground, verbatim ("Ground A",
    # "Ground 1(a)", "Ground [Implied]" when not numbered in the source).
    ground_label: str | None = None
    # Statutes/articles/sections the ground invokes + case law it cites,
    # copied exactly as written in the source (never expanded or guessed).
    legal_framework: list[str] = Field(default_factory=list)
    case_law_cited: list[str] = Field(default_factory=list)
    # The extractor's own citation of where the ground sits in the document
    # (e.g. "Page 4, Para 12" or "Section: 'Grounds of Appeal', Para 3").
    # Display-only — the deterministic `source` ref below remains the
    # mechanically-attributed one.
    ground_ref: str | None = None
    # Extraction confidence for THIS ground: high | medium | low.
    confidence: str | None = None
    # Doctrine label + statutory hook drive query generation and the judge's
    # doctrine-link guard — queries are built from these, never from party facts.
    doctrine: str | None = None
    statutory_hook: str | None = None
    # The SPECIFIC trigger/test within the doctrine (e.g. for s.482 quashing:
    # civil_colour | settlement | mala_fide | statutory_bar |
    # vicarious_liability | delay_laches | second_fir). Drives the verifier's
    # trigger KILL check: a judgment matching the statute but decided on a
    # DIFFERENT trigger (e.g. a compromise quashing cited for civil-colour)
    # is rejected however similar its vocabulary.
    sub_doctrine: str | None = None
    # Whose issue this is ("petitioner"/"respondent"/"neutral") — outcome
    # alignment (support vs contra) is judged against this perspective.
    perspective: str | None = None
    # The IK queries for this issue (support anchors + contra), generated at
    # analyze time so the UI can show them under the issue title; reused at
    # search time so nothing is generated (or billed) twice.
    queries: list[str] = Field(default_factory=list)
    # "filename, page N" — attributed DETERMINISTICALLY (lexical overlap
    # against per-page source text), never by the LLM, so it can't be invented.
    source: str | None = None


class IssueList(BaseModel):
    issues: list[Issue]


class SpottedIssue(BaseModel):
    """One issue as produced by the Claude issue spotter (ids are assigned
    in code afterwards; `source` is never LLM-written)."""
    title: str = ""        # standardized ground name
    issue: str             # "Whether …?" question — drives precedent search
    explanation: str = ""  # 2–3 sentences tying the ground to THIS case's facts
    doctrine: str = ""
    sub_doctrine: str = ""  # specific trigger within the doctrine (snake_case)
    statutory_hook: str | None = None
    perspective: str = "neutral"


class IssueSpotResult(BaseModel):
    """Claude issue-spotter output: procedural stage first, then issues
    framed at that stage's standard of review."""
    procedural_stage: str = ""
    forum: str = ""  # the specific court seised, when the material shows it
    insufficient_material: bool = False
    issues: list[SpottedIssue] = Field(default_factory=list)


class SourcePage(BaseModel):
    """One page (or chunk) of a source document, used for issue attribution."""
    file: str
    page: int
    text: str


# ─── Grounds mode: grounds extraction (alternative to issue spotting) ────────

class ExtractedGround(BaseModel):
    """One ground of challenge/appeal as pleaded in the case document,
    extracted verbatim-grounded (never invented) by the grounds extractor.
    Bridges the pleaded ground to precedent search via research_question +
    doctrine + statutory_hook — the same contract the issue pipeline uses.

    NOTE: doubles as a Gemini response_schema — typed lists only, no open
    dicts (additionalProperties is rejected by the Developer API)."""
    ground_label: str = ""     # the document's own label, verbatim
    title: str = ""            # short descriptive title of the ground
    summary: str = ""          # 100–200 word self-contained summary
    # ONE-sentence "Whether …?" question capturing the ground's legal
    # contention — this text drives downstream precedent search.
    research_question: str = ""
    doctrine: str = ""
    sub_doctrine: str = ""  # specific trigger within the doctrine (snake_case)
    statutory_hook: str | None = None
    statutes: list[str] = Field(default_factory=list)       # as written in source
    case_law_cited: list[str] = Field(default_factory=list)  # as written in source
    source_reference: str = ""  # e.g. "Page 4, Para 12" from the document itself
    confidence: Literal["high", "medium", "low"] = "medium"
    perspective: str = "petitioner"
    # Combined mode: whether this item was actually PLEADED in the filing
    # (ground_label verbatim) or SPOTTED by the system on top of the
    # pleadings. Fresh mode marks system-formulated grounds for an unfiled
    # matter as PROPOSED. Pure grounds mode leaves the default.
    origin: Literal["pleaded", "spotted", "proposed"] = "pleaded"


class GroundsExtractResult(BaseModel):
    """Grounds extractor output: document metadata + every distinct ground
    (sub-grounds kept separate, never merged)."""
    document_type_label: str = ""   # e.g. "Writ Petition", "SLP", "Appeal"
    party: str = ""                 # whose grounds these are
    forum: str = ""                 # court seised, when the material shows it
    procedural_stage: str = ""
    insufficient_material: bool = False
    grounds: list[ExtractedGround] = Field(default_factory=list)
    # Ambiguities / illegible passages / unclear references worth flagging.
    notes: list[str] = Field(default_factory=list)


# ─── Stage 2: Keyword extraction (four axes) ─────────────────────────────────

class KeywordSet(BaseModel):
    doctrinal: list[str] = Field(default_factory=list)
    statutory: list[str] = Field(default_factory=list)
    factual: list[str] = Field(default_factory=list)
    outcome: list[str] = Field(default_factory=list)
    # Complete high-precision IK queries (statute hook + doctrine [+ fact]),
    # searched with extra weight — these find the leading line of cases.
    # Built with SUPPORT outcome words (matching the client's perspective).
    anchor_queries: list[str] = Field(default_factory=list)
    # CONTRA queries: same doctrine + statute with the OPPOSITE outcome words
    # ("dismissed", "refused") — lawyers must know the adverse line too. The
    # verified outcome, never the query role, decides a result's final side.
    contra_queries: list[str] = Field(default_factory=list)

    def all_terms(self) -> list[str]:
        seen: set[str] = set()
        out: list[str] = []
        for axis in (self.doctrinal, self.statutory, self.factual, self.outcome):
            for term in axis:
                key = term.strip().lower()
                if key and key not in seen:
                    seen.add(key)
                    out.append(term.strip())
        return out


# ─── Relevance judge (grounded verification of fetched judgments) ───────────

class JudgmentProfile(BaseModel):
    """v3 STEP A — blind characterisation of the judgment, filled BEFORE the
    issue is considered (anti-anchoring). All values come from the judgment's
    own words only."""
    proceeding_type: str = ""    # suit_first_instance | first_appeal | ... | other
    decisional_lens: str = ""    # de_novo | deferential_review | threshold_only
    question_decided: str = ""   # one sentence, as the court would phrase it
    trigger_condition: str = ""  # the condition that activated the court's power
    relief_head: str = ""        # exact head of relief in issue in THIS judgment
    operative_basis: str = ""    # the reason that actually produced the order


class ScoreBreakdown(BaseModel):
    """v3 scoring arithmetic — every component and cap, machine-re-verified in
    tools.enforce_verifier_rules (a final_score inconsistent with the
    deterministic recompute is overridden)."""
    trigger_points: int = 0      # sub-doctrine/trigger match (max 30)
    lens_points: int = 0         # decisional lens match (max 15)
    relief_head_points: int = 0  # relief-head match (max 10)
    shelf_points: int = 0        # field of law + statute match (max 10)
    ratio_points: int = 0        # ratio located AND load-bearing (max 15)
    stage_points: int = 0        # procedural stage match (max 10)
    forum_points: int = 0        # bindingness: SC 10 | same HC DB 9 | same HC SJ 7 | other HC 3 | subordinate 1
    caps_applied: list[str] = Field(default_factory=list)
    component_sum: int = 0
    final_score: int = 0


class JudgmentVerification(BaseModel):
    """PROMPT-3 verifier output (v3): can a lawyer actually STAND UP AND CITE
    this ONE fetched judgment IN COURT for this ONE issue? Judged only from
    the fetched text (closed world). Kill gates: outcome unclear, decisional
    lens (deferential-review judgments are not authority on first-instance
    substantive questions), shelf mismatch, relief-head mismatch,
    trigger/sub-doctrine mismatch (with the abstraction-ladder rule),
    parasitic authority (independent of the trigger gate), marginal utility.
    Everything is re-verified deterministically in code: outcome_evidence
    must be a verbatim substring; lens_match=False / relief_head_match=False /
    trigger_match=False / parasitic=True / a genus abstraction_test_phrase all
    force reject; the score is recomputed from components + caps (persuasive
    forum 70, stage 65, lens 45, obiter 40, no ratio 30, currency doubt 60),
    <60 rejects, and 90+ requires binding forum + full match; the SIDE is
    re-derived from the verified outcome + the issue's perspective. Court,
    date and authority weight come from IK metadata, never the model."""
    verdict: Literal["support", "contra", "interim", "reject"] = "reject"
    score: int = 0  # final score after caps — recomputed deterministically in code
    # v3 STEP A/B: blind judgment profile + issue anatomy.
    judgment_profile: JudgmentProfile = Field(default_factory=JudgmentProfile)
    issue_relief_head: str = ""             # the issue's relief head (Step B vocabulary)
    inferred_sub_doctrine_basis: str = ""   # issue words the sub-doctrine was inferred from
    outcome: Literal["relief_granted", "relief_refused", "partly",
                     "interim_only", "remanded", "unclear"] = "unclear"
    outcome_evidence: str = ""     # VERBATIM operative line, substring-verified
    doctrine_link: str = ""        # one line naming the doctrinal connection
    # v2 trigger check: the SPECIFIC condition that triggered the court's
    # power in THIS judgment (e.g. "settlement", "civil_colour"), and
    # whether it matches the issue's sub_doctrine. A settlement quashing
    # cited for a civil-colour issue fails here whatever its vocabulary.
    trigger_condition: str = ""
    trigger_match: bool = True
    # v3 K2: deferential-review / threshold judgments are not authority on a
    # first-instance substantive question (the arbitration/writ trap).
    lens_match: bool = True
    # v3 K4: the judgment's relief head must be the ISSUE's relief head
    # (debt for work done ≠ loss-of-bargain damages ≠ LD ≠ restitution …).
    relief_head_match: bool = True
    # v3 K5 abstraction-ladder audit: the "both are about ______" phrase the
    # model used to claim the trigger match — genus phrases are auto-rejected.
    abstraction_test_phrase: str = ""
    # v3 parasitic check (INDEPENDENT of the trigger gate): on-point language
    # only QUOTED from an earlier authority → reject and name the quoted case.
    parasitic: bool = False
    cite_source_instead: str | None = None
    stage_match: bool = True
    # v3 K7 counterfactual test: would the operative order change if the court
    # had held the opposite on the cited proposition? False = obiter (cap 40).
    load_bearing: bool = True
    ratio_para: str | None = None  # e.g. "para 14" — null when no ratio located
    ratio_summary: str | None = None
    distinguish_risk: str | None = None  # the point the opponent will raise
    # v2 currency flag (never a KILL): appealed/stayed/doubted/referred
    # indications found in the text, or an explicit could-not-verify note.
    currency_note: str = ""
    # Adversarial prep: the strongest objection opposing counsel will raise
    # against citing this judgment (incl. binding-vs-persuasive forum), and
    # how to meet it. Grounded on the judgment + the client's stated forum.
    opponent_argument: str = ""
    counter_strategy: str = ""
    # v2: how counsel should distinguish this judgment when the OPPONENT
    # cites it (contra results only).
    contra_handling: str | None = None
    # v2: the precise, narrow proposition this judgment may be cited for,
    # drawn from the ratio; scope limit when only a sub-part is usable.
    usable_for: str | None = None
    usable_scope_limit: str | None = None
    # v3 scoring arithmetic + output discipline.
    score_breakdown: ScoreBreakdown = Field(default_factory=ScoreBreakdown)
    include_in_output: bool = True
    reject_reason: str | None = None


# ─── Indian Kanoon candidates ────────────────────────────────────────────────

class Candidate(BaseModel):
    doc_id: str
    title: str = ""
    court: str = ""
    year: int | None = None
    headline: str = ""           # search snippet — the re-rank segment
    num_citedby: int = 0
    source_url: str = ""
    matched_terms: list[str] = Field(default_factory=list)
    doc_text: str | None = None  # full text, fetched only for top-N
    # True when this candidate came from the local JuriNex library (ES)
    # instead of a billed Indian Kanoon search — shown on the card.
    from_library: bool = False
    # Explainability payload from the ES legal engine (internal — never
    # user-facing): esScore, finalScore, matchedPhrases, matchedParagraphs.
    es_meta: dict[str, Any] | None = None


# ─── Scoring ─────────────────────────────────────────────────────────────────

class SignalSet(BaseModel):
    semantic_match: float = 0.0
    keyword_match: float = 0.0
    ai_relevance: float | None = None  # judge verdict (0–1), when doc was judged
    authority: float | None = None
    good_law_status: float | None = None
    good_law_status_label: str | None = None  # "valid"|"overruled"|"review"|None
    party_fit: float | None = None
    party_fit_label: PartyFit | None = None
    fact_match: float | None = None


class ScoredResult(BaseModel):
    doc_id: str
    score: float
    red_flag: bool = False
    band: Band = "RED"
    breakdown: SignalSet
    pinpoint: str | None = None
    pinpoint_ref: str | None = None  # e.g. "para 34"
    # support / contra / interim / None — derived from the VERIFIED outcome
    # vs the issue's perspective, never from which query found the doc.
    side: str | None = None
    outcome_evidence: str | None = None  # verbatim, substring-verified
    doctrine_link: str | None = None
    distinguish_risk: str | None = None
    opponent_argument: str | None = None
    counter_strategy: str | None = None


# ─── API response contract (Section 11) ─────────────────────────────────────

class ResultItem(BaseModel):
    docId: str
    title: str
    court: str
    year: int | None = None
    band: Band
    score: float
    redFlag: bool = False
    pinpoint: str | None = None
    url: str = ""
    headline: str = ""                 # IK search snippet, shown on review cards
    matchedTerms: list[str] = Field(default_factory=list)  # queries that hit this doc
    fromLibrary: bool = False          # served by the JuriNex library, not IK
    # support / contra / interim / None + the verbatim disposal phrase that
    # proves the outcome (substring-verified against the fetched text).
    side: str | None = None
    outcomeEvidence: str | None = None
    # Verifier extras a lawyer needs on the card: the named doctrinal
    # connection, and the point the opponent is likely to distinguish on.
    doctrineLink: str | None = None
    distinguishRisk: str | None = None
    # Adversarial prep: what the opposing lawyer will argue against this
    # citation, and how to counter it.
    opponentArgument: str | None = None
    counterStrategy: str | None = None
    # Signal-agnostic explainability: render one chip per key present.
    signals: dict[str, Any] = Field(default_factory=dict)
    chips: list[str] = Field(default_factory=list)


class IssueResults(BaseModel):
    id: int
    issue: str
    title: str | None = None  # standardized ground name for compact display
    # Verbatim pleaded-ground label ("Ground A") when this research unit is
    # a pleaded ground — the results UI groups grounds and issues into
    # separate sidebar sections on this.
    groundLabel: str | None = None
    keywords: KeywordSet | None = None
    results: list[ResultItem] = Field(default_factory=list)


class SearchResponse(BaseModel):
    sessionId: str
    needsClarification: bool = False
    clarificationQuestion: str | None = None
    caseContext: CaseContext | None = None
    issues: list[IssueResults] = Field(default_factory=list)
    guardianDropped: int = 0  # count only — dropped docIds never surface
    # The client's own High Court inferred from the forum (e.g. "Bombay High
    # Court" for a Maharashtra matter) — its judgments are ranked first.
    forumCourt: str | None = None


# ─── API request contracts ───────────────────────────────────────────────────

class CaseInput(BaseModel):
    text: str | None = None
    fileRef: str | None = None  # local path or URL to an uploaded document


# How suggested research items are derived from the case material:
#   combined — ONE pass extracting the grounds pleaded in the filing AND
#              spotting every additional issue the material supports,
#              merged into a single deduplicated list (frontend default)
#   issues  — issue spotter only (legacy)
#   grounds — grounds extractor only (legacy)
#   fresh   — fresh matter with NO drafted pleading: the case's source
#             documents + the lawyer's stated objective drive PROPOSED
#             grounds (what the filing should argue), then the identical
#             pipeline runs
ResearchMode = Literal["issues", "grounds", "combined", "fresh"]


# Query style: "simple" (default — quoted phrases + bare words, implicit AND)
# or "advanced" (explicit Boolean AND/OR/NOT — the UI's Advanced search toggle).
QueryStyle = Literal["simple", "advanced"]


class SearchRequest(BaseModel):
    caseInput: CaseInput
    mode: ResearchMode = "issues"
    queryStyle: QueryStyle = "simple"
    role: Literal["petitioner", "respondent"] | None = None


class RefineRequest(BaseModel):
    issueId: int
    mode: Literal["facet", "keyword", "semantic", "ik_escape"]
    query: str = ""
    # facet mode filters
    court: str | None = None
    yearFrom: int | None = None
    yearTo: int | None = None
    band: Band | None = None


class AnalyzeResponse(BaseModel):
    """Phase 1 of the interactive flow: document context + system-suggested
    issues, before any Indian Kanoon spend. The user then selects any of
    the suggested issues and/or adds their own, and calls /search/run."""
    sessionId: str
    caseContext: CaseContext
    suggestedIssues: list[Issue] = Field(default_factory=list)
    needsClarification: bool = False
    clarificationQuestion: str | None = None
    caseId: str | None = None      # set when analysis came from a stored case
    caseTitle: str | None = None
    # Which extractor produced suggestedIssues (issues | grounds) + the
    # grounds extraction metadata (total, document type, notes) when the
    # grounds extractor ran.
    researchMode: ResearchMode = "issues"
    groundsMeta: dict[str, Any] | None = None


class AnalyzeCaseRequest(BaseModel):
    """Analyze one of the user's existing cases (agentic document service).
    text carries an optional extra instruction from the lawyer. userId is
    a fallback for the X-User-Id header (the document service scopes
    folder listings by user)."""
    caseId: str
    text: str | None = None
    userId: str | None = None
    mode: ResearchMode = "issues"
    queryStyle: QueryStyle = "simple"
    role: Literal["petitioner", "respondent"] | None = None


class AnalyzeCaseFreshRequest(BaseModel):
    """Fresh-matter research (own route): the case has NO drafted pleading
    yet. ALL of the case's source documents are pulled from the document
    service, and `objective` — what the client wants, in the lawyer's own
    words — drives the proposed grounds. objective is REQUIRED: without it
    there is nothing to anchor a fresh matter's research to."""
    caseId: str
    objective: str
    userId: str | None = None
    queryStyle: QueryStyle = "simple"
    role: Literal["petitioner", "respondent"] | None = None


class CourtScope(BaseModel):
    """Court restriction for one search run (the issues-step Advanced search
    boxes): any combination of the three. Nothing selected = the service's
    default doctypes (env IK_DOCTYPES) — behaviour unchanged."""
    supremeCourt: bool = False   # box 1 — Supreme Court judgments
    caseCourt: bool = False      # box 2 — the case's own High Court (all HCs when undetectable)
    courts: list[str] = Field(default_factory=list)  # box 3 — explicit IK doctype tokens


class RunSearchRequest(BaseModel):
    """Phase 2: run retrieval for chosen issues. issueIds pick from the
    session's suggested issues (omit → all); customIssues are the user's
    own questions, searched separately with their own ids.
    queryOverrides: issue id (as string) → the FINAL anchor-query list for
    that issue — the system queries the user kept checked plus any queries
    they typed themselves, used exactly like generated anchors. Issues
    absent from the map run with their full stored query set."""
    issueIds: list[int] | None = None
    customIssues: list[str] = Field(default_factory=list)
    queryOverrides: dict[str, list[str]] = Field(default_factory=dict)
    courtScope: CourtScope | None = None
    # Date range for this run — every query gets fromdate:/todate: when set.
    fromdate: str = ""   # DD-MM-YYYY (YYYY-MM-DD also accepted)
    todate: str = ""


class AddIssueRequest(BaseModel):
    """A user-typed issue/ground added to an analysed session — it gets the
    same enrichment + query generation as system-suggested issues."""
    text: str


class AdvancedSearchRequest(BaseModel):
    """Direct Indian Kanoon advanced search — no agents, no verification
    pipeline. Every criterion is optional; the filled ones are combined into
    ONE formInput using IK's documented directives (title:, cite:, author:,
    bench:, doctypes:, fromdate:, todate:, sortby:) and results come back
    exactly as IK returns them, 10 per page."""
    query: str = ""      # keywords / phrases anywhere in the document
    title: str = ""      # words that must appear in the document title
    cite: str = ""       # citation filter, e.g. "1993 AIR"
    author: str = ""     # judge who authored the judgment
    bench: str = ""      # judge who sat on the bench
    doctypes: str = ""   # comma-separated IK doctype tokens
    fromdate: str = ""   # DD-MM-YYYY (YYYY-MM-DD also accepted)
    todate: str = ""     # DD-MM-YYYY (YYYY-MM-DD also accepted)
    sortby: Literal["relevance", "mostrecent", "leastrecent"] = "relevance"
    pagenum: int = 0
    # Local-library engine mode: 'strict' = every quoted phrase required;
    # 'flexible' = BM25 + phrase boosts for natural-language queries;
    # 'auto' picks strict when the query carries quoted phrases/citations.
    searchMode: Literal["auto", "strict", "flexible"] = "auto"


# ─── Per-citation report (VIEW → Report tab) ────────────────────────────────

class CitationAnalysis(BaseModel):
    """LLM-drafted analysis of ONE judgment against ONE issue. The prompt is
    grounded: only the provided judgment text may be used, nothing added.
    (The citation itself was already mechanically verified upstream.)"""
    why_this_helps: str = ""
    key_legal_issues: list[str] = Field(default_factory=list)
    key_facts: list[str] = Field(default_factory=list)
    legal_analysis: list[str] = Field(default_factory=list)
    ratio_decidendi: str = ""


class CaseSummaryLine(BaseModel):
    """One numbered line of the 8-line structured case note."""
    label: str = ""
    text: str = ""


class JudgmentCaseSummary(BaseModel):
    """Advocate-grade case summary of ONE judgment (user-locked format):
    a single-paragraph 95–105-word summary + an exactly-8-line structured
    note. Grounded on the fetched judgment text ONLY; details the text does
    not state must read "not stated in the judgment" — never guessed."""
    summary100: str = ""
    note: list[CaseSummaryLine] = Field(default_factory=list)
    verify_line: str = ""


class CitationReport(BaseModel):
    docId: str
    issueId: int
    issue: str = ""
    title: str = ""
    court: str = ""
    publishDate: str = ""
    author: str = ""
    bench: list[str] = Field(default_factory=list)
    url: str = ""
    status: Literal["pending", "approved", "rejected"] = "pending"
    band: Band = "RED"
    applicabilityStrength: Literal["Strong", "Moderate", "Weak"] = "Weak"
    # Deterministic measures — never LLM-estimated:
    # semanticMatch: cosine of issue vs judgment segment (0–1)
    # factualRelevance: share of the case's distinctive fact terms that
    #                   actually appear in this judgment's text (0–1)
    semanticMatch: float = 0.0
    factualRelevance: float = 0.0
    signals: dict[str, Any] = Field(default_factory=dict)
    excerpt: str | None = None
    matchedTerms: list[str] = Field(default_factory=list)
    citesTotal: int = 0
    citedByTotal: int = 0
    casesCitedSample: list[dict[str, str]] = Field(default_factory=list)
    citedBySample: list[dict[str, str]] = Field(default_factory=list)
    # Web-grounded status check (Google Search grounding): {status, note,
    # sources:[{title,uri}]}. Heuristic — always verify officially.
    goodLawCheck: dict[str, Any] = Field(default_factory=dict)
    analysis: CitationAnalysis = Field(default_factory=CitationAnalysis)
    # Advocate-grade judgment summary (100-word paragraph + 8-line note),
    # generated from the fetched judgment text and cached in the session.
    caseSummary: JudgmentCaseSummary = Field(default_factory=JudgmentCaseSummary)
    documentText: str = ""             # Document tab
    generatedOn: str = ""


class ReportStatusRequest(BaseModel):
    status: Literal["pending", "approved", "rejected"]


class RefinedItem(BaseModel):
    result: ResultItem
    matchesRefinement: bool = True
    demoted: bool = False  # de-emphasised, never deleted


class RefineResponse(BaseModel):
    sessionId: str
    issueId: int
    mode: str
    items: list[RefinedItem] = Field(default_factory=list)
    matchedCount: int = 0
    escapeHatch: dict[str, Any] | None = None
