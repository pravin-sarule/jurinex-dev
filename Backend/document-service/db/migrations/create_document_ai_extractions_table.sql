-- Migration: Create document_ai_extractions table
-- This table stores Document AI extraction results for template files

CREATE TABLE IF NOT EXISTS document_ai_extractions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Relation to template_files table
    template_file_id UUID NOT NULL REFERENCES template_files(id) ON DELETE CASCADE,
    
    -- File type (input/output)
    file_type TEXT,
    
    -- Google Document AI Processor info
    document_ai_processor_id TEXT,
    document_ai_processor_version TEXT,
    document_ai_operation_name TEXT,
    document_ai_request_id TEXT,
    
    -- Extracted content
    extracted_text TEXT,
    extracted_text_hash TEXT,
    
    -- Counts & statistics
    page_count INTEGER,
    total_characters INTEGER,
    total_words INTEGER,
    total_paragraphs INTEGER,
    
    -- Extracted structured entities
    entities JSONB DEFAULT '[]'::jsonb,
    form_fields JSONB DEFAULT '[]'::jsonb,
    tables JSONB DEFAULT '[]'::jsonb,
    
    -- Confidence scores
    confidence_score NUMERIC,
    average_confidence NUMERIC,
    min_confidence NUMERIC,
    max_confidence NUMERIC,
    
    -- Processing status
    processing_status TEXT,               -- completed / failed / pending
    processing_error TEXT,
    processing_duration_ms INTEGER,
    
    -- Additional metadata
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Timestamps
    processed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    deleted_at TIMESTAMP,
    
    -- Raw Document AI response
    raw_response JSONB,
    
    -- Structured schema (JSON of your dynamic form schema)
    structured_schema JSONB
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_document_ai_extractions_template_file_id 
    ON document_ai_extractions(template_file_id);

CREATE INDEX IF NOT EXISTS idx_document_ai_extractions_file_type 
    ON document_ai_extractions(file_type);

CREATE INDEX IF NOT EXISTS idx_document_ai_extractions_processing_status 
    ON document_ai_extractions(processing_status);

CREATE INDEX IF NOT EXISTS idx_document_ai_extractions_created_at 
    ON document_ai_extractions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_document_ai_extractions_deleted_at 
    ON document_ai_extractions(deleted_at) WHERE deleted_at IS NULL;

-- Create GIN indexes for JSONB columns for faster queries
CREATE INDEX IF NOT EXISTS idx_document_ai_extractions_entities 
    ON document_ai_extractions USING GIN (entities);

CREATE INDEX IF NOT EXISTS idx_document_ai_extractions_form_fields 
    ON document_ai_extractions USING GIN (form_fields);

CREATE INDEX IF NOT EXISTS idx_document_ai_extractions_tables 
    ON document_ai_extractions USING GIN (tables);

CREATE INDEX IF NOT EXISTS idx_document_ai_extractions_structured_schema 
    ON document_ai_extractions USING GIN (structured_schema);

CREATE INDEX IF NOT EXISTS idx_document_ai_extractions_raw_response 
    ON document_ai_extractions USING GIN (raw_response);

CREATE INDEX IF NOT EXISTS idx_document_ai_extractions_metadata 
    ON document_ai_extractions USING GIN (metadata);

-- Add comment to table
COMMENT ON TABLE document_ai_extractions IS 'Stores Document AI extraction results for template files, including extracted text, structured schema, entities, form fields, and tables';

-- Add comments to key columns
COMMENT ON COLUMN document_ai_extractions.template_file_id IS 'Foreign key reference to template_files table';
COMMENT ON COLUMN document_ai_extractions.extracted_text IS 'Plain text extracted from the document';
COMMENT ON COLUMN document_ai_extractions.structured_schema IS 'JSON schema defining the structure of the extracted form data';
COMMENT ON COLUMN document_ai_extractions.entities IS 'Array of extracted entities (JSONB)';
COMMENT ON COLUMN document_ai_extractions.form_fields IS 'Array of extracted form fields (JSONB)';
COMMENT ON COLUMN document_ai_extractions.tables IS 'Array of extracted tables (JSONB)';
COMMENT ON COLUMN document_ai_extractions.raw_response IS 'Complete raw response from Document AI API';




