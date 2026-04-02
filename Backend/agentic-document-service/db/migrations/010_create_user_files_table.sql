CREATE TABLE IF NOT EXISTS user_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    originalname VARCHAR(500) NOT NULL,
    gcs_path TEXT,
    gcs_output_path TEXT,
    folder_path TEXT,
    mimetype VARCHAR(255),
    size BIGINT DEFAULT 0,
    is_folder BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(50) NOT NULL DEFAULT 'uploaded',
    processing_progress NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    current_operation VARCHAR(255),
    summary TEXT,
    full_text_content TEXT,
    edited_docx_path TEXT,
    edited_pdf_path TEXT,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_files
    ADD COLUMN IF NOT EXISTS gcs_output_path TEXT,
    ADD COLUMN IF NOT EXISTS current_operation VARCHAR(255),
    ADD COLUMN IF NOT EXISTS summary TEXT,
    ADD COLUMN IF NOT EXISTS full_text_content TEXT,
    ADD COLUMN IF NOT EXISTS edited_docx_path TEXT,
    ADD COLUMN IF NOT EXISTS edited_pdf_path TEXT,
    ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_user_files_user_id ON user_files(user_id);
CREATE INDEX IF NOT EXISTS idx_user_files_folder_path ON user_files(folder_path);
CREATE INDEX IF NOT EXISTS idx_user_files_status ON user_files(status);
CREATE INDEX IF NOT EXISTS idx_user_files_is_folder ON user_files(is_folder);
CREATE INDEX IF NOT EXISTS idx_user_files_created_at ON user_files(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_files_user_folder_name ON user_files(user_id, folder_path, originalname);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_files_user_folder_name_unique
ON user_files(user_id, COALESCE(folder_path, ''), originalname, is_folder);

COMMENT ON TABLE user_files IS 'Shared document registry for uploaded files and folder records.';

