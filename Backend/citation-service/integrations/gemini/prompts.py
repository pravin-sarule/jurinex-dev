def issue_extraction_prompt(query: str, case_context: str, perspective: str) -> str:
    """Ask the model to READ the case and extract substantive legal issues + search terms."""
    return (
        "You are a senior Indian legal research assistant preparing to search Indian Kanoon "
        "for precedents relevant to the case below.\n\n"
        "READ the document and identify the SUBSTANTIVE legal issues — the questions of law, "
        "the constitutional/statutory provisions invoked, the legal doctrines/principles, the "
        "grounds of challenge, and the relief sought.\n\n"
        "STRICTLY IGNORE non-legal boilerplate: the cause-title, court name, bench/city, party "
        "names, advocate names, the index / 'list of documents' / exhibit numbers / page numbers, "
        "registration certificates, e-tender notices and similar annexure listings.\n\n"
        f"Represented side (research from their perspective): {perspective}\n"
        f"Case title / user query: {query}\n\n"
        "=== CASE DOCUMENT START ===\n"
        f"{case_context}\n"
        "=== CASE DOCUMENT END ===\n\n"
        "Return ONLY a JSON object of this exact shape:\n"
        "{\n"
        '  "case_summary": "2-3 sentence neutral summary of what the dispute is actually about",\n'
        '  "court": "the court where the case is filed, e.g. Bombay High Court / Delhi High Court / Supreme Court of India (empty if unclear)",\n'
        '  "issues": [\n'
        "    {\n"
        '      "legal_issue": "one-line statement of the legal question",\n'
        '      "phrase_terms": ["multi-word legal doctrine/phrase for an exact-match search, e.g. \\"legitimate expectation\\", \\"natural justice\\", \\"arbitrary state action\\""],\n'
        '      "must_have_terms": ["single salient legal keywords, e.g. tender, eligibility, blacklisting, arbitrary"],\n'
        '      "statutes": ["actual provisions cited, e.g. Article 14, Article 226, Section 5 of the X Act"]\n'
        "    }\n"
        "  ]\n"
        "}\n\n"
        "Rules:\n"
        "- 3 to 5 issues maximum, ordered by importance.\n"
        "- phrase_terms must be REAL legal concepts a court would use — never party names, court "
        "names, cities, 'writ petition', 'particulars', 'exhibit', 'memo', 'index', 'page'.\n"
        "- If no statute is explicit, infer the most likely ones (e.g. Article 14/226 for an "
        "arbitrary-state-action writ) rather than leaving it empty.\n"
        "- Output JSON only, no prose."
    )


def batch_judge_prompt(perspective: str, issue_cards: list[dict], candidates: list[dict]) -> str:
    return (
        "Evaluate only the retrieved material below. Do not invent citations. "
        "Return a JSON object with decisions: [{doc_id, classification, reason, risk_note}]. "
        "Allowed classifications: SUPPORTING, ADVERSE, DISTINGUISHABLE, WEAK_CONTEXTUAL, IRRELEVANT. "
        f"Selected side: {perspective}. Issues: {issue_cards}. Candidates: {candidates}"
    )
