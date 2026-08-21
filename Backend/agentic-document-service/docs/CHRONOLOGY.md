# Case chronology

Chronology is built by the **same** `form_population_agent` call that auto-fills the Create Case form. There is no second agent and no second pass over the document text.

## What the API returns

A tree of **unique dates** (one node per calendar date), grouped by litigation phase:

```json
{
  "dates": [
    {
      "date": "2019-01-15",
      "displayDate": "15 Jan 2019",
      "precision": "day",
      "phase": "pre_litigation",
      "summary": "The agreement was executed at Pune. Possession was handed over the same day.",
      "events": [
        {
          "title": "Agreement executed",
          "particulars": "The agreement was executed at Pune.",
          "eventType": "agreement",
          "sourceDocument": "plaint.pdf",
          "sourceQuote": "The agreement was executed on 15 January 2019 at Pune.",
          "forum": "Civil Court Pune",
          "caseNumber": "Special Civil Suit 12/2019",
          "sourcePage": "4",
          "exhibit": "Exh. 12",
          "sourceRole": "admitted",
          "disputed": false
        }
      ]
    }
  ],
  "phases": [
    { "id": "pre_litigation", "label": "Pre-litigation", "dates": ["…"] }
  ],
  "sourceDocuments": ["plaint.pdf"],
  "eventCount": 1
}
```

`summary` is 1–5 sentences, built in Python from grounded event particulars (not a free-form model essay).

## Anti-hallucination rules

An LLM event is **dropped** unless all of these pass:

1. `date` parses (Indian documents: **DD/MM/YYYY** first).
2. `sourceQuote` is at least 12 characters and appears in the OCR text (whitespace-normalised).
3. A written form of that date also appears in the OCR text (`15 Jan 2019`, `15/01/2019`, `2019-01-15`, …).

Invented dates, empty quotes, and “typical” facts never enter the tree.

Year-only keys (`2014`) are allowed when the document states the year but not the day. The UI marks those as “exact day not on record”. Fully invented undated events are still dropped.

## Coverage rules (same LLM call)

There is still **no second agent** and no second read of the PDF. The extra chronology instructions now also require:

- Procedural verbs in narrative paragraphs (`filed`, `transferred`, `renumbered`, `disposed`, `preferred`, …), including year-only entries
- Forum and case number when written
- Pin cites (`sourcePage`, `exhibit`) when the OCR actually shows them
- `sourceRole` + `disputed` so pleaded allegations are not flattened as findings
- Court-register dates over advocate signature/verification dates
- `correspondence` for letters between parties (not `pleadings`)

## No repeat dates

Python merge uses `date` as the unique key:

- `15/01/2019`, `15 Jan 2019`, and `2019-01-15` become **one** node.
- Two different happenings on the same day become two `events` under that node; the date is listed once.
- Duplicate titles on the same day are ignored (same event seen in two PDFs).

Month-only (`2019-01`) and year-only (`2019`) keys stay separate from a full day.

## Code layout

| File | Role |
|---|---|
| `app/services/chronology/prompt.py` | Extra JSON instructions appended to auto-fill |
| `app/services/chronology/dates.py` | Parse / unique keys / source variants |
| `app/services/chronology/grounding.py` | Quote + date must exist in OCR |
| `app/services/chronology/extract.py` | Coerce LLM JSON → grounded events |
| `app/services/chronology/merge.py` | Unique dates, summaries, phase tree |
| `app/services/chronology/persist.py` | `case_chronology` table |
| `app/services/chronology/service.py` | Called from `folder_service` |
| `app/schemas/chronology.py` | Response models |

Intake: `FolderWorkflowService._merge_extracted_case_data` runs extract on **every** `temp-*` document (form fields first-wins; events always merge).

On `POST /api/files/create`, the temp-folder tree is rebound to the real `cases.id`.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/files/{folderName}/extract-case-fields` | Form fields + `chronology` (and `extractedData.chronology`) |
| `GET` | `/api/files/{folderName}/chronology` | Tree only |
| `GET` | `/api/files/cases/{caseId}` | Case payload includes `chronology` |

## Database

Migration: `db/migrations/163_create_case_chronology_table.sql`

```bash
cd Backend/agentic-document-service/db
# DATABASE_URL must be set
node migrate.js
```

Missing table does not fail upload; persist is best-effort and logged as a warning.

## Console logs

On each intake extract the document-service console prints:

1. Progress bars — `1/4` OCR → `2/4` LLM → `3/4` ground dates → `4/4` merge
2. A boxed **model / input tokens / output tokens / cost** table
3. Unverifiable events dropped (quote or date not in OCR)
4. Unique-date table and an ASCII phase tree (`phase → date → event`)

Look for component **`AutoFill`**. Example progress line:

```
[AutoFill] [########--------]  2/4   50%  LLM extract  agent=form_population_agent
```

## Tests

```bash
cd Backend/agentic-document-service
python -m unittest tests.test_chronology_dates tests.test_chronology_merge tests.test_chronology_console
```
