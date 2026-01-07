/**
 * Core types for SentinelRAG.
 * Shared across API, Worker, and Web packages.
 */

export type ChunkType = 'fixed' | 'semantic';

export interface Chunk {
  id: string;
  content: string;
  embedding: number[];
  metadata: Record<string, any>;
  chunkType: ChunkType;
  tokenCount: number;
  createdAt: Date;
}

export interface Document {
  id: string;
  title: string;
  content: string;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface RetrievalResult {
  chunkId: string;
  content: string;
  score: number;
  metadata: Record<string, any>;
  source: 'keyword' | 'vector' | 'hybrid';
}

export interface QueryRequest {
  query: string;
  options?: {
    topK?: number;
    includeDebug?: boolean;
  };
}

export interface QueryResponse {
  requestId: string;
  query: string;
  answer: string;
  sources: Array<{
    chunkId: string;
    content: string;
    score: number;
    metadata: Record<string, any>;
  }>;
  metadata: {
    latency: {
      total: number;
      retrieval: number;
      reranking: number;
      synthesis: number;
    };
    chunksRetrieved: number;
    chunksReranked: number;
    chunksUsed: number;
  };
  evaluation?: EvaluationMetrics;
}

export interface EvaluationMetrics {
  contextRecall?: number;
  answerFaithfulness?: number;
  answerRelevance?: number;
  latencyBudgetViolations: string[];
}

export interface IngestionRequest {
  text: string;
  metadata?: Record<string, any>;
  chunkingStrategy?: ChunkType;
}

export interface IngestionResponse {
  status: 'success' | 'error';
  chunksCreated: number;
  totalTokens: number;
  chunkingStrategy: ChunkType;
  error?: string;
}
