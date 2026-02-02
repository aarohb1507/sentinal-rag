import { FastifyPluginAsync } from 'fastify';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Document management routes.
 * 
 * Proxies to the worker service for document operations.
 * - GET /documents - List all documents
 * - DELETE /documents/:id - Delete a document
 */
export const documentRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/v1/documents
   * List all uploaded documents
   */
  fastify.get('/', async (request, reply) => {
    try {
      const workerUrl = `${config.embeddings.workerUrl}/documents`;
      const response = await fetch(workerUrl);
      
      if (!response.ok) {
        throw new Error(`Worker returned ${response.status}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      logger.error({ error }, 'Failed to fetch documents');
      return reply.code(503).send({
        error: 'Failed to fetch documents',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * DELETE /api/v1/documents/:id
   * Delete a document and its chunks
   */
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;
    
    try {
      const workerUrl = `${config.embeddings.workerUrl}/documents/${encodeURIComponent(id)}`;
      const response = await fetch(workerUrl, {
        method: 'DELETE',
      });
      
      if (response.status === 404) {
        return reply.code(404).send({
          error: 'Document not found',
        });
      }
      
      if (!response.ok) {
        throw new Error(`Worker returned ${response.status}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      logger.error({ error, documentId: id }, 'Failed to delete document');
      return reply.code(503).send({
        error: 'Failed to delete document',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
};
