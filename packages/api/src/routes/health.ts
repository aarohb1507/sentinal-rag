import { FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request, reply) => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'sentinal-rag-api',
      version: '0.1.0',
    };
  });

  fastify.get('/ready', async (request, reply) => {
    // TODO: Check database, redis, and other dependencies
    return {
      status: 'ready',
      checks: {
        database: 'ok',
        redis: 'ok',
      },
    };
  });
};
