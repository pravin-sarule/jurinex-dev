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
          "sourceQuote": "The agreement was executed on 15 January 2019 at Pune."
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

## Tests

```bash
cd Backend/agentic-document-service
python -m unittest tests.test_chronology_dates tests.test_chronology_merge
```
