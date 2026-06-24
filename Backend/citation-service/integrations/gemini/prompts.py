def issue_extraction_prompt(query: str, case_context: str, perspective: str) -> str:
    """Domain-adaptive issue extractor: detects the case's field (tender/public-law,
    land/tenancy/property, service, contract, criminal, etc.), screens each issue against
    the doctrines relevant to THAT field, captures this case's OWN facts, and authors
    ready-to-run flat Indian Kanoon query recipes grounded in those facts (so searches
    stop collapsing to a bare doctrine + 'quashed')."""
    return (
        "You are a senior Indian litigation lawyer preparing to search Indian Kanoon for "
        "judgments relevant to the case below. The case may be from ANY field — public law / "
        "tender, land / tenancy / property, service, contract, taxation, criminal, family. "
        "First identify the field, then extract issues with search terms and ready-made "
        "queries that will find on-point judgments.\n\n"
        f"Represented side (research from their perspective): {perspective}\n"
        f"Case title / user query: {query}\n\n"
        "=== CASE DOCUMENT START ===\n"
        f"{case_context}\n"
        "=== CASE DOCUMENT END ===\n\n"
        "Indian Kanoon search rules you MUST follow (used for queries[] and phrase_terms[]):\n"
        "- ANDD between required terms, ORR between alternatives, NOTT to exclude.\n"
        "- Phrases in double quotes, e.g. \"legitimate expectation\".\n"
        "- NO parentheses, NO nested operators. Flat structure only. Each phrase under 5 words.\n"
        "- NEVER mix ANDD and ORR in the SAME query string (the engine is flat — '(A ORR B) "
        "ANDD C' is impossible). Use ANDD for a precision query, ORR for a separate recall query.\n"
        "- A judgment does NOT contain this petition's sentences verbatim — turn facts into "
        "SHORT phrases (2-4 words), never whole sentences.\n\n"
        "DOCTRINE CHECKLIST — screen each issue against the doctrines RELEVANT TO THIS CASE'S "
        "FIELD. The categories below are ILLUSTRATIVE: for a taxation, criminal, contract, IP, or "
        "family matter use THAT field's own doctrines, not the public-law/land examples. In "
        "doctrines[] output ONLY the short canonical phrase on the LEFT of the colon — the words a "
        "judgment actually uses. NEVER output the right-side description, parentheses, slashes, or "
        "'(... line)' notes:\n"
        "  Public law / tender: arbitrary and capricious : Article 14; scope of judicial review : "
        "Tata Cellular line; legitimate expectation : assurance acted upon; promissory estoppel : "
        "against the State; level playing field : public procurement; substantial compliance : "
        "essential vs ancillary conditions.\n"
        "  Land / tenancy / property: forfeiture of land : non-utilisation / breach of grant; "
        "non-utilisation : land not used for sanctioned purpose; change of user : conversion of "
        "land use; resumption of land : re-entry by lessor/State; bona fide industrial use : "
        "industrial purpose; breach of condition : condition of grant or lease.\n"
        "  General: natural justice : audi alteram partem; malafides : colourable exercise of "
        "power; proportionality : disproportionate action; non-speaking order : no reasons given.\n\n"
        "GOOD phrase_terms: \"substantial compliance\", \"non-utilisation\", \"change of user\", "
        "\"arbitrary and capricious\". BAD (never do this): \"Article 14 arbitrariness (Tata "
        "Cellular line)\", \"essential vs ancillary conditions / substantial compliance\".\n\n"
        "STRICTLY IGNORE boilerplate: cause-title, court/bench/city, party & advocate names, the "
        "index / list of documents / exhibit & page numbers, notices and annexure listings.\n\n"
        "For EACH issue you MUST also build queries[] — ready-to-run flat IK strings grounded in "
        "THIS case's facts. For each issue produce, where possible:\n"
        "  - 2 precision queries  kind=\"precision\": \"<rare phrase>\" ANDD <single common keyword> "
        "(ANDD only; pair ONE rare phrase with ONE COMMON single word — NEVER two rare phrases "
        "ANDD'd together, which returns 0 hits, e.g. do NOT write \"bona fide industrial use\" ANDD "
        "\"forfeiture of land\").\n"
        "  - 1 statute query      kind=\"statute\":   \"<statute token e.g. section 63>\" ANDD "
        "<single keyword> (ANDD only; a short token + one common word, never a full citation).\n"
        "  - 1 recall query       kind=\"recall\":    \"<syn A>\" ORR \"<syn B>\" ORR \"<syn C>\" ORR "
        "\"<syn D>\" ... (ORR only — 4 to 8 synonyms of ONE concept; ORR broadens recall safely, so "
        "cast a WIDE net here).\n"
        "  - landmarks via landmark_cases (FULL cause-title 'X v. Y' — keep BOTH parties), NOT inside queries[].\n\n"
        "Return ONLY a JSON object of this exact shape:\n"
        "{\n"
        '  "case_summary": "2-3 sentence neutral summary of the dispute",\n'
        '  "case_field": "e.g. land/tenancy, tender/public-law, service, contract, criminal",\n'
        '  "court": "court where filed, e.g. Bombay High Court / Supreme Court of India (empty if unclear)",\n'
        '  "issues": [\n'
        "    {\n"
        '      "legal_issue": "full legal question in one sentence",\n'
        '      "is_main_issue": true,\n'
        '      "doctrines": ["applicable doctrines from the checklist (canonical phrase only)"],\n'
        '      "fact_terms": ["3-6 of THIS case\'s own facts as 2-4 word phrases, e.g. \\"non-utilisation\\", \\"change of user\\", \\"forfeiture of land\\""],\n'
        '      "outcome_terms": ["relief/result words a winning judgment uses, e.g. quashed, set aside, allowed"],\n'
        '      "outcome_sought": "what the represented side wants the court to order",\n'
        '      "phrase_terms": ["6-8 exact multi-word legal phrases for IK"],\n'
        '      "must_have_terms": ["3-4 single salient keywords from the facts"],\n'
        '      "synonyms": ["alternative fact terms for recall queries"],\n'
        '      "statutes": ["Article 226, Section 63-1A of the Maharashtra Tenancy Act"],\n'
        '      "landmark_cases": ["FULL cause-titles \'X v. Y\', e.g. \\"State of Maharashtra v. Laxmanrao\\", \\"Motilal Padampat Sugar Mills v. State of U.P.\\""],\n'
        '      "queries": [\n'
        '        {"kind": "precision", "q": "\\"forfeiture of land\\" ANDD non-utilisation"},\n'
        '        {"kind": "recall", "q": "\\"non-utilisation\\" ORR \\"non-user\\" ORR \\"land not utilised\\" ORR \\"failure to utilise\\" ORR \\"not put to use\\""},\n'
        '        {"kind": "statute", "q": "\\"section 63\\" ANDD tenancy"}\n'
        "      ]\n"
        "    }\n"
        "  ],\n"
        '  "opponent_arguments": ["what the opposing side will argue"],\n'
        '  "opponent_doctrines": ["doctrines the opponent will cite"],\n'
        '  "opponent_phrase_terms": ["phrases to search for ADVERSE authority"]\n'
        "}\n\n"
        "Rules:\n"
        "- 3 to 5 issues, ordered by importance. EXACTLY ONE issue must have is_main_issue=true "
        "(the gravamen). Never let a sub-issue's terms stand in for the main issue.\n"
        "- fact_terms / phrase_terms / doctrines must be REAL words a court uses — never party "
        "names, court names, cities, 'writ petition', 'exhibit', 'index', 'page'.\n"
        "- SUBSTANTIVE CORE FIRST: every issue MUST capture its governing statute (section/article) "
        "in statutes[] AND the SUBSTANTIVE legal test of the matter (e.g. \"bona fide industrial "
        "use\" under Section 63; \"change of opinion\" for tax reassessment) — NOT merely a "
        "procedural ground (natural justice / opportunity of hearing / arbitrary action). Capture "
        "procedural grounds too, but the SUBSTANTIVE core must LEAD doctrines[]/fact_terms[], and at "
        "least one precision or statute query MUST pair the substantive subject with the governing "
        "statute token (else the search drifts into generic natural-justice cases of other fields).\n"
        "- Each phrase MUST be under 5 words with NO parentheses, NO slashes, NO descriptive "
        "labels — only words that appear verbatim in judgments.\n"
        "- Every q in queries[] MUST obey the flat rules above: ANDD-only OR ORR-only, never both; "
        "no parentheses; each quoted phrase under 5 words.\n"
        "- landmark_cases MUST be FULL cause-titles 'X v. Y' (keep BOTH parties; the system reduces "
        "them to the distinctive party). Drop only '& Ors'/'& Anr'. Do NOT emit a bare common "
        "given name alone (e.g. 'Ramesh') — it is not a usable citation.\n"
        "- If a statute is not explicit, infer the most likely rather than leaving it empty.\n"
        "- Output JSON only. No prose. No markdown."
    )


