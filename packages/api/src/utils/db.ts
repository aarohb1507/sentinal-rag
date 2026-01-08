import postgres from 'postgres';
import { config } from '../config';

/**
 * PostgreSQL connection pool.
 * 
 * Why connection pooling:
 * - Reuses connections across requests (avoids connection overhead)
 * - Handles reconnection automatically
 * - Thread-safe for concurrent requests
 * 
 * Used by:
 * - Retrieval service (hybrid search queries)
 * - Evaluation service (storing metrics)
 */

const sql = postgres({
  host: config.database.host,
  port: config.database.port,
  database: config.database.database,
  user: config.database.user,
  password: config.database.password,
  max: 20, // Maximum pool size
  idle_timeout: 20,
  connect_timeout: 10,
});

export { sql };

/**
 * Health check: verify database connectivity.
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await sql`SELECT 1`;
    return true;
  } catch (error) {
    return false;
  }
}
