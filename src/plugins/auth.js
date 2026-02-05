/**
 * Authentication Plugin
 * JWT verification and user context
 */

const fp = require('fastify-plugin');

async function authPlugin(fastify, options) {
  /**
   * Verify JWT token and attach user to request
   * Use as preHandler: [fastify.authenticate]
   * Supports: Authorization header OR ?token= query parameter (for file downloads)
   */
  fastify.decorate('authenticate', async function (request, reply) {
    try {
      // First try Authorization header
      const authHeader = request.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const decoded = await request.jwtVerify();
        request.user = decoded;
        return;
      }
      
      // Fallback: Check for token in query parameter (for file downloads/iframes)
      const queryToken = request.query.token;
      if (queryToken) {
        try {
          const decoded = fastify.jwt.verify(queryToken);
          request.user = decoded;
          return;
        } catch (tokenErr) {
          // Token invalid, fall through to error
        }
      }
      
      // No valid token found
      reply.code(401).send({ 
        success: false, 
        error: 'Unauthorized',
        code: 'AUTH_REQUIRED'
      });
    } catch (err) {
      reply.code(401).send({ 
        success: false, 
        error: 'Unauthorized',
        code: 'AUTH_REQUIRED'
      });
    }
  });

  /**
   * Verify user has required role
   * @param {string[]} roles - Allowed roles
   * @returns {Function} Fastify preHandler
   */
  fastify.decorate('authorize', function (roles) {
    return async function (request, reply) {
      if (!request.user) {
        return reply.code(401).send({ 
          success: false, 
          error: 'Unauthorized',
          code: 'AUTH_REQUIRED'
        });
      }

      if (!roles.includes(request.user.role)) {
        return reply.code(403).send({ 
          success: false, 
          error: 'Forbidden: Insufficient permissions',
          code: 'FORBIDDEN'
        });
      }
    };
  });

  /**
   * Generate JWT token for user
   * @param {Object} payload - User data to encode
   * @returns {string} JWT token
   */
  fastify.decorate('generateToken', function (payload) {
    return fastify.jwt.sign(payload, {
      expiresIn: process.env.JWT_EXPIRES_IN || '1d'
    });
  });
}

module.exports = fp(authPlugin, {
  name: 'auth',
  dependencies: ['@fastify/jwt']
});
