import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { generateEmbedding } from '../utils/embeddings';
import { hybridRetrieval } from '../services/retrieval';
import { rerankChunks } from '../services/reranking';
import { synthesizeAnswer } from '../services/synthesis';
import { sql } from '../utils/db';
import { LATENCY_BUDGETS } from '@sentinal-rag/shared';

const QueryRequestSchema = z.object({
  query: z.string().min(1).max(1000),
  options: z.object({
    topK: z.number().int().positive().optional(),
    includeDebug: z.boolean().optional(),
  }).optional(),
});

export const queryRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /api/v1/query
   * Main RAG query endpoint
   * 
   * Pipeline:
   * 1. Query preprocessing
   * 2. Hybrid retrieval (keyword + vector)
   * 3. Reranking
   * 4. Answer synthesis
   * 5. Evaluation
   */
  fastify.post('/', async (request, reply) => {
    const startTime = Date.now();
    const requestId = request.id;

    try {
      const validation = QueryRequestSchema.safeParse(request.body);
      
      if (!validation.success) {
        return reply.code(400).send({
          error: 'Invalid request',
          details: validation.error.issues,
        });
      }

      const { query, options } = validation.data;

      fastify.log.info({ requestId, query }, 'Processing query');

      // ===== STAGE 1: EMBEDDING =====
      const embeddingStartTime = Date.now();
      let queryEmbedding: number[];
      try {
        queryEmbedding = await generateEmbedding(query);
      } catch (error) {
        fastify.log.error({ requestId, error }, 'Embedding generation failed');
        return reply.code(503).send({
          error: 'Embedding service unavailable',
          requestId,
        });
      }
      const embeddingLatency = Date.now() - embeddingStartTime;

      // ===== STAGE 2: HYBRID RETRIEVAL =====
      const retrievalStartTime = Date.now();
      let retrievedChunks;
      try {
        retrievedChunks = await hybridRetrieval(query, queryEmbedding, options?.topK);
      } catch (error) {
        fastify.log.error({ requestId, error }, 'Retrieval failed');
        return reply.code(503).send({
          error: 'Retrieval service failed',
          requestId,
        });
      }
      const retrievalLatency = Date.now() - retrievalStartTime;

      // Check latency budget
      if (retrievalLatency > LATENCY_BUDGETS.RETRIEVAL) {
        fastify.log.warn(
          { requestId, retrievalLatency, budget: LATENCY_BUDGETS.RETRIEVAL },
          'Retrieval exceeded latency budget'
        );
      }

      // ===== STAGE 3: RERANKING =====
      const rerankerStartTime = Date.now();
      let rerankedChunks;
      try {
        rerankedChunks = await rerankChunks(query, retrievedChunks);
      } catch (error) {
        fastify.log.error({ requestId, error }, 'Reranking failed');
        // Degrade gracefully: use top 6 from retrieval if reranking fails
        rerankedChunks = retrievedChunks.slice(0, 6).map((chunk, idx) => ({
          ...chunk,
          relevanceScore: chunk.relevanceScore ?? (1 - idx * 0.1),
        }));
        fastify.log.warn({ requestId }, 'Reranking failed, using top retrieval chunks');
      }
      const rerankerLatency = Date.now() - rerankerStartTime;

      // Check latency budget
      if (rerankerLatency > LATENCY_BUDGETS.RERANKING) {
        fastify.log.warn(
          { requestId, rerankerLatency, budget: LATENCY_BUDGETS.RERANKING },
          'Reranking exceeded latency budget'
        );
      }

      // ===== STAGE 4: SYNTHESIS =====
      const synthesisStartTime = Date.now();
      let synthesisResult;
      try {
        synthesisResult = await synthesizeAnswer(query, rerankedChunks);
      } catch (error) {
        fastify.log.error({ requestId, error }, 'Synthesis failed');
        return reply.code(503).send({
          error: 'Synthesis service failed',
          requestId,
        });
      }
      const synthesisLatency = Date.now() - synthesisStartTime;

      // Check latency budget
      if (synthesisLatency > LATENCY_BUDGETS.SYNTHESIS) {
        fastify.log.warn(
          { requestId, synthesisLatency, budget: LATENCY_BUDGETS.SYNTHESIS },
          'Synthesis exceeded latency budget'
        );
      }

      const totalLatency = Date.now() - startTime;

      // Check total latency budget
      if (totalLatency > LATENCY_BUDGETS.TOTAL) {
        fastify.log.error(
          { requestId, totalLatency, budget: LATENCY_BUDGETS.TOTAL },
          'Total latency exceeded budget'
        );
      }

      // ===== STAGE 5: BUILD RESPONSE & STORE METRICS =====
      
      // Build full source objects with content, score, metadata
      const sources = rerankedChunks.map((chunk) => ({
        chunkId: chunk.chunkId,
        content: chunk.content,
        score: chunk.relevanceScore ?? 0,
        metadata: chunk.metadata || {},
      }));
      
      const response = {
        requestId,
        query,
        answer: synthesisResult.answer,
        sources,
        refusalReason: synthesisResult.refusalReason || undefined,
        metadata: {
          latency: {
            total: totalLatency,
            embedding: embeddingLatency,
            retrieval: retrievalLatency,
            reranking: rerankerLatency,
            synthesis: synthesisLatency,
          },
          chunksRetrieved: retrievedChunks.length,
          chunksReranked: rerankedChunks.length,
          chunksUsed: synthesisResult.sourceChunkIds.length,
          latencyBudgetViolations: [
            retrievalLatency > LATENCY_BUDGETS.RETRIEVAL ? 'retrieval' : null,
            rerankerLatency > LATENCY_BUDGETS.RERANKING ? 'reranking' : null,
            synthesisLatency > LATENCY_BUDGETS.SYNTHESIS ? 'synthesis' : null,
            totalLatency > LATENCY_BUDGETS.TOTAL ? 'total' : null,
          ].filter(Boolean),
        },
      };

      // Store evaluation metrics in database for later analysis
      try {
        await sql`
          INSERT INTO query_evaluations (
            request_id,
            query,
            answer,
            source_chunk_ids,
            latency_ms,
            retrieval_latency_ms,
            reranking_latency_ms,
            synthesis_latency_ms,
            chunks_retrieved,
            chunks_reranked,
            chunks_used,
            latency_budget_violations
          ) VALUES (
            ${requestId},
            ${query},
            ${response.answer},
            ${JSON.stringify(synthesisResult.sourceChunkIds)},
            ${totalLatency},
            ${retrievalLatency},
            ${rerankerLatency},
            ${synthesisLatency},
            ${retrievedChunks.length},
            ${rerankedChunks.length},
            ${synthesisResult.sourceChunkIds.length},
            ${JSON.stringify(response.metadata.latencyBudgetViolations)}
          )
        `;
      } catch (error) {
        fastify.log.error({ requestId, error }, 'Failed to store evaluation metrics');
        // Non-critical: don't fail response if metrics storage fails
      }

      fastify.log.info(
        { requestId, totalLatency, chunksUsed: synthesisResult.sourceChunkIds.length },
        'Query processed successfully'
      );

      return response;
    } catch (error) {
      fastify.log.error({ requestId, error }, 'Query processing failed');
      return reply.code(500).send({
        error: 'Internal server error',
        requestId,
      });
    }
  });
};
