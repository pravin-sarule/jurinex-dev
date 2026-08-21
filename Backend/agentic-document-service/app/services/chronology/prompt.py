"""Chronology fragment appended to the form_population_agent extraction prompt."""

CHRONOLOGY_EXTRACTION_BLOCK = """
ALSO EXTRACT A GROUNDED CHRONOLOGY in the same JSON object under the key "events".

"events" is an array of objects with EXACTLY these keys:
{
  "date": "YYYY-MM-DD when the day is known; YYYY-MM if only month+year; YYYY if only the year is on record; never invent a day",
  "title": "short factual heading of what happened (not the document name)",
  "particulars": "1 to 5 sentences of what happened. Facts only, past tense. Name the forum and case number if written. If this is a party's allegation, say so; if a court has found otherwise, say the finding.",
  "eventType": "one of: agreement, notice, reply, payment, breach, filing, transfer, hearing, order, judgment, affidavit, evidence, communication, other",
  "phase": "one of: pre_litigation, correspondence, institution, pleadings, interim, evidence, hearing, order, appeal, execution, other",
  "forum": "court or authority as written (e.g. Co-op Court Latur, Bombay High Court Aurangabad Bench). Empty string if not written.",
  "caseNumber": "proceeding number as written (Dispute 88/2012, CCB 230/2014, W.P. 8895/2014, A.O. 18/2012). Empty string if not written.",
  "sourcePage": "page number if the OCR or heading shows one (p. 54). Empty string if unknown. Never guess.",
  "exhibit": "exhibit mark if written (Exh. 63). Empty string if none.",
  "sourceRole": "one of: petitioner, respondent, court, admitted, disputed",
  "disputed": false,
  "sourceQuote": "a verbatim span of 12+ characters copied from THIS document that contains the event (and the date when a date is given)"
}

CHRONOLOGY RULES — ZERO TOLERANCE:
1. NEVER invent a date, party, amount, forum, case number, page, exhibit, or event. If it is not in the document, omit that field or the whole event.
2. Extract the EVENT, not the document. "Plaint filed" is an event; "this PDF" is not.
3. Do NOT emit two objects for the same happening. Same calendar day with two DISTINCT happenings is allowed (Python merges the day).
4. Recital dates ("whereas on …") and procedural dates (filing, listing, order) are both events if the date is written.
5. sourceQuote MUST be copied character-for-character from the document (OCR spacing may stay). If you cannot quote the event, omit it.
6. Do not use today's date, do not infer a missing day, do not complete a partial date.
7. Ignore signature-block dates that are blank or only "Date: ____".
8. particulars: 1–5 sentences, facts only. No headings, no bullets, no markdown.

PROCEDURAL HISTORY (do not skip these even when the day is missing):
9. Scan narrative paragraphs, not only lines that sit next to a formatted date. Extract happenings whose verbs are: filed, instituted, registered, received, transferred, renumbered, preferred, challenged, disposed, dismissed, remanded, allowed, rejected, restrained, admitted, denied.
10. If the year is written but the day is not (e.g. "in 2014 the dispute was transferred"), emit date as "YYYY" and say in particulars that the exact day is not on record. Do not invent 01 January.
11. Transfers and renumbering are separate events (e.g. Dispute 88/2012 transferred to Latur and numbered CCB 230/2014). Put both numbers in caseNumber / particulars.
12. Related proceedings (writ petition challenging an injunction, appeal from an order, appellate registration) are events even if they sit in a recap paragraph.

INSTITUTION DATES — SIGNATURE IS NOT FILING:
13. Prefer court-register language: "Received on", "Registered on", "Filed on" as recorded by the registry. An advocate verification / "DATE: … / Advocate for …" is the plaint drawn/signed date, NOT institution. If both exist, emit two events with distinct titles ("Plaint signed", "Dispute registered") or keep only the register date for "filed".

PARTY ROLE AND CONTRADICTION:
14. sourceRole = petitioner or respondent for that party's pleaded version; court for a finding or order; admitted when the opposite party admits it; disputed when the same fact is asserted differently by the parties.
15. Set disputed=true when two versions of the same fact appear (e.g. sanctioned amount Rs. 85 lakh vs Rs. 1.25 crore). Do not present a contested pleading as an established fact.
16. When a court has already ruled on an allegation, the court finding is the event (or annotate the allegation with the finding). Do not flatten both into one seamless narrative.

STAGE AND RANGE:
17. A letter between parties is eventType communication and phase correspondence — never pleadings.
18. Insurance and other periods: if you split start and expiry into two point-events, each title must name the same policy (amount / exhibit) so they stay linked. Do not retitle the expiry as a different subject.

Keep the case-form fields AND "events" in the SAME JSON object. Return ONLY that JSON.
""".strip()
