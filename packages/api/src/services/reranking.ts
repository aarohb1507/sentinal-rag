import { llm } from '../utils/llm';
import { logger } from '../utils/logger';
import type { RetrievalResult } from './retrieval';

/**
 * Reranking Service
 * 
 * Purpose: PRECISION FILTER after recall-focused retrieval.
 * 
 * Flow:
 * 1. Retrieval returns ~30 chunks (high recall)
 * 2. Reranker scores each chunk for relevance (precision)
 * 3. Return top 5-8 chunks for synthesis
 * 
 * Why reranking:
 * - Reduces noise in context (less hallucination)
 * - Improves answer relevance
 * - Lower token cost (fewer chunks to synthesis)
 * 
 * MVP Optimization:
 * - BATCH SCORING: Group chunks into batches
 * - Before: 1 LLM call per chunk (20-30 calls)
 * - After: ~4-6 calls total (80% reduction)
 * - Uses Groq for fast, cheap inference
 * 
 * Resilience:
 * - CIRCUIT BREAKER: Protects against LLM failures/slowness
 * - CLOSED: Normal operation, calls LLM
 * - OPEN: LLM failing, uses fallback (hybrid score refinement)
 * - HALF_OPEN: Testing recovery
 */

export interface RankedResult extends RetrievalResult {
  relevanceScore: number;
}

/**
 * Circuit Breaker States
 */
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * Circuit Breaker for LLM reranking.
 * Tracks failures and latency to protect system from slow/broken LLM.
 */
class RerankingCircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold = 5;        // Trip after 5 failures
  private readonly latencyThreshold = 5000;     // 5 seconds max latency
  private readonly resetTimeout = 30000;        // Try recovery after 30s

  /**
   * Check if circuit is OPEN and ready to test recovery
   */
  private shouldAttemptReset(): boolean {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime >= this.resetTimeout) {
        this.state = 'HALF_OPEN';
        logger.info('Circuit breaker: HALF_OPEN, testing LLM recovery');
        return true;
      }
    }
    return false;
  }

  /**
   * Check if we should use fallback (circuit is OPEN)
   */
  shouldUseFallback(): boolean {
    this.shouldAttemptReset();
    return this.state === 'OPEN';
  }

  /**
   * Record successful LLM call
   */
  recordSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      logger.info('Circuit breaker: CLOSED, LLM recovered');
    }
    this.failureCount = 0;
  }

  /**
   * Record failed or slow LLM call
   */
  recordFailure(reason: string): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      if (this.state !== 'OPEN') {
        this.state = 'OPEN';
        logger.warn({ reason, failureCount: this.failureCount }, 'Circuit breaker: OPEN, using fallback');
      }
    } else {
      logger.warn({ reason, failureCount: this.failureCount }, 'LLM failure recorded');
    }
  }

  /**
   * Get current circuit state for logging
   */
  getState(): CircuitState {
    return this.state;
  }
}

// Global circuit breaker instance
const circuitBreaker = new RerankingCircuitBreaker();

/**
 * Rerank chunks by relevance to query.
 * 
 * BATCH OPTIMIZATION:
 * - Groups chunks (e.g., 5 per batch)
 * - Scores all chunks in batch with single LLM call
 * - Reduces from 30 calls → ~6 calls
 * 
 * CIRCUIT BREAKER:
 * - If LLM is slow/failing, uses fallback refinement
 * - Fallback combines vector + keyword scores without LLM
 * - Ensures fast, reliable responses even when LLM unavailable
 * 
 * @param query - User query
 * @param chunks - Retrieved chunks from hybrid search
 * @param topK - Number of top chunks to return
 * @param queryEmbedding - Optional query embedding for fallback refinement
 * @returns Top-K chunks sorted by relevance
 */
export async function rerankChunks(
  query: string,
  chunks: RetrievalResult[],
  topK: number = 6,
  queryEmbedding?: number[]
): Promise<RankedResult[]> {
  const startTime = Date.now();

  try {
    // Check if circuit breaker is OPEN (LLM failing)
    if (circuitBreaker.shouldUseFallback()) {
      logger.info('Using fallback reranking (circuit breaker OPEN)');
      const fallbackResults = fallbackRerank(query, chunks, topK, queryEmbedding);
      const latency = Date.now() - startTime;
      logger.info({ latency, outputCount: fallbackResults.length, method: 'fallback' }, 'Fallback reranking completed');
      return fallbackResults;
    }

    // Normal path: LLM-based reranking
    const batchSize = 5;
    const batches = [];

    for (let i = 0; i < chunks.length; i += batchSize) {
      batches.push(chunks.slice(i, i + batchSize));
    }

    // Score each batch
    const scoredChunksPerBatch = await Promise.all(
      batches.map((batch) => scoreChunkBatch(query, batch))
    );

    // Flatten results
    const scoredChunks = scoredChunksPerBatch.flat();

    // Sort by relevance score and take top-K
    const ranked = scoredChunks
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, topK);

    const latency = Date.now() - startTime;

    // Check if latency exceeded threshold
    if (latency > 5000) {
      circuitBreaker.recordFailure(`High latency: ${latency}ms`);
    } else {
      circuitBreaker.recordSuccess();
    }

    logger.info(
      { latency, inputCount: chunks.length, batchCount: batches.length, outputCount: ranked.length, circuitState: circuitBreaker.getState() },
      'LLM reranking completed'
    );

    return ranked;
  } catch (error) {
    circuitBreaker.recordFailure(`LLM error: ${error}`);
    logger.error({ error }, 'LLM reranking failed, using fallback');
    
    // Use fallback on error
    const fallbackResults = fallbackRerank(query, chunks, topK, queryEmbedding);
    const latency = Date.now() - startTime;
    logger.info({ latency, outputCount: fallbackResults.length, method: 'fallback' }, 'Fallback reranking completed after error');
    return fallbackResults;
  }
}

