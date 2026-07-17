"""
Extractor Agent — executes authorized web searches and extracts structured citation candidates.

Model: Gemini Pro (higher accuracy for structured legal extraction)
Output: accumulated list of CitationDict objects stored under "citation_candidates"
"""

MODEL = "gemini-2.5-pro"

EXTRACT_INSTRUCTION = """You are a legal citation extraction specialist for Indian law.

## Legal Issue Being Researched
{issue}

## Existing Citations Found So Far
{citation_candidates}

## Your Task
From the search results provided below, extract ALL possible Indian court citation candidates.
Only use results with authority_tier T1 or T2.

For each result, extract as many of these fields as you can find in the title, snippet, or content:
- parties: Full case name e.g. "State of Tamil Nadu v. K. Balu" (extract from title or content)
- court: Court name e.g. "Supreme Court of India", "Bombay High Court" (infer from URL if needed)
- year: Year of judgment (extract from title, content, or URL)
- citation_no: Official citation e.g. "(2017) 2 SCC 281" (extract if present, else leave empty)
- ratio: The core legal holding (extract from content/snippet; use "" if not available)
- how_helps: How this helps the legal issue above (1-2 sentences based on available info)
- source_url: The exact URL from the search result (always include)
- source_name: Domain name e.g. "indiankanoon.org", "sci.gov.in"
- authority_tier: Copy from the search result (T1 or T2)
- legal_issue: Most relevant issue title from the issues above

## Critical Rules
- INCLUDE results that look like court judgment pages even with partial information
- indiankanoon.org/doc/ URLs are ALWAYS real court judgments — always include them
- sci.gov.in, ecourts.gov.in URLs are official court portals — always include them
- bombayhighcourt.nic.in, allahabad.nic.in etc are official High Court portals — include them
- casemine.com, scconline.com, indiankanoon.org links to commentaries/judgments — include them
- Set parties from page title if full case name not in content
- Set court based on URL domain (sci.gov.in → Supreme Court, bombayhighcourt.nic.in → Bombay High Court)
- NEVER skip a result just because ratio is missing — include with ratio=""
- DO NOT fabricate case names or citations not present in any field

Merge with existing citations (no duplicates by source_url).
Return {"citations": [...]} with ALL extracted candidates.
"""
