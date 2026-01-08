import { FastifyPluginAsync } from 'fastify';
import { sql } from '../utils/db';
import { z } from 'zod';

/**
 * Evaluation Routes
 * 
 * Purpose: Query and analyze RAG evaluation metrics.
 * 
 * Endpoints:
 * - GET /api/v1/evaluation/:requestId - Get metrics for specific request
 * - GET /api/v1/evaluation/recent - Get recent evaluation results
 * - GET /api/v1/evaluation/stats - Get aggregate statistics
 */

const RequestIdSchema = z.object({
  requestId: z.string(),
});

const RecentQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  minFaithfulness: z.coerce.number().min(0).max(1).optional(),
  minRelevance: z.coerce.number().min(0).max(1).optional(),
});

export const evaluationRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/v1/evaluation/:requestId
   * Get evaluation metrics for a specific request.
   */
  fastify.get<{ Params: { requestId: string } }>(
    '/:requestId',
    async (request, reply) => {
      try {
        const { requestId } = request.params;

        const results = await sql`
          SELECT 
            request_id,
            query,
            answer,
            sources,
            context_recall,
            answer_faithfulness,
            answer_relevance,
            latency_total,
            latency_retrieval,
            latency_reranking,
            latency_synthesis,
            chunks_retrieved,
            chunks_reranked,
            chunks_used,
            latency_violations,
            created_at
          FROM evaluation_runs
          WHERE request_id = ${requestId}
          LIMIT 1
        `;

        if (results.length === 0) {
          return reply.code(404).send({
            error: 'Evaluation not found',
            requestId,
          });
        }

        return results[0];
      } catch (error) {
        fastify.log.error({ error, requestId: request.params.requestId }, 'Failed to fetch evaluation');
        return reply.code(500).send({
          error: 'Failed to fetch evaluation',
        });
      }
    }
  );

  /**
   * GET /api/v1/evaluation/recent
   * Get recent evaluation results with optional filtering.
   */
  fastify.get('/recent', async (request, reply) => {
    try {
      const validation = RecentQuerySchema.safeParse(request.query);

      if (!validation.success) {
        return reply.code(400).send({
          error: 'Invalid query parameters',
          details: validation.error.issues,
        });
      }

      const { limit, minFaithfulness, minRelevance } = validation.data;

      let query = sql`
        SELECT 
          request_id,
          query,
          answer,
          context_recall,
          answer_faithfulness,
          answer_relevance,
          latency_total,
          chunks_retrieved,
          chunks_reranked,
          chunks_used,
          created_at
        FROM evaluation_runs
        WHERE 1=1
      `;

      // Apply filters
      if (minFaithfulness !== undefined) {
        query = sql`${query} AND answer_faithfulness >= ${minFaithfulness}`;
      }

      if (minRelevance !== undefined) {
        query = sql`${query} AND answer_relevance >= ${minRelevance}`;
      }

      query = sql`${query}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;

      const results = await query;

      return {
        count: results.length,
        evaluations: results,
      };
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch recent evaluations');
      return reply.code(500).send({
        error: 'Failed to fetch recent evaluations',
      });
    }
  });

  /**
   * GET /api/v1/evaluation/stats
   * Get aggregate statistics across all evaluations.
   */
  fastify.get('/stats', async (request, reply) => {
    try {
      const stats = await sql`
        SELECT 
          COUNT(*) as total_queries,
          AVG(context_recall) as avg_context_recall,
          AVG(answer_faithfulness) as avg_answer_faithfulness,
          AVG(answer_relevance) as avg_answer_relevance,
          AVG(latency_total) as avg_latency_total,
          AVG(latency_retrieval) as avg_latency_retrieval,
          AVG(latency_reranking) as avg_latency_reranking,
          AVG(latency_synthesis) as avg_latency_synthesis,
          AVG(chunks_retrieved) as avg_chunks_retrieved,
          AVG(chunks_reranked) as avg_chunks_reranked,
          AVG(chunks_used) as avg_chunks_used,
          COUNT(CASE WHEN latency_violations IS NOT NULL AND latency_violations::text != '[]' THEN 1 END) as queries_with_violations
        FROM evaluation_runs
      `;

      const latencyBudgetStats = await sql`
        SELECT 
          COUNT(CASE WHEN latency_retrieval > 200 THEN 1 END) as retrieval_violations,
          COUNT(CASE WHEN latency_reranking > 500 THEN 1 END) as reranking_violations,
          COUNT(CASE WHEN latency_synthesis > 3000 THEN 1 END) as synthesis_violations
        FROM evaluation_runs
      `;

      return {
        overall: stats[0],
        latencyBudgets: latencyBudgetStats[0],
      };
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch evaluation stats');
      return reply.code(500).send({
        error: 'Failed to fetch evaluation stats',
      });
    }
  });
};
