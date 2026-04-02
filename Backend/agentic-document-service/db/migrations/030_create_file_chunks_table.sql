CREATE TABLE IF NOT EXISTS file_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES user_files(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    token_count INTEGER,
    page_start INTEGER,
    page_end INTEGER,
    heading TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT file_chunks_file_chunk_unique UNIQUE (file_id, chunk_index)
);

ALTER TABLE file_chunks
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_file_chunks_file_id ON file_chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_file_chunks_chunk_index ON file_chunks(file_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_file_chunks_page_range ON file_chunks(file_id, page_start, page_end);

COMMENT ON TABLE file_chunks IS 'Normalized chunk storage for retrieval-augmented generation and grounded citations.';