def batch_judge_prompt(perspective: str, issue_cards: list[dict], candidates: list[dict]) -> str:
    return (
        "Evaluate only the retrieved material below. Do not invent citations. "
        "Return a JSON object with decisions: [{doc_id, classification, reason, risk_note}]. "
        "Allowed classifications: SUPPORTING, ADVERSE, DISTINGUISHABLE, WEAK_CONTEXTUAL, IRRELEVANT.\n"
        "CRITICAL — outcome over doctrine: each candidate may include a 'disposition' "
        "(ALLOWED/DISMISSED/PARTLY_ALLOWED/REMANDED), the 'winning_party', and the verbatim "
        "'operative_quote'. A judgment that DISCUSSES doctrines favourable to the selected side "
        "but ultimately DISMISSED the petition is ADVERSE to a petitioner (and SUPPORTING to a "
        "respondent), and vice-versa. When a disposition is given, your classification MUST be "
        "consistent with who actually won; do not be misled by favourable-sounding reasoning.\n"
        "IMPORTANT — principle direction: for DIRECTED principles like 'cannot take advantage of "
        "its own wrong' or 'estoppel', check carefully which PARTY the court applies the principle "
        "AGAINST. If the court applies it against the petitioner/bidder (not the authority), the "
        "case is ADVERSE to our client even if the principle sounds relevant. Look for who is being "
        "told they cannot take advantage of their own wrong. A candidate flagged "
        "direction=PRINCIPLE_REVERSED applies the principle against the wrong party.\n"
        f"Selected side: {perspective}. Issues: {issue_cards}. Candidates: {candidates}"
    )


