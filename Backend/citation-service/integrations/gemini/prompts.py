def issue_extraction_prompt(query: str, case_context: str, perspective: str) -> str:
    """Tender/public-law issue extractor: screens each issue against a doctrine checklist
    so the core doctrines (legitimate expectation, promissory estoppel, etc.) are actually
    searched, marks the main issue, and models the opponent's authorities."""
    return (
        "You are a senior Indian public-law and tender-litigation lawyer preparing to "
        "search Indian Kanoon for relevant judgments in a writ petition.\n\n"
        "Analyze the case and extract legal issues with precise search terms that will find "
        "the most relevant judgments on Indian Kanoon.\n\n"
        f"Represented side (research from their perspective): {perspective}\n"
        f"Case title / user query: {query}\n\n"
        "=== CASE DOCUMENT START ===\n"
        f"{case_context}\n"
        "=== CASE DOCUMENT END ===\n\n"
        "Indian Kanoon search rules you MUST follow:\n"
        "- ANDD between required terms, ORR between alternatives, NOTT to exclude.\n"
        "- Phrases in double quotes, e.g. \"legitimate expectation\".\n"
        "- NO parentheses, NO nested operators. Flat structure only. Each phrase under 5 words.\n\n"
        "DOCTRINE CHECKLIST — screen EVERY issue against ALL of these. In doctrines[] output "
        "ONLY the short canonical phrase on the LEFT of the colon — the words a judgment "
        "actually uses. NEVER output the description on the right, NEVER add parentheses, "
        "slashes, or '(... line)' notes:\n"
        "1. arbitrary and capricious : Article 14 arbitrariness / Tata Cellular line\n"
        "2. scope of judicial review : judicial review of tender, Wednesbury unreasonableness\n"
        "3. legitimate expectation : oral or written assurance acted upon\n"
        "4. promissory estoppel : promissory estoppel against the State\n"
        "5. cannot take advantage : authority cannot take advantage of its own wrong\n"
        "6. level playing field : level playing field in public procurement\n"
        "7. substantial compliance : essential vs ancillary conditions\n"
        "8. natural justice : audi alteram partem\n"
        "9. malafides : colourable exercise of power\n"
        "10. proportionality : disproportionate action\n\n"
        "GOOD phrase_terms: \"substantial compliance\", \"legitimate expectation\", "
        "\"arbitrary and capricious\". BAD (never do this): \"Article 14 arbitrariness "
        "(Tata Cellular line)\", \"essential vs ancillary conditions / substantial compliance\".\n\n"
        "CONDITIONAL RULES:\n"
        "- Missing experience certificate or qualification document: MUST include "
        "\"substantial compliance\" and \"essential condition\" in phrase_terms and the doctrine "
        "\"essential vs ancillary conditions\".\n"
        "- Oral assurance or oral direction from authority: MUST include \"promissory estoppel\" "
        "and \"legitimate expectation\" in phrase_terms and the doctrine \"authority cannot benefit "
        "from own wrong\".\n"
        "- Competing bidder accepted with non-compliant documents: MUST include \"level playing "
        "field\" and \"discriminatory treatment\" in phrase_terms.\n"
        "- Initial acceptance then later rejection: MUST include \"legitimate expectation\" and "
        "\"inconsistent conduct\" in phrase_terms.\n\n"
        "STRICTLY IGNORE boilerplate: cause-title, court/bench/city, party & advocate names, the "
        "index / list of documents / exhibit & page numbers, e-tender notices and annexure listings.\n\n"
        "Return ONLY a JSON object of this exact shape:\n"
        "{\n"
        '  "case_summary": "2-3 sentence neutral summary of the dispute",\n'
        '  "court": "court where filed, e.g. Bombay High Court / Supreme Court of India (empty if unclear)",\n'
        '  "tender_stage": "e.g. technical bid evaluation / financial bid / blacklisting / award (empty if N/A)",\n'
        '  "issues": [\n'
        "    {\n"
        '      "legal_issue": "full legal question in one sentence",\n'
        '      "is_main_issue": true,\n'
        '      "doctrines": ["applicable doctrines from the checklist"],\n'
        '      "outcome_sought": "what the petitioner wants the court to order",\n'
        '      "phrase_terms": ["6-8 exact multi-word phrases for IK, e.g. \\"legitimate expectation\\", \\"substantial compliance\\""],\n'
        '      "must_have_terms": ["3-4 single salient keywords, e.g. tender, eligibility, blacklisting"],\n'
        '      "synonyms": ["alternative terms for fallback queries"],\n'
        '      "statutes": ["Article 14, Article 226, Section X of the Y Act"],\n'
        '      "landmark_cases": ["Tata Cellular", "Reliance Energy", "Air India Cochin", "Motilal Padampat"]\n'
        "    }\n"
        "  ],\n"
        '  "opponent_arguments": ["what the respondent will argue"],\n'
        '  "opponent_doctrines": ["doctrines the opponent will cite"],\n'
        '  "opponent_phrase_terms": ["phrases to search for ADVERSE authority"]\n'
        "}\n\n"
        "Rules:\n"
        "- 3 to 5 issues, ordered by importance. EXACTLY ONE issue must have is_main_issue=true "
        "(the gravamen). Never let a sub-issue's terms stand in for the main issue.\n"
        "- phrase_terms / doctrines must be REAL legal concepts a court would use — never party "
        "names, court names, cities, 'writ petition', 'exhibit', 'index', 'page'.\n"
        "- Each phrase_term / doctrine MUST be a short phrase under 5 words with NO parentheses, "
        "NO slashes, and NO descriptive labels — only words that appear verbatim in judgments.\n"
        "- landmark_cases MUST be bare case names (e.g. \"Tata Cellular\", \"Motilal Padampat\") "
        "so they can be searched directly.\n"
        "- If a statute is not explicit, infer the most likely (e.g. Article 14/226 for arbitrary "
        "state action) rather than leaving it empty.\n"
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
