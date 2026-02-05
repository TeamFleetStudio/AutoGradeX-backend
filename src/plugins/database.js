/**
 * PostgreSQL Database Plugin
 * Connection pool management with parameterized queries
 */

const fp = require('fastify-plugin');
const { Pool } = require('pg');

async function databasePlugin(fastify, options) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'autogradex',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: 20, // Maximum connections in pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });

  // Test connection
  try {
    const client = await pool.connect();
    fastify.log.info('Database connected successfully');
    client.release();
  } catch (err) {
    fastify.log.error('Database connection failed:', err.message);
    // Don't exit - allow app to start for health checks
  }

  /**
   * Execute a parameterized query
   * @param {string} text - SQL query with $1, $2, etc. placeholders
   * @param {Array} params - Query parameters
   * @returns {Promise<Object>} Query result
   */
  async function query(text, params = []) {
    const start = Date.now();
    try {
      const result = await pool.query(text, params);
      const duration = Date.now() - start;
      fastify.log.debug({ query: text, duration, rows: result.rowCount }, 'Query executed');
      return result;
    } catch (err) {
      fastify.log.error({ query: text, error: err.message }, 'Query failed');
      throw err;
    }
  }

  /**
   * Get a client from the pool for transactions
   * @returns {Promise<Object>} Database client
   */
  async function getClient() {
    return pool.connect();
  }

  /**
   * Execute a transaction with automatic commit/rollback
   * @param {Function} callback - Async function receiving client
   * @returns {Promise<any>} Transaction result
   */
  async function transaction(callback) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Decorate fastify with database utilities
  fastify.decorate('db', {
    query,
    getClient,
    transaction,
    pool
  });

  /**
   * Log an audit event (non-blocking, errors are logged but don't fail the request)
   * @param {Object} options - Audit log options
   * @param {string} options.userId - User ID
   * @param {string} options.action - Action performed
   * @param {string} options.resourceType - Type of resource
   * @param {string} options.resourceId - Resource ID
   * @param {Object} [options.oldValue] - Previous value
   * @param {Object} [options.newValue] - New value
   */
  fastify.decorate('auditLog', async function auditLog({ userId, action, resourceType, resourceId, oldValue, newValue }) {
    try {
      await query(
        `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, old_value, new_value, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [userId, action, resourceType, resourceId, oldValue ? JSON.stringify(oldValue) : null, newValue ? JSON.stringify(newValue) : null]
      );
    } catch (err) {
      // Log error but don't fail the request - audit logging should be non-blocking
      fastify.log.error({ error: err.message, action, resourceType, resourceId }, 'Audit log failed');
    }
  });

  // Close pool on server shutdown
  fastify.addHook('onClose', async () => {
    fastify.log.info('Closing database pool...');
    await pool.end();
  });
}

module.exports = fp(databasePlugin, {
  name: 'database'
});
