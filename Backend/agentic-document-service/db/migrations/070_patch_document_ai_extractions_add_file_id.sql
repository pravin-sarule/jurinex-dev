ALTER TABLE document_ai_extractions
    ADD COLUMN IF NOT EXISTS file_id UUID REFERENCES user_files(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_document_ai_extractions_file_id
    ON document_ai_extractions(file_id);

COMMENT ON COLUMN document_ai_extractions.file_id IS 'Optional uploaded file reference for general case-document extraction workflows.';

