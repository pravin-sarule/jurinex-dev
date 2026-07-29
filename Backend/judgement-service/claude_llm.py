"""
Claude API stages for the judgement-service pipeline.

Issue spotting and Indian Kanoon query generation run on Claude (structured
outputs, pydantic-validated, one retry with the error appended). Everything
is optional: if ANTHROPIC_API_KEY is missing or a call fails twice, callers
fall back to the existing Gemini agents — the pipeline never breaks.
"""

from __future__ import annotations

import asyncio
import logging
from typing import TypeVar

from pydantic import BaseModel

from config import get_settings

logger = logging.getLogger(__name__)

TModel = TypeVar("TModel", bound=BaseModel)

_client = None
_client_failed = False


def _get_client():
    global _client, _client_failed
    if _client is not None or _client_failed:
        return _client
    settings = get_settings()
    if not settings.claude_enabled:
        _client_failed = True
        return None
    try:
        import anthropic
        _client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    except Exception as exc:
        logger.error("[claude] SDK unavailable (%s) — Gemini fallback only", exc)
        _client_failed = True
    return _client


def claude_available() -> bool:
    return _get_client() is not None


def _parse_once(system: str, user: str, output_model: type[TModel],
                max_tokens: int, model: str | None = None) -> TModel:
    client = _get_client()
    settings = get_settings()
    response = client.messages.parse(
        model=model or settings.active_claude_model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
        output_format=output_model,
    )
    if response.stop_reason == "refusal":
        raise RuntimeError("Claude declined the request (stop_reason=refusal)")
    if response.parsed_output is None:
        raise RuntimeError("Claude returned no parsable structured output")
    return response.parsed_output


async def claude_parse(system: str, user: str, output_model: type[TModel],
                       max_tokens: int = 8000, model: str | None = None) -> TModel | None:
    """One structured-output Claude call, validated against `output_model`.
    On failure, retries ONCE with the error appended to the user message
    (spec rule); returns None after the second failure so the caller can
    fall back to Gemini. `model` overrides the default (e.g. Sonnet for the
    high-volume per-judgment verifier)."""
    if not claude_available():
        return None
    try:
        return await asyncio.to_thread(_parse_once, system, user, output_model,
                                       max_tokens, model)
    except Exception as first_error:
        logger.warning("[claude] %s call failed (%s) — retrying once",
                       output_model.__name__, first_error)
        try:
            retry_user = (f"{user}\n\nYour previous attempt failed validation with this "
                          f"error — correct it and return strict JSON matching the "
                          f"schema:\n{first_error}")
            return await asyncio.to_thread(_parse_once, system, retry_user,
                                           output_model, max_tokens, model)
        except Exception as second_error:
            logger.error("[claude] %s call failed twice (%s) — Gemini fallback",
                         output_model.__name__, second_error)
            return None


# ─── System prompts (adapted from the legal-research pipeline spec) ──────────

ISSUE_SPOTTER_SYSTEM = """Act as an expert Indian legal researcher and advocate specializing in criminal jurisprudence, writ petitions, and quashing applications (Section 482 CrPC / Section 528 BNSS), equally at home in civil and commercial litigation. You receive raw case material (case facts, plaint, FIR, documents or a summary) describing the CLIENT's matter. Extract the core legal issues/grounds suitable for challenging or defending the proceeding.

1. Identify 3 to 5 clear, distinct legal issues (never more than 6). An ISSUE is a question the court must answer — not a fact, a topic, an argument, or the relief itself. Test: a judge could write "I now turn to the question of whether…" and rule on it.
2. Ground everything in the material provided. Never invent a party, date, provision, or citation. If something is unknown, leave the field null — do not guess.
2a. THE CLIENT'S PRESENT CASE ONLY (critical). Case files routinely contain annexed judgments, orders, notices and pleadings from OTHER or EARLIER proceedings — those are background material, NOT sources of issues. Never generate an issue about what another court decided in another case, and never build an issue or its title around a case number, docket reference or annexure (an issue like "Effect of the rejection of the plan in W.P. No. 1981/2016" is WRONG). If an earlier round of litigation legally affects the present matter, frame it as the present case's doctrine — title "Bar of Res Judicata / Constructive Res Judicata", issue "Whether the present petition is barred by constructive res judicata in view of the earlier rejection…" — the doctrine is the subject, never the prior case. Every issue must be a question a court would decide IN THIS MATTER and must be researchable as precedent (a docket-specific question has no precedent value).
3. Identify the PROCEDURAL STAGE first (quashing / bail / discharge / leave to defend / injunction / trial / appeal / revision / writ / execution) and set forum: the specific court seised of (or about to be seised of) the matter, naming WHICH court whenever the material shows it (e.g. "Bombay High Court, Aurangabad Bench", "Sessions Court, Pune") — empty string if unknown. Frame every issue at that stage's standard of review. Threshold stages ask "whether the allegations, taken at their highest, disclose…" — never "whether the accused/defendant actually did…". Trial-stage issues carry the burden of proof.
4. For each issue give:
   - title: a standardized, formal ground name a practitioner would recognise (e.g. "Civil Dispute Given Criminal Colour", "Counterblast Proceedings", "Omnibus Allegations Against Relatives", "Vague and General Allegations"). Statutory references ARE welcome in titles — "Ingredients of Forgery (467, 468, 471 IPC) Not Made Out", "Counterblast FIR (After Section 138 NI Act / Summary Suit)" — but NEVER a party name, case/docket number, or date.
   - issue: ONE sentence starting "Whether …?", neutral. Never recite a party's contention inside the question; never embed a legal conclusion (mandatory, void, mala fide) in it — that is for the court. Name the governing provision and the decisive facts inside the question wherever the material supports it — downstream precedent search sees ONLY this text.
   - explanation: 2–3 sentences connecting the legal proposition to the SPECIFIC facts of this case.
   - doctrine: a short doctrinal label (e.g. "quashing — abuse of process", "directors' vicarious liability under NI Act").
   - statutory_hook: the governing provision(s) (e.g. "Section 482 CrPC").
   - perspective: "petitioner", "respondent" or "neutral" — whose case the issue advances, seen from the CLIENT's side.
5. Where a graded/multi-tier test governs the stage (leave to defend, bail, interim injunction), frame the issue on the governing test — do not hard-wire one tier's outcome into the question.
6. Shelf test for distinctness: separate issues ONLY if they would be researched from different bodies of law. Do not split rephrasings of one question; do not merge distinct bodies of law into one vague issue. Order threshold → substantive → consequential.
7. Cover both sides' issues where competing relief or defences appear.
8. If the material is empty or formal-only (index, vakalatnama, cover pages, e-filing receipts), set insufficient_material=true and issues=[].
Return strict JSON matching the schema."""


