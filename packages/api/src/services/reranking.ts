import OpenAI from 'openai';
import { config } from '../config';
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
 * Trade-off: Adds 300-500ms latency
 */

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

export interface RankedResult extends RetrievalResult {
  relevanceScore: number;
}

/**
 * Rerank chunks by relevance to query.
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
    // Score each chunk in parallel
    const scoringPromises = chunks.map((chunk) =>
      scoreChunkRelevance(query, chunk)
    );

    const scoredChunks = await Promise.all(scoringPromises);

    // Sort by relevance score and take top-K
    const ranked = scoredChunks
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, topK);

    const latency = Date.now() - startTime;
    logger.info(
      { latency, inputCount: chunks.length, outputCount: ranked.length },
      'Reranking completed'
    );

    return ranked;
  } catch (error) {
    logger.error({ error }, 'Reranking failed');
    throw error;
  }
}

/**
 * Score a single chunk for relevance using LLM.
 * 
 * Prompt strategy: Ask LLM to score 0-1 based on relevance.
 */
async function scoreChunkRelevance(
  query: string,
  chunk: RetrievalResult
): Promise<RankedResult> {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo', // Fast, cheap model for scoring
      messages: [
        {
          role: 'system',
          content: `You are a relevance scoring system. Given a query and a text chunk, score how relevant the chunk is to answering the query. Respond with ONLY a number between 0.0 (not relevant) and 1.0 (highly relevant).`,
        },
        {
          role: 'user',
          content: `Query: ${query}\n\nChunk: ${chunk.content}\n\nRelevance score (0.0-1.0):`,
        },
      ],
      temperature: 0,
      max_tokens: 10,
    });

    const scoreText = response.choices[0]?.message?.content?.trim() || '0';
    const relevanceScore = Math.max(0, Math.min(1, parseFloat(scoreText) || 0));

    return {
      ...chunk,
      relevanceScore,
    };
  } catch (error) {
    logger.warn({ error, chunkId: chunk.chunkId }, 'Failed to score chunk, defaulting to 0');
    return {
      ...chunk,
      relevanceScore: 0,
    };
  }
}
