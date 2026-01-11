import Redis from 'ioredis';
import { config } from '../config';
import { logger } from './logger';

/**
 * Redis client for caching.
 * 
 * Caching strategy:
 * - Embeddings: Cache query embeddings to avoid redundant OpenAI calls
 * - Query results: Cache recent query results for identical queries
 * 
 * Why Redis:
 * - Fast (< 1ms lookup)
 * - Shared across API instances (horizontal scaling)
 * - TTL support (auto-expire old entries)
 */

// Use REDIS_URL if available (Railway), otherwise use individual config
const redisUrl = process.env.REDIS_URL;
const redisConfig = redisUrl
  ? {
      url: redisUrl,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      connectTimeout: 10000,
    }
  : {
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      connectTimeout: 10000,
    };

logger.info({ redisUrl: !!redisUrl, host: redisConfig.host }, 'Initializing Redis connection');

const redis = new Redis(redisConfig);

redis.on('error', (err) => {
  logger.error({ err }, 'Redis connection error');
});

redis.on('connect', () => {
  logger.info('Redis connected');
});

export { redis };

/**
 * Health check: verify Redis connectivity.
 */
export async function checkRedisHealth(): Promise<boolean> {
  try {
    await redis.ping();
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Cache embedding vector.
 * 
 * @param text - Text content to cache
 * @param embedding - Vector embedding
 * @param ttl - Time to live in seconds (default: 24 hours)
 */
export async function cacheEmbedding(
  text: string,
  embedding: number[],
  ttl: number = 86400
): Promise<void> {
  const key = `embed:${hashText(text)}`;
  await redis.setex(key, ttl, JSON.stringify(embedding));
}

/**
 * Retrieve cached embedding.
 * 
 * @param text - Text content to lookup
 * @returns Embedding vector or null if not cached
 */
export async function getCachedEmbedding(text: string): Promise<number[] | null> {
  const key = `embed:${hashText(text)}`;
  const cached = await redis.get(key);
  if (!cached) return null;
  return JSON.parse(cached);
}

/**
 * Simple hash function for cache keys.
 */
function hashText(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}
