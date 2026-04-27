CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name TEXT NOT NULL,
    original_extension VARCHAR(10),
    gcs_input_path TEXT NOT NULL UNIQUE,
    gcs_ocr_path TEXT,
    processing_status VARCHAR(20) CHECK (processing_status IN (
        'uploaded', 'ocr_processing', 'ocr_completed',
        'embedding_processing', 'active', 'failed'
    )),
    document_type VARCHAR(50),
    checksum TEXT,
    total_pages INT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_doc_status ON documents(processing_status);
