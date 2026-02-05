/**
 * Backend Logger Utility
 * Provides a consistent logging interface that works with Fastify's Pino logger
 * when available, and falls back to structured console logging otherwise.
 * 
 * Usage in routes (with fastify instance):
 *   fastify.log.info({ submissionId }, 'Processing submission');
 * 
 * Usage in services (without fastify instance):
 *   const logger = require('./logger');
 *   logger.info({ submissionId }, 'Processing submission');
 * 
 * @module services/logger
 */

const pino = require('pino');

const isDevelopment = process.env.NODE_ENV === 'development';

/**
 * Create a standalone Pino logger for use in services
 * This matches the Fastify logger configuration
 */
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: isDevelopment
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
  // Redact sensitive fields from logs
  redact: {
    paths: [
      'password',
      'token',
      'apiKey',
      'secret',
      'authorization',
      'req.headers.authorization',
      'email', // PII protection
    ],
    censor: '[REDACTED]',
  },
});

/**
 * Sanitize error objects for safe logging
 * @param {Error} error - Error object
 * @returns {Object} Safe error object for logging
 */
function sanitizeError(error) {
  if (!error) return {};
  
  return {
    name: error.name || 'Error',
    message: error.message || 'Unknown error',
    code: error.code,
    // Only include stack in development
    ...(isDevelopment && { stack: error.stack }),
  };
}

/**
 * Create a child logger with context
 * @param {Object} context - Context to attach to all logs
 * @returns {Object} Child logger instance
 */
function createChildLogger(context) {
  return logger.child(context);
}

module.exports = logger;
module.exports.sanitizeError = sanitizeError;
module.exports.createChildLogger = createChildLogger;
