-- ============================================================
-- Indian Kanoon API enrichment — DB schema migrations
-- Run these on citation_db (PostgreSQL)
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1.  NEW TABLE: ik_document_assets
--     Stores all IK API responses for each doc_id (tid).
--     One row per IK document. Updated on re-fetch.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ik_document_assets (
    id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

    -- IK document identifier (tid from search results)
    doc_id                VARCHAR(64)   NOT NULL,

    -- FK to local judgments table (canonical_id)
    canonical_id          VARCHAR(128),

    -- Response from /docmeta/<id>/
    -- Contains: tid, title, docsource, publishdate, numcites, etc.
    meta                  JSONB,

    -- Response from /docfragment/<id>/?formInput=<query>
    -- Contains: { headline (HTML snippet), formInput, title, tid }
    fragments             JSONB,

    -- citeList from /doc/<id>/?maxcites=N
    -- Array of { tid, title, docsource }
    cite_list             JSONB,

    -- citedbyList from /doc/<id>/?maxcitedby=N
    -- Array of { tid, title, docsource }
    cited_by_list         JSONB,

    -- GCS signed URL of the uploaded PDF (from /origdoc/<id>/)
    orig_doc_url          TEXT,

    -- GCS object path e.g. "ik_origdocs/1234567.pdf"
    orig_doc_gcs_path     TEXT,

    -- MIME type: "application/pdf" or "text/html"
    orig_doc_content_type VARCHAR(64),

    created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    UNIQUE (doc_id)
);

CREATE INDEX IF NOT EXISTS idx_ik_assets_doc_id    ON ik_document_assets(doc_id);
CREATE INDEX IF NOT EXISTS idx_ik_assets_canonical ON ik_document_assets(canonical_id);


-- ────────────────────────────────────────────────────────────
-- 2.  ALTER TABLE judgments — add IK enrichment columns
--     Safe to run multiple times (IF NOT EXISTS guard).
-- ────────────────────────────────────────────────────────────

-- GCS URL of the original court copy PDF uploaded from /origdoc/<id>/
ALTER TABLE judgments
    ADD COLUMN IF NOT EXISTS ik_orig_doc_url TEXT;

-- Cached fragment from /docfragment/ — { headline, headline_html, form_input }
ALTER TABLE judgments
    ADD COLUMN IF NOT EXISTS ik_fragments JSONB;

-- citeList — cases this judgment cites (array of {tid, title, docsource})
ALTER TABLE judgments
    ADD COLUMN IF NOT EXISTS ik_cite_list JSONB;

-- citedbyList — cases that cite this judgment (array of {tid, title, docsource})
ALTER TABLE judgments
    ADD COLUMN IF NOT EXISTS ik_cited_by_list JSONB;

-- Full /docmeta/ response (tid, publishdate, docsource, numcites, etc.)
ALTER TABLE judgments
    ADD COLUMN IF NOT EXISTS ik_doc_meta JSONB;


-- ────────────────────────────────────────────────────────────
-- 3.  VERIFICATION — run these SELECT queries to confirm
-- ────────────────────────────────────────────────────────────

-- Check new table exists:
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'ik_document_assets';

-- Check new columns on judgments:
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'judgments'
  AND column_name IN (
      'ik_orig_doc_url',
      'ik_fragments',
      'ik_cite_list',
      'ik_cited_by_list',
      'ik_doc_meta'
  )
ORDER BY column_name;


-- ────────────────────────────────────────────────────────────
-- 4.  SAMPLE QUERIES
-- ────────────────────────────────────────────────────────────

-- Find all judgments that have an original court copy PDF:
SELECT canonical_id, ik_orig_doc_url, ik_doc_meta->>'title' AS title
FROM judgments
WHERE ik_orig_doc_url IS NOT NULL
ORDER BY created_at DESC
LIMIT 20;

-- Retrieve IK asset for a specific doc_id (tid):
SELECT doc_id, orig_doc_url, orig_doc_content_type,
       jsonb_array_length(COALESCE(cite_list, '[]'::jsonb))    AS cite_count,
       jsonb_array_length(COALESCE(cited_by_list, '[]'::jsonb)) AS cited_by_count,
       updated_at
FROM ik_document_assets
WHERE doc_id = '<your_tid_here>';

-- Find all judgments cited by a specific case (by canonical_id):
SELECT j.canonical_id, j.case_name,
       jsonb_array_length(j.ik_cite_list) AS num_cites
FROM judgments j
WHERE j.ik_cite_list IS NOT NULL
  AND jsonb_array_length(j.ik_cite_list) > 0
ORDER BY num_cites DESC
LIMIT 20;

-- Get the fragment snippet for a case:
SELECT j.canonical_id,
       j.ik_fragments->>'headline' AS fragment_text
FROM judgments j
WHERE j.ik_fragments IS NOT NULL
  AND j.ik_fragments->>'headline' <> ''
LIMIT 10;
