import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config } from './config';
import { logger } from './utils/logger';
import { healthRoutes } from './routes/health';
import { queryRoutes } from './routes/query';
import { llm } from './utils/llm';

const fastify = Fastify({
  logger: true,
  requestIdLogLabel: 'reqId',
  disableRequestLogging: false,
  requestIdHeader: 'x-request-id',
});

async function start() {
  try {
    // Validate Groq API key is configured
    if (!config.groq.apiKey) {
      throw new Error(
        'GROQ_API_KEY is not set. Please configure it in .env file. ' +
        'Get free tier at: https://console.groq.com'
      );
    }

    logger.info({ model: config.groq.model }, 'Groq LLM configured');

    // Initialize LLM client to validate configuration
    try {
      // Just creating the instance validates the API key
      llm;
    } catch (err) {
      logger.error(err, 'Failed to initialize Groq client');
      throw err;
    }

    // Register plugins
    await fastify.register(helmet, { 
      contentSecurityPolicy: false 
    });
    
    await fastify.register(cors, {
      origin: config.corsOrigins,
      credentials: true,
    });

    // Register routes
    await fastify.register(healthRoutes, { prefix: '/health' });
    await fastify.register(queryRoutes, { prefix: '/api/v1/query' });

    // Start server
    await fastify.listen({
      port: config.port,
      host: config.host,
    });

    logger.info(`🚀 API server running at http://${config.host}:${config.port}`);
  } catch (err) {
    logger.error(err, 'Failed to start server');
    process.exit(1);
  }
}

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info(`${signal} received, shutting down gracefully...`);
  await fastify.close();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();
