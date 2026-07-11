CREATE TABLE IF NOT EXISTS document_ai_extractions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_file_id UUID,
    file_id UUID REFERENCES user_files(id) ON DELETE CASCADE,
    file_type TEXT,
    document_ai_processor_id TEXT,
    document_ai_processor_version TEXT,
    document_ai_operation_name TEXT,
    document_ai_request_id TEXT,
    extracted_text TEXT,
    extracted_text_hash TEXT,
    page_count INTEGER,
    total_characters INTEGER,
    total_words INTEGER,
    total_paragraphs INTEGER,
    entities JSONB DEFAULT '{}'::jsonb,
    form_fields JSONB DEFAULT '{}'::jsonb,
    tables JSONB DEFAULT '[]'::jsonb,
    confidence_score DOUBLE PRECISION,
    average_confidence DOUBLE PRECISION,
    min_confidence DOUBLE PRECISION,
    max_confidence DOUBLE PRECISION,
    processing_status TEXT DEFAULT 'processed',
    processing_error TEXT,
    processing_duration_ms INTEGER,
    metadata JSONB DEFAULT '{}'::jsonb,
    raw_response JSONB,
    structured_schema JSONB,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE document_ai_extractions
    ADD COLUMN IF NOT EXISTS file_id UUID REFERENCES user_files(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS file_type TEXT,
    ADD COLUMN IF NOT EXISTS document_ai_processor_id TEXT,
    ADD COLUMN IF NOT EXISTS document_ai_processor_version TEXT,
    ADD COLUMN IF NOT EXISTS document_ai_operation_name TEXT,
    ADD COLUMN IF NOT EXISTS document_ai_request_id TEXT,
    ADD COLUMN IF NOT EXISTS extracted_text TEXT,
    ADD COLUMN IF NOT EXISTS extracted_text_hash TEXT,
    ADD COLUMN IF NOT EXISTS page_count INTEGER,
    ADD COLUMN IF NOT EXISTS total_characters INTEGER,
    ADD COLUMN IF NOT EXISTS total_words INTEGER,
    ADD COLUMN IF NOT EXISTS total_paragraphs INTEGER,
    ADD COLUMN IF NOT EXISTS entities JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS form_fields JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS tables JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS confidence_score DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS average_confidence DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS min_confidence DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS max_confidence DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS processing_status TEXT DEFAULT 'processed',
    ADD COLUMN IF NOT EXISTS processing_error TEXT,
    ADD COLUMN IF NOT EXISTS processing_duration_ms INTEGER,
    ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS raw_response JSONB,
    ADD COLUMN IF NOT EXISTS structured_schema JSONB,
    ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'document_ai_extractions'
          AND column_name = 'template_file_id'
    ) THEN
        ALTER TABLE document_ai_extractions ALTER COLUMN template_file_id DROP NOT NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_document_ai_extractions_file_id
    ON document_ai_extractions(file_id);

CREATE INDEX IF NOT EXISTS idx_document_ai_extractions_processed_at
    ON document_ai_extractions(processed_at DESC);

COMMENT ON COLUMN document_ai_extractions.file_id IS 'Uploaded case/document file reference for OCR and structured Document AI artifacts.';
COMMENT ON COLUMN document_ai_extractions.structured_schema IS 'Compact structured OCR layout JSON used to reconstruct the document beside the original preview.';
