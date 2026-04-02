CREATE TABLE IF NOT EXISTS chunk_embedding_cache (
    content_hash VARCHAR(64) PRIMARY KEY,
    embedding vector(768) NOT NULL,
    model VARCHAR(255) NOT NULL,
    token_count INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chunk_embedding_cache_model ON chunk_embedding_cache(model);
CREATE INDEX IF NOT EXISTS idx_chunk_embedding_cache_updated_at ON chunk_embedding_cache(updated_at DESC);

COMMENT ON TABLE chunk_embedding_cache IS 'Content-hash keyed embedding cache to reduce repeated embedding generation cost.';