/**
 * Fallback reranking when LLM is unavailable (circuit breaker OPEN).
 * 
 * Strategy:
 * 1. Extract vector_score and keyword_score from retrieval results
 * 2. Normalize both scores to 0-1 range
 * 3. Compute combined score: 0.6 * vector + 0.4 * keyword
 * 4. Sort by combined score and return top-K
 * 
 * Why this works:
 * - Uses existing retrieval scores (no DB queries)
 * - Balances semantic similarity (vector) and exact matches (keyword)
 * - Fast (pure computation, no API calls)
 * - Deterministic (same input = same output)
 * 
 * @param query - User query text
 * @param chunks - Retrieved chunks with scores
 * @param topK - Number of top chunks to return
 * @param queryEmbedding - Optional query embedding (currently unused, for future enhancement)
 * @returns Top-K chunks sorted by combined score
 */
function fallbackRerank(
  query: string,
  chunks: RetrievalResult[],
  topK: number,
  queryEmbedding?: number[]
): RankedResult[] {
  if (chunks.length === 0) {
    return [];
  }

  // Find max scores for normalization (scores already in chunks from PostgreSQL)
  let maxVector = 0;
  let maxKeyword = 0;
  
  for (const chunk of chunks) {
    maxVector = Math.max(maxVector, chunk.vectorScore);
    maxKeyword = Math.max(maxKeyword, chunk.keywordScore);
  }

  // Avoid division by zero
  maxVector = maxVector || 1;
  maxKeyword = maxKeyword || 1;

  // Compute combined scores for each chunk
  const rankedChunks: RankedResult[] = chunks.map((chunk) => {
    // Normalize scores to 0-1 range (PostgreSQL scores already computed)
    const normalizedVector = chunk.vectorScore / maxVector;
    const normalizedKeyword = chunk.keywordScore / maxKeyword;
    
    // Combined score: weighted average (favor vector slightly)
    // Vector: 60% weight (semantic similarity from pgvector)
    // Keyword: 40% weight (exact/phrase matches from ts_rank_cd)
    const combinedScore = 0.6 * normalizedVector + 0.4 * normalizedKeyword;
    
    return {
      ...chunk,
      relevanceScore: combinedScore,
    };
  });

  // Sort by combined score descending and return top-K
  // (Same format as LLM reranking - chunks with relevanceScore)
  return rankedChunks
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, topK);
}

/**
 * Score a batch of chunks in a single LLM call.
 * 
 * Prompt groups multiple chunks and asks for JSON scores.
 * This reduces API calls from 30 to ~6.
 */
async function scoreChunkBatch(
  query: string,
  chunks: RetrievalResult[]
): Promise<RankedResult[]> {
  try {
    // Build batch prompt
    const chunksText = chunks
      .map(
        (chunk, idx) =>
          `[Chunk ${idx + 1}] ${chunk.content.substring(0, 200)}...`
      )
      .join('\n\n');

    const prompt = `You are a relevance scoring system. Given a query and text chunks, score each chunk's relevance to the query (0.0-1.0).

Respond with ONLY a JSON array of numbers (one score per chunk):
[score1, score2, ...]

Query: ${query}

Chunks:
${chunksText}

Scores:`;

    const responseText = await llm.generate(prompt, {
      temperature: 0,
      maxTokens: 100,
    });

    // Parse JSON array of scores
    const scoresMatch = responseText.match(/\[[\d\s.,]+\]/);
    if (!scoresMatch) {
      logger.warn({ responseText }, 'Failed to parse scores, using defaults');
      return chunks.map((chunk, idx) => ({
        ...chunk,
        relevanceScore: 1 - idx * 0.1, // Default: descending
      }));
    }

    const scores = JSON.parse(scoresMatch[0]) as number[];

    return chunks.map((chunk, idx) => ({
      ...chunk,
      relevanceScore: Math.max(0, Math.min(1, scores[idx] || 0)),
    }));
  } catch (error) {
    logger.warn({ error }, 'Batch scoring failed, using default scores');
    return chunks.map((chunk, idx) => ({
      ...chunk,
      relevanceScore: 1 - idx * 0.1,
    }));
  }
}
