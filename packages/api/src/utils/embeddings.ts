import OpenAI from 'openai';
import { getCachedEmbedding, cacheEmbedding } from './redis';
import { EMBEDDING_CONFIG } from '@sentinal-rag/shared';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Generate embedding for a text string
 * 
 * Strategy:
 * 1. Check Redis cache first (24h TTL) → Cost: $0
 * 2. If miss → Call OpenAI API → Cost: $0.0001 per 1K tokens
 * 3. Store result in Redis for future hits
 * 
 * Optimization: Normalizes query to catch minor variations
 * e.g., "What is RAG?" == "what is rag?"
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  // Normalize query (lowercase + trim) for better cache hits
  const normalizedText = text.toLowerCase().trim();

  // Try Redis cache first
  const cached = await getCachedEmbedding(normalizedText);
  if (cached) {
    return cached;
  }

  // Cache miss → Call OpenAI
  const response = await openai.embeddings.create({
    model: EMBEDDING_CONFIG.MODEL,
    input: text,
    encoding_format: 'float',
  });

  const embedding = response.data[0].embedding;

  // Store in Redis for future hits (24h TTL)
  await cacheEmbedding(normalizedText, embedding);

  return embedding;
}

/**
 * Batch generate embeddings (for future use)
 * Useful for ingestion pipeline: convert multiple chunks at once
 */
export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_CONFIG.MODEL,
    input: texts,
    encoding_format: 'float',
  });

  return response.data
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}
