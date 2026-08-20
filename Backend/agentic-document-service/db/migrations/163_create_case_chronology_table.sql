-- Unique-date chronology tree produced by form_population_agent during intake.
-- case_key is temp-* during Create Case, then rebound to cases.id on create.
CREATE TABLE IF NOT EXISTS case_chronology (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_key TEXT NOT NULL UNIQUE,
    folder_name TEXT,
    tree JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_documents TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_chronology_folder_name
    ON case_chronology (folder_name);

COMMENT ON TABLE case_chronology IS
    'Grounded case chronology (unique dates, phase tree) from form_population_agent extraction.';
