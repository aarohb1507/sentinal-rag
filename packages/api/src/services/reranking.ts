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
 */

export interface RankedResult extends RetrievalResult {
  relevanceScore: number;
}

/**
 * Rerank chunks by relevance to query.
 * 
 * BATCH OPTIMIZATION:
 * - Groups chunks (e.g., 5 per batch)
 * - Scores all chunks in batch with single LLM call
 * - Reduces from 30 calls → ~6 calls
 * 
 * @param query - User query
 * @param chunks - Retrieved chunks from hybrid search
 * @param topK - Number of top chunks to return
 * @returns Top-K chunks sorted by relevance
 */
export async function rerankChunks(
  query: string,
  chunks: RetrievalResult[],
  topK: number = 6
): Promise<RankedResult[]> {
  const startTime = Date.now();

  try {
    // Batch size for scoring (balance between API calls and context length)
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
    logger.info(
      { latency, inputCount: chunks.length, batchCount: batches.length, outputCount: ranked.length },
      'Batch reranking completed'
    );

    return ranked;
  } catch (error) {
    logger.error({ error }, 'Reranking failed');
    throw error;
  }
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
