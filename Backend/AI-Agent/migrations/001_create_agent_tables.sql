-- Create agent_documents table (similar to user_files but without user_id)
CREATE TABLE IF NOT EXISTS agent_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  originalname VARCHAR(500) NOT NULL,
  gcs_path TEXT NOT NULL,
  folder_path TEXT NOT NULL,
  mimetype VARCHAR(255),
  size BIGINT,
  status VARCHAR(50) DEFAULT 'uploaded',
  processing_progress DECIMAL(5,2) DEFAULT 0.00,
  current_operation TEXT,
  summary TEXT,
  processed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create agent_file_chunks table
CREATE TABLE IF NOT EXISTS agent_file_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES agent_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER,
  page_start INTEGER,
  page_end INTEGER,
  heading TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(file_id, chunk_index)
);

-- Create agent_chunk_vectors table (with pgvector extension)
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS agent_chunk_vectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id UUID NOT NULL UNIQUE REFERENCES agent_file_chunks(id) ON DELETE CASCADE,
  embedding vector(768),
  file_id UUID NOT NULL REFERENCES agent_documents(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create agent_file_chats table (supports multiple file_ids)
CREATE TABLE IF NOT EXISTS agent_file_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_ids UUID[] NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  session_id UUID NOT NULL,
  used_chunk_ids UUID[],
  chat_history JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_agent_documents_status ON agent_documents(status);
CREATE INDEX IF NOT EXISTS idx_agent_documents_created_at ON agent_documents(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_file_chunks_file_id ON agent_file_chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_agent_file_chunks_chunk_index ON agent_file_chunks(file_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_agent_chunk_vectors_file_id ON agent_chunk_vectors(file_id);
CREATE INDEX IF NOT EXISTS idx_agent_chunk_vectors_embedding ON agent_chunk_vectors USING ivfflat (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_agent_file_chats_session_id ON agent_file_chats(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_file_chats_file_ids ON agent_file_chats USING GIN(file_ids);
CREATE INDEX IF NOT EXISTS idx_agent_file_chats_created_at ON agent_file_chats(created_at DESC);
