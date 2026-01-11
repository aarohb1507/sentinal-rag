import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // Server
  env: process.env.NODE_ENV || 'development',
  host: process.env.HOST || '0.0.0.0',
  port: parseInt(process.env.PORT || '3000', 10),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3001').split(','),

  // Database
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'sentinelrag',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },

  // Redis
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  // Groq (LLM Provider for MVP)
  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  },

  // Embeddings (via Worker - sentence-transformers)
  embeddings: {
    workerUrl: process.env.WORKER_URL || 'http://localhost:8000',
    model: process.env.EMBEDDINGS_MODEL || 'all-MiniLM-L6-v2',
    dimension: 384, // all-MiniLM-L6-v2 output dimension
  },

  // RAG Configuration
  rag: {
    // Retrieval
    topKKeyword: parseInt(process.env.RAG_TOP_K_KEYWORD || '20', 10),
    topKVector: parseInt(process.env.RAG_TOP_K_VECTOR || '20', 10),
    hybridMergeLimit: parseInt(process.env.RAG_HYBRID_MERGE_LIMIT || '30', 10),
    
    // Reranking
    rerankerTopK: parseInt(process.env.RAG_RERANKER_TOP_K || '6', 10),
    
    // Latency budgets (ms)
    latencyBudgets: {
      retrieval: parseInt(process.env.LATENCY_RETRIEVAL || '200', 10),
      reranking: parseInt(process.env.LATENCY_RERANKING || '500', 10),
      synthesis: parseInt(process.env.LATENCY_SYNTHESIS || '3000', 10),
    },
  },
} as const;
