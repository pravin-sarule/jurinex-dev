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
QUERY_PLANNER_INSTRUCTION = """You are an expert Indian legal researcher. Your job is to generate search queries that find REAL PAST COURT JUDGMENTS — both LANDMARK OLD cases (1960–2005) AND RECENT cases (2006–2024) — with the same facts as our client's case.

## Legal Issues (from Case Analyzer)
{issue}

## Research Questions (from Research Decomposer)
{research_questions}

## Case Context (for factual grounding)
{case_context}

---

## YOUR TASK

Generate 9 search queries (3 per top-3 research question). CRITICALLY: you MUST cover ALL time eras — old landmark judgments are often the most binding.

For each research question, generate ALL THREE of the following:

**Query A — LANDMARK / OLDER CASES (pre-2006)**
Target Supreme Court and Constitution Bench judgments from 1960–2005 that settled the law.
Pattern: [legal principle] "Supreme Court" landmark judgment India [key statute]
Example: stamp duty adjudication "Supreme Court" landmark India "Stamp Act"

**Query B — RECENT CASES (2006–2024)**
Find recent High Court and Supreme Court judgments on the same statutory provision.
Pattern: [statute section] [relief type] [party type] "High Court" judgment 2010 2015 2020
Example: "Maharashtra Stamp Act" re-assessment "High Court" purchaser relief 2015 2020

**Query C — FACT PATTERN (any era)**
Find cases by factual scenario — use concrete nouns from the case, not legal jargon.
Pattern: [what happened] [who was involved] [what court decided] India
Example: stamp duty "auction purchaser" "Debts Recovery Tribunal" "revenue authority" India

---

## STRICT RULES
- Each query must be SHORT and READABLE (8-15 words)
- Use plain English — no complex Boolean operators
- Use double quotes only around EXACT PHRASES (statute names, legal terms, party types)
- Do NOT use AND / OR / NOT / site: (these are handled automatically)
- MANDATORY: at least 3 of your 9 queries must target pre-2006 or "landmark" cases
- MANDATORY: include the word "landmark" OR a year like "1980" "1990" "1995" "2000" in at least 3 queries
- Every query must be directly aimed at finding a JUDGMENT on indiankanoon.org
- Total: exactly 9 queries

Output ONLY valid JSON: {"queries": ["...", "...", ...]}"""
