# Auto-fill (form population)

Create Case upload fills the intake form from OCR text using **one LLM call** per document, via `form_population_agent`.

## Which admin row

Super Admin → **Agent Prompt Management** → **Summarization Agents** → **`form_population_agent`**.

That row’s model is what `_generate_text(..., agent_name="form_population_agent")` uses. In this workspace it is **`gemini-3.7-flash`**.

Resolution order if the row is missing:

1. `public.agent_prompts` (`agent_type` intake / form_population)
2. `ADK_MODEL` in `.env`
3. hardcoded `gemini-2.5-pro`

## Pipeline

1. Google **Document AI** OCRs the file (not an LLM).
2. Text is chunked and embedded (`gemini-embedding-001`).
3. For intake folders (`temp-*`), `FolderWorkflowService._merge_extracted_case_data` calls `DocumentAIAdapter.extract`.
4. Extract sends `_EXTRACTION_PROMPT` + up to 80k characters of text through `form_population_agent`.
5. JSON form fields are first-wins merged into `_extracted_by_case`.
6. The same JSON’s `events` array is grounded and merged into the chronology tree (see [CHRONOLOGY.md](CHRONOLOGY.md)).
7. `POST /api/files/{folderName}/extract-case-fields` returns `extractedData` (form fields + `chronology`).

## Form fields

`caseTitle`, `caseNumber`, `caseType`, `courtName`, parties, `filingDate`, and the other camelCase keys in `_EXTRACTION_PROMPT`. Unknown keys are dropped by `_normalize_entities` except chronology, which is handled separately.

If the LLM returns nothing, a regex fallback tries case number, `X vs Y`, dates, and court name.

## Cost

Document **input** tokens are billed once per file. Chronology is extra **output** only — there is no second chronology agent reading the same PDF.

## Logs to confirm the model

```
[DocumentAI] LLM IN USE  provider=gemini  model=gemini-3.7-flash  agent=form_population_agent
```
