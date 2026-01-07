/**
 * Shared constants for SentinelRAG.
 */

export const LATENCY_BUDGETS = {
  RETRIEVAL: 200, // ms
  RERANKING: 500, // ms
  SYNTHESIS: 3000, // ms
  TOTAL: 5000, // ms
} as const;

export const RAG_CONFIG = {
  TOP_K_KEYWORD: 20,
  TOP_K_VECTOR: 20,
  HYBRID_MERGE_LIMIT: 30,
  RERANKER_TOP_K: 6,
  MAX_CONTEXT_TOKENS: 8000,
} as const;

export const CHUNKING_CONFIG = {
  FIXED_CHUNK_SIZE: 512,
  FIXED_CHUNK_OVERLAP: 128,
  MIN_CHUNK_SIZE: 256,
  MAX_CHUNK_SIZE: 1024,
} as const;

export const EMBEDDING_CONFIG = {
  MODEL: 'text-embedding-3-small',
  DIMENSIONS: 1536,
  CACHE_TTL: 86400, // 24 hours
} as const;
