import { getCachedEmbedding, cacheEmbedding } from './redis';
import { logger } from './logger';
import { config } from '../config';

/**
 * Embeddings Utility (API Service)
 * 
 * Uses local sentence-transformers model: all-MiniLM-L6-v2
 * Output dimension: 384
 * 
 * Why:
 * - Free (no API costs)
 * - Fast (CPU inference)
 * - Good quality (production-grade)
 * 
 * CRITICAL: Must use same model as worker (document embeddings)
 * 
 * Strategy:
 * 1. Check Redis cache first (24h TTL) → Cost: $0
 * 2. If miss → Call embedding service
 * 3. Store result in Redis for future hits
 */

/**
 * Generate embedding for a text string (query or document).
 * 
 * Caching optimizes repeated queries.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  // Normalize query (lowercase + trim) for better cache hits
  const normalizedText = text.toLowerCase().trim();

  // Try Redis cache first
  const cached = await getCachedEmbedding(normalizedText);
  if (cached) {
    return cached;
  }

  // Cache miss → Call embedding service
  const embedding = await callEmbeddingService(text);

  // Store in Redis for future hits (24h TTL)
  await cacheEmbedding(normalizedText, embedding);

  return embedding;
}

/**
 * Batch generate embeddings.
 */
export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  const embeddings = await Promise.all(texts.map((text) => generateEmbedding(text)));
  return embeddings;
}

/**
 * Call embedding service (sentence-transformers).
 * 
 * In MVP deployment:
 * - Python worker provides embedding endpoint at http://worker:8001/embed
 * - Or run as separate service
 * 
 * Expected response: { embedding: number[] }
 */
async function callEmbeddingService(text: string): Promise<number[]> {
  try {
    // Call worker embedding service
    const url = `${config.embeddings.workerUrl}/embed`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model: config.embeddings.model }),
    });

    if (!response.ok) {
      throw new Error(`Embedding service returned ${response.status}`);
    }

    const data = (await response.json()) as { embedding: number[] };
    return data.embedding;
  } catch (error) {
    logger.error({ error }, 'Embedding service call failed');
    throw error;
  }
}
