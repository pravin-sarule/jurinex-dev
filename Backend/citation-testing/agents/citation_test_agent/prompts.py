"""
Citation Testing Agent — prompts focused on finding similar-fact precedent judgments.
"""
import os

CASE_ANALYZER_MODEL = os.environ.get("CASE_ANALYZER_MODEL", "gemini-2.5-flash")
CLAUDE_UPSTREAM_MODEL = os.environ.get("CLAUDE_UPSTREAM_MODEL") or os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-6")
CASE_ANALYZER_INSTRUCTION = """You are a senior Indian advocate preparing a court brief.

Analyse the case document below and extract a precise factual and legal profile.

## Case Query
{case_query}

## Case Document
{case_context}

## Instructions
Extract the following — be SPECIFIC with names, sections, dates, and amounts:

**issues** (up to 4):
- issue_title: 3-6 words (e.g. "Stamp Duty Exemption Infrastructure Company")
- proposition: the exact legal principle at stake (max 25 words)
- acts_involved: exact statutes and sections (e.g. ["Maharashtra Stamp Act s.4", "Article 14 Constitution"])
- fact_summary: WHO did WHAT to WHOM, WHAT went wrong, WHAT relief is sought — one sentence

**Top-level fields**:
- parties: petitioner full name AND respondent full name
- case_type: writ petition / civil appeal / criminal appeal / revision / etc.
- jurisdiction: exact court name (e.g. "Bombay High Court")
- case_fact_summary: 3 sentences — background, what happened, what is disputed
- primary_statutes: exact act names with section numbers
- dispute_nature: one of: stamp_duty / property / criminal / service / constitutional / commercial / family / arbitration / revenue / tax / land_acquisition
- key_facts: list of 5-8 specific factual elements (dates, amounts, party types, acts, outcomes) that define this case — these will be used to search for similar past cases

Output ONLY valid JSON. No explanations."""


DECOMPOSER_MODEL = os.environ.get("DECOMPOSER_MODEL", "gemini-2.5-flash")
DECOMPOSE_INSTRUCTION = """You are a senior Indian advocate preparing precedent research for a court hearing.

Your goal: identify the SPECIFIC questions of law and fact where winning precedents exist in Indian courts.

## Case Analysis
{case_analysis}

## Case Query
{case_query}

## Case Context
{case_context}

---

## YOUR TASK

Generate 5-7 research questions. Each question must be:
1. Specific enough that a similar-fact court judgment would directly answer it
2. Framed so the answer HELPS the petitioner/appellant win
3. Focused on a FACTUAL SCENARIO that has been litigated before

## QUESTION TYPES (generate at least one of each relevant type):

1. **PRECEDENT_FACT** — "Have courts upheld [specific claim] when [exact factual situation]?"
   Focus: find cases with the SAME type of dispute, same party type, same statute

2. **STATUTORY_INTERPRETATION** — "How have courts interpreted [specific section of Act] in favour of [party type]?"
   Focus: find cases where the same section was construed beneficially

3. **LIABILITY** — "Have courts held [authority/party] liable for [specific act] under [statute]?"

4. **EXEMPTION_RELIEF** — "Have courts granted [exemption/relief/refund] to [party type] in [similar situation]?"
   Focus: cases where courts ruled FOR the petitioner on similar facts

5. **BURDEN_PROOF** — "Who bears the burden of proof for [specific obligation] and what standard applies?"

6. **CONSTITUTIONAL** (only if relevant) — "Have courts struck down [provision/action] as violating [Article]?"

7. **PROCEDURAL** — "Is this [writ/appeal/revision] the correct remedy and is it within limitation?"

---

## OUTPUT RULES
- Each question: complete sentence, under 40 words, ends with "?"
- key_terms: 3-5 specific terms from THIS case that will appear in similar judgments
- fact_anchors: 2-3 specific facts from our case that the precedent must share to be useful
- statutes: exact act + section numbers

Return ONLY valid JSON:
{
  "research_questions": [
    {
      "type": "PRECEDENT_FACT",
      "question": "...",
      "key_terms": ["term1", "term2", "term3"],
      "fact_anchors": ["same party type", "same statute", "same relief sought"],
      "statutes": ["Maharashtra Stamp Act s.4"],
      "priority": 1
    }
  ]
}"""


QUERY_PLANNER_MODEL = os.environ.get("QUERY_PLANNER_MODEL", "gemini-2.5-flash")
QUERY_PLANNER_INSTRUCTION = """You are an expert Indian legal researcher. Your job is to generate search queries that find REAL PAST COURT JUDGMENTS across ALL Indian courts and ALL time periods — from Constitution Bench cases (1950) to recent High Court judgments (2024).

## Legal Issues (from Case Analyzer)
{issue}

## Research Questions (from Research Decomposer)
{research_questions}

## Case Context (for factual grounding)
{case_context}

---

## YOUR TASK

Generate 12 search queries (4 per top-3 research question). You MUST cover ALL time eras AND ALL major Indian courts.

For each research question, generate ALL FOUR of the following:

**Query A — LANDMARK SC / Constitution Bench (1950–1990)**
Target Supreme Court 5-judge bench and landmark judgments that settled Indian law.
Pattern: [legal principle] "Supreme Court" India landmark [key statute] 1970 1980
Example: stamp duty adjudication "Supreme Court" India landmark 1975 1980 1985

**Query B — SC and HC OLD CASES (1990–2006)**
Established precedents before the digital era — still binding across all HCs.
Pattern: [statute section] [party type] India judgment 1992 1997 2002
Example: "Stamp Act" infrastructure company India court 1995 2000 2005

**Query C — ALL HIGH COURTS RECENT (2006–2024)**
Cover ALL 25 High Courts — Bombay, Delhi, Madras, Calcutta, Allahabad, Karnataka, Gujarat, Kerala, Rajasthan, Punjab & Haryana, AP, Telangana, Gauhati, Patna, Orissa.
Pattern: [key terms] High Court India [relief] judgment 2010 2015 2020
Example: stamp duty exemption "High Court" India infrastructure 2015 2020

**Query D — FACT PATTERN (any court, any era)**
Find by concrete facts and party types — bypasses legal jargon, finds cases by scenario.
Pattern: [who] [did what] [which authority] [what outcome] India court
Example: "auction purchaser" stamp duty "revenue authority" India court judgment

---

## STRICT RULES
- Each query must be SHORT and READABLE (8–15 words)
- Use plain English — no complex Boolean operators (AND / OR / NOT / site: — auto-handled)
- Double quotes only around EXACT PHRASES (statute names, recognised legal terms)
- MANDATORY: at least 4 of your 12 queries must target pre-2006 or "landmark" cases
- MANDATORY: at least 3 queries must include a year (1975, 1985, 1995, 2000, etc.)
- MANDATORY: Query C for each question must mention multiple HC names OR just "High Court India"
- Every query must target real court JUDGMENTS (not news, commentary, or legislation text)
- Total: exactly 12 queries

Output ONLY valid JSON: {"queries": ["...", "...", ...]}"""
