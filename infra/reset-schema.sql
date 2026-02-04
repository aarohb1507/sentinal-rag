-- Reset database schema by dropping and recreating tables
-- This fixes the schema mismatch between init SQL and application code

-- Drop existing tables (CASCADE removes foreign key dependencies)
DROP TABLE IF EXISTS chunks CASCADE;
DROP TABLE IF EXISTS documents CASCADE;
DROP TABLE IF EXISTS evaluation_runs CASCADE;

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create documents table first (referenced by chunks)
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    filename TEXT,
    file_type TEXT,
    total_pages INTEGER,
    total_chunks INTEGER,
    metadata JSONB,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS documents_metadata_idx 
    ON documents USING GIN (metadata);

CREATE INDEX IF NOT EXISTS documents_status_idx 
    ON documents (status);

-- Create chunks table with vector and keyword search indices
CREATE TABLE IF NOT EXISTS chunks (
    id SERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    embedding vector(384),  -- all-MiniLM-L6-v2 dimensions (local sentence-transformers)
    search_vector tsvector,   -- Full-text search vector
    metadata JSONB,
    chunk_type VARCHAR(50) NOT NULL,
    token_count INTEGER NOT NULL,
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Create indices for efficient retrieval

-- Vector similarity search (cosine distance)
CREATE INDEX IF NOT EXISTS chunks_embedding_idx 
    ON chunks USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- Keyword search (GIN index for tsvector)
CREATE INDEX IF NOT EXISTS chunks_search_vector_idx 
    ON chunks USING GIN (search_vector);

-- Metadata search
CREATE INDEX IF NOT EXISTS chunks_metadata_idx 
    ON chunks USING GIN (metadata);

-- General lookups
CREATE INDEX IF NOT EXISTS chunks_chunk_type_idx 
    ON chunks (chunk_type);

CREATE INDEX IF NOT EXISTS chunks_created_at_idx 
    ON chunks (created_at DESC);

CREATE INDEX IF NOT EXISTS chunks_document_id_idx 
    ON chunks (document_id);

-- Create evaluation_runs table for RAG metrics
CREATE TABLE IF NOT EXISTS evaluation_runs (
    id SERIAL PRIMARY KEY,
    request_id VARCHAR(100) UNIQUE NOT NULL,
    query TEXT NOT NULL,
    answer TEXT NOT NULL,
    sources JSONB,
    context_recall FLOAT,
    answer_faithfulness FLOAT,
    answer_relevance FLOAT,
    latency_total INTEGER,  -- milliseconds
    latency_retrieval INTEGER,
    latency_reranking INTEGER,
    latency_synthesis INTEGER,
    chunks_retrieved INTEGER,
    chunks_reranked INTEGER,
    chunks_used INTEGER,
    latency_violations JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS evaluation_runs_request_id_idx 
    ON evaluation_runs (request_id);

CREATE INDEX IF NOT EXISTS evaluation_runs_created_at_idx 
    ON evaluation_runs (created_at DESC);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_chunks_updated_at BEFORE UPDATE ON chunks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_documents_updated_at BEFORE UPDATE ON documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
