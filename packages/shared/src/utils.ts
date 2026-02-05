/**
 * Shared utility functions for SentinelRAG.
 */

/**
 * Generate a unique request ID for tracing.
 */
export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Check if a latency exceeds its budget.
 */
export function checkLatencyBudget(
  actual: number,
  budget: number,
  stage: string
): { exceeded: boolean; violation?: string } {
  if (actual > budget) {
    return {
      exceeded: true,
      violation: `${stage}: ${actual}ms exceeded budget of ${budget}ms`,
    };
  }
  return { exceeded: false };
}

/**
 * Merge and deduplicate chunks from keyword and vector search.
 * Prefers higher scores when deduplicating.
 */
export function mergeRetrievalResults<T extends { chunkId: string; score: number }>(
  keywordResults: T[],
  vectorResults: T[],
  maxResults: number
): T[] {
  const merged = new Map<string, T>();

  // Add all results, keeping highest score for duplicates
  for (const result of [...keywordResults, ...vectorResults]) {
    const existing = merged.get(result.chunkId);
    if (!existing || result.score > existing.score) {
      merged.set(result.chunkId, result);
    }
  }

  // Sort by score descending and limit
  return Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}
