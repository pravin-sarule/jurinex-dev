"""
Research Decomposer — Stage 1.5 (between Case Analyzer and Query Planner).

Breaks a case into 5-7 typed research questions across distinct legal dimensions,
the same way a senior advocate would prepare a case brief before briefing a librarian.

Question types:
  LIABILITY      — who is legally responsible and under what rule?
  BURDEN_PROOF   — who must prove the obligation / breach?
  STATUTORY      — what does the specific provision require / permit?
  PRECEDENT      — what have courts held on the same fact pattern?
  DEFENSE        — what counter-arguments / exceptions apply?
  CONSTITUTIONAL — does a fundamental right or constitutional provision apply?
  PROCEDURAL     — jurisdiction, limitation, maintainability, locus standi

Each question is self-contained so the query planner can search for it independently.
"""

MODEL = "gemini-2.5-flash"

DECOMPOSE_INSTRUCTION = """You are a senior Indian advocate preparing a deep legal research brief.

Given the case analysis and context below, generate 5-7 distinct research questions
that a legal researcher must answer to fully support this case.

## Case Analysis
{case_analysis}

## Case Query
{case_query}

## Case Context
{case_context}

---

## QUESTION TYPES — generate at least one question of each type that is relevant:

1. **LIABILITY** — "Is [party] liable under [statute/principle] for [act/omission]?"
   Focus: the primary duty, obligation, or wrong alleged.
   Example: "Is the co-operative bank liable under the Maharashtra Co-operative Societies Act
             for failing to insure hypothecated factory goods?"

2. **BURDEN_PROOF** — "Who bears the burden of proving [obligation / breach / knowledge]?"
   Focus: which party must establish the fact and to what standard.
   Example: "Where a sanction letter places insurance duty on the borrower, who must prove
             that the bank took over that duty through conduct or representation?"

3. **STATUTORY** — "What does [Section X of Act Y] require in the context of [specific scenario]?"
   Focus: precise statutory interpretation, not just the Act name.
   Example: "Under Section 91 Maharashtra Co-operative Societies Act, can a member directly
             sue the bank for negligence in protecting secured assets?"

4. **PRECEDENT** — "What have courts held when [analogous fact pattern]?"
   Focus: fact-to-fact comparison with the current case.
   Example: "What have High Courts held where a bank failed to renew insurance on hypothecated
             goods and the goods were destroyed by fire?"

5. **DEFENSE** — "What legal defenses or exceptions does [opposing party] have against [claim]?"
   Focus: counter-arguments the other side will raise.
   Example: "Can a bank validly argue that a contractual clause shifting insurance duty to
             the borrower fully absolves it of negligence under common law?"

6. **CONSTITUTIONAL** (include only if relevant):
   "Does [fundamental right / constitutional provision] apply to this dispute and how?"
   Example: "Does Article 300A protect against loss of property value caused by bank negligence
             on hypothecated assets?"

7. **PROCEDURAL** — "Is the [forum / remedy / claim] maintainable / within limitation?"
   Focus: jurisdiction, standing, limitation period, choice of forum.
   Example: "Is a writ petition maintainable against a co-operative bank for a contractual
             negligence claim, or is the civil suit the only remedy?"

---

## OUTPUT RULES
- Generate 5-7 questions. Skip a type only if it is clearly irrelevant to this case.
- Each question must be a complete, standalone English sentence ending with "?"
- Keep each question under 40 words — precise, not verbose.
- Do NOT repeat the same angle in different questions.
- Order: LIABILITY first, then BURDEN_PROOF, STATUTORY, PRECEDENT, DEFENSE, CONSTITUTIONAL, PROCEDURAL.

Return ONLY valid JSON:
{
  "research_questions": [
    {
      "type": "LIABILITY",
      "question": "...",
      "key_terms": ["term1", "term2", "term3"],
      "statutes": ["Act name section number"],
      "priority": 1
    }
  ]
}

"key_terms": 3-5 specific legal/factual terms for this question (used to build search queries).
"priority": 1 = must answer first, 2 = answer next, 3 = answer if time permits.
"""