def usage_analysis_prompt(perspective: str, case_summary: str, issues: list[dict], candidates: list[dict]) -> str:
    """Per-citation 'how to use this judgment' memo (500-600 words) + relevance verdict.

    Each candidate carries a 'category' (recommended / adverse / caution); the memo is
    framed accordingly. The model also returns an honest relevance verdict used to keep the
    Recommended bucket genuinely relevant — it must NOT manufacture a use for an off-point case.
    """
    return (
        "You are a senior Indian advocate writing a practical research note for a colleague "
        f"who represents the {perspective}. For EACH judgment below, write a focused memo on how "
        "to use it in THIS matter — grounded in the actual holding, disposition, and facts given. "
        "Do not invent holdings or citations.\n\n"
        "FIRST decide relevance + stance honestly (the 'category' field is only a preliminary "
        "guess — decide the TRUE stance yourself and override it if wrong):\n"
        f"- RELEVANT: squarely supports the {perspective}'s position on an issue in this matter.\n"
        f"- ADVERSE: it DOES bear on this matter but goes AGAINST the {perspective} (the opposite "
        f"side would cite it, e.g. it refused similar relief or set the proposition the other way). "
        "An adverse-but-on-point judgment is RELEVANT and valuable — mark it ADVERSE, never drop it.\n"
        "- PARTIALLY_RELEVANT: touches the area but on different facts/sub-points.\n"
        "- NOT_RELEVANT: a different area of law / off-topic only. If so, say so plainly and do NOT "
        "pretend it helps.\n"
        "When you mark a judgment ADVERSE, write the memo with the ADVERSE framing/headings below "
        "(why the opposite side cites it, how to distinguish it), even if its 'category' said recommended.\n\n"
        "Each candidate has a 'category' (your starting guess). Frame the four sections by the TRUE stance:\n"
        "- recommended → headings: 'Why this judgment helps you', 'The argument it supports & how "
        "to deploy it', 'Factual fit with your case', 'When not to rely on it / risks'.\n"
        "- adverse → headings: 'Why the opposite side will cite this', 'The proposition it sets "
        "against you', 'How to distinguish it on the facts', 'Fallback — how to blunt its impact'.\n"
        "- caution → headings: 'Why it is borderline', 'The limited way it can help', "
        "'Factual or legal gaps', 'How to use it carefully'.\n\n"
        "Length: 4 sections, ~120-150 words EACH (total 500-600 words). Concrete and specific to "
        "the facts — name the doctrine, the disposition, the parallel/distinction. Plain English.\n\n"
        f"This matter (summary): {case_summary}\n"
        f"Issues: {issues}\n\n"
        f"Judgments: {candidates}\n\n"
        'Return ONLY JSON of this exact shape: {"items": [{"doc_id": "...", '
        '"relevance": "RELEVANT|ADVERSE|PARTIALLY_RELEVANT|NOT_RELEVANT", "relevance_reason": "one line", '
        '"verdict": "one-line bottom line for the lawyer", '
        '"sections": [{"heading": "...", "body": "..."}, {"heading": "...", "body": "..."}, '
        '{"heading": "...", "body": "..."}, {"heading": "...", "body": "..."}]}]}'
    )


def disposition_prompt(tail_text: str) -> str:
    """Outcome-only extractor over the END of an Indian judgment (PART 1, Step 2)."""
    return (
        "You are reading the END of an Indian court judgment (the operative order).\n"
        "Extract ONLY the final outcome — ignore the reasoning and any precedents discussed.\n"
        "(1) disposition: was the petition/appeal ALLOWED, DISMISSED, PARTLY_ALLOWED, or REMANDED?\n"
        "(2) winning_party: who prevailed — PETITIONER or RESPONDENT?\n"
        "(3) operative_quote: copy the exact operative sentence verbatim.\n"
        "(4) confidence: 0.0-1.0.\n"
        "A judgment that discusses petitioner-friendly doctrines but ultimately DISMISSES the "
        "petition is a DISMISSAL (the respondent won). Focus only on the final order.\n"
        'Respond in JSON: {"disposition": "...", "winning_party": "...", '
        '"operative_quote": "...", "confidence": 0.0}\n\n'
        "=== END OF JUDGMENT ===\n"
        f"{tail_text}\n"
        "=== END ==="
    )
