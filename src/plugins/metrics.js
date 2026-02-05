/**
 * Metrics Plugin for Fastify
 * Automatically tracks API performance, errors, and request patterns
 */

const fp = require('fastify-plugin');
const metricsService = require('../services/metrics-service');
const logger = require('../services/logger');

async function metricsPlugin(fastify, options) {
  // Add request timing hook
  fastify.addHook('onRequest', async (request, reply) => {
    request.startTime = Date.now();
  });

  // Record metrics after response
  fastify.addHook('onResponse', async (request, reply) => {
    const latency = Date.now() - (request.startTime || Date.now());
    const route = `${request.method} ${request.routeOptions?.url || request.url}`;
    
    metricsService.recordRequest(route, reply.statusCode, latency, {
      userId: request.user?.id,
      userAgent: request.headers['user-agent']
    });
  });

  // Record errors
  fastify.addHook('onError', async (request, reply, error) => {
    metricsService.recordError(error, {
      route: `${request.method} ${request.url}`,
      userId: request.user?.id,
      method: request.method,
      userAgent: request.headers['user-agent']
    });
  });

  /**
   * GET /api/v1/metrics
   * Get application metrics (admin only)
   */
  fastify.get('/api/v1/metrics', {
    preHandler: [fastify.authenticate, fastify.authorize(['admin'])]
  }, async (request, reply) => {
    const summary = metricsService.getSummary();
    
    return {
      success: true,
      data: summary
    };
  });

  /**
   * GET /api/v1/metrics/health
   * Health check with basic metrics (no auth required)
   */
  fastify.get('/api/v1/metrics/health', async (request, reply) => {
    const summary = metricsService.getSummary();
    
    // Check if system is healthy
    const p95Latency = parseFloat(summary.latency.p95);
    const errorRate = parseFloat(summary.errors.rate);
    
    const isHealthy = p95Latency < 5000 && errorRate < 5;
    
    return {
      status: isHealthy ? 'healthy' : 'degraded',
      uptime: summary.uptime,
      requests: summary.requests.total,
      errorRate: summary.errors.rate,
      latency: {
        p50: summary.latency.p50,
        p95: summary.latency.p95
      }
    };
  });

  /**
   * GET /api/v1/metrics/errors
   * Get recent errors (admin only)
   */
  fastify.get('/api/v1/metrics/errors', {
    preHandler: [fastify.authenticate, fastify.authorize(['admin'])]
  }, async (request, reply) => {
    const { limit = 50 } = request.query;
    const summary = metricsService.getSummary();
    
    return {
      success: true,
      data: {
        total: summary.errors.total,
        rate: summary.errors.rate,
        recent: summary.errors.recent.slice(-limit)
      }
    };
  });

  /**
   * POST /api/v1/metrics/reset
   * Reset metrics (admin only)
   */
  fastify.post('/api/v1/metrics/reset', {
    preHandler: [fastify.authenticate, fastify.authorize(['admin'])]
  }, async (request, reply) => {
    metricsService.reset();
    
    return {
      success: true,
      message: 'Metrics reset successfully'
    };
  });

  logger.info('Metrics plugin registered');
}

module.exports = fp(metricsPlugin, {
  name: 'metrics'
});