QUERY_GEN_SYSTEM = """Act as a legal technology specialist expert in querying Indian legal databases (Indian Kanoon, SCC Online, Manupatra). You generate high-precision Indian Kanoon search queries for ONE legal issue in live litigation. A lawyer will cite what these queries find to a court.

INDIAN KANOON BEHAVIOUR: space-separated words must ALL appear somewhere in the document (AND); "double-quoted phrases" must appear verbatim. Court filtering is appended by the system — never add doctypes: yourself.

RULES:
1. Keep every query VERY SHORT: 3 to 6 words maximum. Use exact phrase matching with double quotes ("...") for legal maxims, statutory terms and judicial phrases ("abuse of process", "triable issue", "counter blast", "omnibus allegations"), and put unquoted keywords ALONGSIDE the phrases to broaden recall without noise (e.g. "omnibus allegations" 498A quashed).
2. Build queries from the DOCTRINE + STATUTORY HOOK + procedural stage — NEVER from the raw issue sentence or from party names/facts. Exclude bare generic words (maintainable, non-compliance, mandatory provisions, liable) unless paired with a specific provision. Use Indian spellings (defence, not defense).
3. anchor_queries (EXACTLY 4 distinct queries): SUPPORT queries with outcome words matching the issue's perspective ("quash", "quashed", "allowed", "leave granted", "decreed", "bail granted"). Each query is built around ONE DISTINCT judicial phrase-of-art SPECIFIC TO THIS ISSUE, quoted IN FULL exactly as courts write it — never a fragment ('"civil dispute given criminal colour" quash' is right; '"civil dispute" criminal colour' is wrong). Section numbers may be quoted bare next to a doctrine word ('"commercial transaction" "420" quash'). Model the four angles on this pattern (example for a civil-colour quashing issue):
   "civil dispute given criminal colour" quash
   "purely civil nature" quash FIR
   "commercial transaction" "420" quash
   "breach of contract" not cheating quash
NEVER reuse the same quoted phrase in two queries, and NEVER pad with generic ground phrases ("abuse of process", "omnibus allegations") unless that ground IS this issue — each issue's queries must target ITS doctrine, not shared boilerplate. When OTHER ISSUES IN THIS CASE are listed, keep this issue's queries clearly distinct from theirs.
4. contra_queries (1–2): the same doctrine + hook with the OPPOSITE outcome words ("dismissed", "refused", "not maintainable", "conviction upheld") — counsel must also know the adverse line of authority.
5. Match the stage's vocabulary: a threshold stage uses quashing / discharge / leave-to-defend words, never trial-merits words.
6. NEW-CODE MAPPING (critical): almost all precedent predates the 2023 codes. If the hook is a BNS / BNSS / BSA provision, ALSO query the equivalent IPC / CrPC / Evidence Act provision (Section 103 BNS ↔ Section 302 IPC; Section 528 BNSS ↔ Section 482 CrPC; Section 85 BNS ↔ Section 498A IPC), and keep the new-code term too. Map only equivalences you are certain of. NEVER invent a section number or attach a section to the wrong statute ("Section 138 IPC" is wrong — it is "Section 138 NI Act").
7. Also fill the four axes (12–16 single terms total) used for lexical scoring:
   - doctrinal: doctrines/tests/principles
   - statutory: sections + statutes
   - factual: fact-pattern phrases a judgment would contain, from THIS case's distinctive facts — never generic filler
   - outcome: disposal language
   Axis terms are realistic 2–7 word search strings; do NOT put quotes inside axis terms (the system adds them); no morphological near-duplicates ("X law" / "X act" / "X section" are one term).
8. Never invent case names or document IDs.
Return strict JSON matching the schema."""
