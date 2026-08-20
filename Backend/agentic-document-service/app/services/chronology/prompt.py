"""Chronology fragment appended to the form_population_agent extraction prompt."""

CHRONOLOGY_EXTRACTION_BLOCK = """
ALSO EXTRACT A GROUNDED CHRONOLOGY in the same JSON object under the key "events".

"events" is an array of objects with EXACTLY these keys:
{
  "date": "the date as written, converted to YYYY-MM-DD when the day is known; YYYY-MM if only month+year; never invent a day",
  "title": "short factual heading of what happened (not the document name)",
  "particulars": "1 to 5 sentences of what happened that day. Facts only, past tense. No argument, no law, no speculation.",
  "eventType": "one of: agreement, notice, reply, payment, breach, filing, hearing, order, judgment, affidavit, evidence, communication, other",
  "phase": "one of: pre_litigation, institution, pleadings, interim, evidence, hearing, order, execution, other",
  "sourceQuote": "a verbatim span of 12+ characters copied from THIS document that contains the date and the event"
}

CHRONOLOGY RULES — ZERO TOLERANCE:
1. NEVER invent a date, party, amount, or event. If it is not in the document, omit it.
2. Extract the EVENT, not the document. "Plaint filed" is an event; "this PDF" is not.
3. Do NOT emit two objects for the same happening. Same calendar day with two DISTINCT happenings is allowed (Python merges the day).
4. Recital dates ("whereas on …") and procedural dates (filing, listing, order) are both events if the date is written.
5. sourceQuote MUST be copied character-for-character from the document (OCR spacing may stay). If you cannot quote the date, omit the event.
6. Do not use today's date, do not infer a missing day, do not complete a partial date.
7. Ignore signature-block dates that are blank or only "Date: ____".
8. particulars: 1–5 sentences, facts only. No headings, no bullets, no markdown.

Keep the case-form fields AND "events" in the SAME JSON object. Return ONLY that JSON.
""".strip()
