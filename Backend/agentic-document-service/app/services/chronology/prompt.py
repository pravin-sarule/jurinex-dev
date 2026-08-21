"""Chronology fragment appended to the form_population_agent extraction prompt."""

CHRONOLOGY_EXTRACTION_BLOCK = """
ALSO EXTRACT A GROUNDED CHRONOLOGY in the same JSON object under the key "events".

"events" is an array of objects with EXACTLY these keys:
{
  "date": "YYYY-MM-DD when the day is known; YYYY-MM if only month+year; YYYY if only the year is on record; never invent a day",
  "title": "short factual heading of what happened (not the document name)",
  "particulars": "1 to 5 sentences of what happened. Facts only, past tense. Name the forum and case number if written. Copy land measures and amounts exactly as written (69 R is not 0.69 R). If this is a party's allegation, say so.",
  "eventType": "one of: agreement, notice, reply, payment, breach, filing, transfer, hearing, order, judgment, affidavit, evidence, communication, other",
  "phase": "one of: pre_litigation, correspondence, institution, pleadings, interim, evidence, hearing, order, appeal, execution, other",
  "forum": "court or authority as written (e.g. Co-op Court Latur, Bombay High Court Aurangabad Bench). Empty string if not written.",
  "caseNumber": "proceeding number as written (Dispute 88/2012, CCB 230/2014, W.P. 8895/2014, A.O. 18/2012). Empty string if not written.",
  "sourcePage": "leave empty — Python stamps pages from OCR. Do not guess a page number.",
  "exhibit": "exhibit mark if written (Exh. 63). Empty string if none.",
  "sourceRole": "one of: petitioner, respondent, court, official, impugned, admitted, disputed",
  "disputed": false,
  "sourceQuote": "a verbatim span of 12+ characters copied from THIS document that contains the event (and the date when a date is given)"
}

CHRONOLOGY RULES — ZERO TOLERANCE:
1. NEVER invent a date, party, amount, area, forum, case number, page, exhibit, or event. If it is not in the document, omit that field or the whole event.
2. Extract the EVENT, not the document. "Plaint filed" is an event; "this PDF" is not.
3. Do NOT emit two objects for the same happening. Same calendar day with two DISTINCT happenings is allowed (Python merges the day).
4. Recital dates ("whereas on …") and procedural dates (filing, listing, order) are both events if the date is written.
5. sourceQuote MUST be copied character-for-character from the document (OCR spacing may stay). Copy from the page body, never from a [PAGE n] marker. If you cannot quote the event, omit it.
6. Do not use today's date, do not infer a missing day, do not complete a partial date.
7. Ignore signature-block dates that are blank or only "Date: ____".
8. particulars: 1–5 sentences, facts only. No headings, no bullets, no markdown. Copy 69 R, hectares, and survey numbers as written — do not convert units.

DO NOT COLLAPSE RELATED DATES — each of these is a SEPARATE event when both dates are written:
9. A municipal/government RESOLUTION date is not the Gazette PUBLICATION date. If Resolution 2648 is 08.08.2022 and the Official Gazette publishes on 10.08.2022, emit both.
10. A CORRIGENDUM date is its own event (e.g. corrigendum 25.08.2022 to a Draft DP publication).
11. The DATE OF A PLAN / instrument ("modified Draft Development Plan dated 07.03.2024") is not the date it was PUBLISHED inviting objections. If modifications were published in the Gazette on 23.02.2024, that publication is a separate event. Never attach "published inviting objections" to the plan-dated day unless the document says publication happened that day.
12. Sanction of an earlier Development Plan (e.g. DP-2001 sanctioned 18.04.2001 under s.31) is a material event even if it sits in a synopsis. Do not skip it because a later draft DP is the main story.
13. An earlier High Court order in the same or connected writ (notices issued, no stay, compensation noted) is an event. A later order that "refers back to" 16.01.2024 does not replace that date.
14. A REPORT forwarded for sanction (e.g. 07.08.2024 recommendations pending before Government) is an event distinct from the letter that forwards it (08.08.2024).
15. "Stand over to [date]" / next listing is an event (phase hearing). Less central than orders, but include it when written.

PROCEDURAL HISTORY (do not skip these even when the day is missing):
16. Scan narrative paragraphs, synopses, and recap orders — not only lines that sit next to a formatted date. Extract: filed, instituted, registered, received, transferred, renumbered, preferred, challenged, disposed, dismissed, remanded, allowed, rejected, restrained, sanctioned, published, gazette, corrigendum, forwarded, stand over, notices issued.
17. If the year is written but the day is not, emit date as "YYYY" and say the exact day is not on record. Do not invent 01 January.
18. Transfers, renumbering, and related writs/appeals are separate events. Put case numbers in caseNumber / particulars.

INSTITUTION DATES — VERIFICATION IS NOT FILING:
19. Prefer court-register language: "Received on", "Registered on", "Filed on" as recorded by the registry. An advocate verification / "solemnly affirmed" / "DATE: … / Advocate for …" is "plaint/writ verified" or "plaint signed", NOT "filed". Do not write "Verified and Filed" unless the registry date is in the quote. A synopsis date (e.g. 26.06.2025) is not the verification date (e.g. 26.05.2025) and is not the filing date.

SOURCE ROLE — DO NOT OVER-LABEL:
20. petitioner = that party's pleaded case (including "since 1985" heirship averments).
21. respondent = respondent's pleaded case.
22. official = Government Resolution, Official Gazette, municipal/town-planning letter, notification, joint-measurement record. Presence in a petition annexure does NOT make it "admitted".
23. court = only a court's order or a fact the court itself records ("this Court on 13.09.2024 ordered status quo"). A Government s.31(1) notification is NOT a court finding even if the High Court mentions it.
24. impugned = the Government/municipal action under challenge (e.g. 15.04.2025 notification). Use this instead of court/disputed when the petition attacks that instrument.
25. admitted = ONLY if the opposite party or a written statement/order expressly admits the fact. Never mark a GR, Gazette, or layout as admitted merely because it is exhibited.
26. disputed = parties assert mutually exclusive versions. Set disputed=true in that case.
27. Do not write "acknowledged by" a authority unless the quote contains acknowledgment/receipt language; prefer "representation submitted/recorded".

STAGE AND RANGE:
28. A letter between parties is eventType communication and phase correspondence — never pleadings.
29. The OCR is stamped with [PAGE n] markers. Use them only to know where you are; Python attaches pin cites from the quote.
30. When the same calendar day is written with conflicting years (OCR), quote the cleaner majority reading if that span is in the document.

Keep the case-form fields AND "events" in the SAME JSON object. Return ONLY that JSON.
""".strip()
