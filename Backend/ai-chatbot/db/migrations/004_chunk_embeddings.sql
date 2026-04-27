-- 768-dim embeddings (gemini-embedding-001 truncated via output_dimensionality=768)
CREATE TABLE IF NOT EXISTS chunk_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chunk_id UUID NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
    embedding vector(768),
    task_type VARCHAR(50) DEFAULT 'RETRIEVAL_DOCUMENT',
    model_name VARCHAR(50) DEFAULT 'models/gemini-embedding-001'
);

-- HNSW index for fast approximate nearest-neighbour cosine search
CREATE INDEX IF NOT EXISTS idx_vector_768_search ON chunk_embeddings
USING hnsw (embedding vector_cosine_ops);

-- One embedding per chunk
CREATE UNIQUE INDEX IF NOT EXISTS idx_chunk_embedding_unique ON chunk_embeddings(chunk_id);
