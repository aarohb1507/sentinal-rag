import { sql } from '../utils/db';
import { logger } from '../utils/logger';

/**
 * Retrieval Service
 * 
 * Implements HYBRID RETRIEVAL:
 * 1. Keyword search (PostgreSQL tsvector - BM25-style)
 * 2. Vector search (pgvector - cosine similarity)
 * 3. Merge, deduplicate, and rank results
 * 
 * Why hybrid:
 * - Vector-only misses exact keyword matches (acronyms, product IDs)
 * - Keyword-only misses semantic similarity (synonyms, paraphrases)
 * - Hybrid combines strengths of both
 */

export interface RetrievalResult {
  chunkId: string;
  content: string;
  score: number;
  metadata: Record<string, any>;
  source: 'keyword' | 'vector' | 'hybrid';
  relevanceScore?: number;
}

/**
 * Perform hybrid retrieval: keyword + vector search.
 * 
 * @param query - User query text
 * @param queryEmbedding - Query embedding vector (1536 dimensions)
 * @param topK - Number of results to return
 * @returns Merged and ranked results
 */
export async function hybridRetrieval(
  query: string,
  queryEmbedding: number[],
  topK: number = 30
): Promise<RetrievalResult[]> {
  const startTime = Date.now();

  try {
    // Run keyword and vector searches in parallel
    const [keywordResults, vectorResults] = await Promise.all([
      keywordSearch(query, topK),
      vectorSearch(queryEmbedding, topK),
    ]);

    // Merge and deduplicate
    const merged = mergeResults(keywordResults, vectorResults);

    // Sort by combined score and limit
    const ranked = merged
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    const latency = Date.now() - startTime;
    logger.info({ latency, resultsCount: ranked.length }, 'Hybrid retrieval completed');

    return ranked;
  } catch (error) {
    logger.error({ error }, 'Hybrid retrieval failed');
    throw error;
  }
}

/**
 * Keyword search using PostgreSQL full-text search (tsvector).
 * 
 * Uses ts_rank_cd for BM25-style ranking.
 */
async function keywordSearch(
  query: string,
  topK: number
): Promise<RetrievalResult[]> {
  const results = await sql`
    SELECT 
      id::text as chunk_id,
      content,
      ts_rank_cd(search_vector, plainto_tsquery('english', ${query})) as score,
      metadata
    FROM chunks
    WHERE search_vector @@ plainto_tsquery('english', ${query})
    ORDER BY score DESC
    LIMIT ${topK}
  `;

  return results.map((row: any) => ({
    chunkId: row.chunk_id,
    content: row.content,
    score: parseFloat(row.score),
    metadata: row.metadata || {},
    source: 'keyword' as const,
  }));
}

/**
 * Vector search using pgvector cosine similarity.
 * 
 * Uses <=> operator for cosine distance (lower = more similar).
 */
async function vectorSearch(
  queryEmbedding: number[],
  topK: number
): Promise<RetrievalResult[]> {
  // Format embedding as PostgreSQL array literal for pgvector
  const vectorString = `[${queryEmbedding.join(',')}]`;
  
  const results = await sql`
    SELECT 
      id::text as chunk_id,
      content,
      1 - (embedding <=> ${vectorString}::vector) as score,
      metadata
    FROM chunks
    ORDER BY embedding <=> ${vectorString}::vector
    LIMIT ${topK}
  `;

  return results.map((row: any) => ({
    chunkId: row.chunk_id,
    content: row.content,
    score: parseFloat(row.score),
    metadata: row.metadata || {},
    source: 'vector' as const,
  }));
}

/**
 * Merge results from keyword and vector search.
 * 
 * Strategy:
 * - Deduplicate by chunk ID
 * - For duplicates, keep highest score
 * - Mark source as 'hybrid' if chunk appears in both
 */
function mergeResults(
  keywordResults: RetrievalResult[],
  vectorResults: RetrievalResult[]
): RetrievalResult[] {
  const merged = new Map<string, RetrievalResult>();

  for (const result of keywordResults) {
    merged.set(result.chunkId, result);
  }

  for (const result of vectorResults) {
    const existing = merged.get(result.chunkId);
    if (existing) {
      // Chunk appears in both - take max score and mark as hybrid
      merged.set(result.chunkId, {
        ...result,
        score: Math.max(existing.score, result.score),
        source: 'hybrid',
      });
    } else {
      merged.set(result.chunkId, result);
    }
  }

  return Array.from(merged.values());
}
