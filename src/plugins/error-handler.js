/**
 * Error Handler Plugin
 * Structured error responses
 */

const fp = require('fastify-plugin');

async function errorHandlerPlugin(fastify, options) {
  // Custom error handler
  fastify.setErrorHandler(function (error, request, reply) {
    // Log the error
    this.log.error({
      err: error,
      request: {
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: request.body
      }
    });

    // Handle validation errors
    if (error.validation) {
      return reply.code(400).send({
        success: false,
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: error.validation
      });
    }

    // Handle known error codes
    const statusCode = error.statusCode || 500;
    
    // Don't expose internal errors in production
    const message = statusCode >= 500 && process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : error.message;

    return reply.code(statusCode).send({
      success: false,
      error: message,
      code: error.code || 'INTERNAL_ERROR',
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
  });

  // Custom not found handler
  fastify.setNotFoundHandler(function (request, reply) {
    reply.code(404).send({
      success: false,
      error: 'Route not found',
      code: 'NOT_FOUND'
    });
  });

  // Decorator for creating app errors
  fastify.decorate('createError', function (statusCode, message, code) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
  });
}

module.exports = fp(errorHandlerPlugin, {
  name: 'error-handler'
});
