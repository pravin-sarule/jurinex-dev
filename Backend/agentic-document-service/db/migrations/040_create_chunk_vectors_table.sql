CREATE TABLE IF NOT EXISTS chunk_vectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chunk_id UUID NOT NULL UNIQUE REFERENCES file_chunks(id) ON DELETE CASCADE,
    embedding vector(768) NOT NULL,
    file_id UUID NOT NULL REFERENCES user_files(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE chunk_vectors
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_chunk_vectors_file_id ON chunk_vectors(file_id);
CREATE INDEX IF NOT EXISTS idx_chunk_vectors_chunk_id ON chunk_vectors(chunk_id);

COMMENT ON TABLE chunk_vectors IS 'pgvector embeddings for semantic retrieval over file_chunks.';

