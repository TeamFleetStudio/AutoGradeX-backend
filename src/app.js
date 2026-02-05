/**
 * AutoGradeX Fastify Application
 * Plugin registration and route configuration
 */

require('dotenv').config();

const fastify = require('fastify');

/**
 * Build and configure the Fastify application
 * @returns {Promise<FastifyInstance>}
 */
async function buildApp() {
  const app = fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport: process.env.NODE_ENV === 'development' 
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined
    },
    trustProxy: true
  });

  // Register plugins
  // Sensible defaults (error handling helpers)
  await app.register(require('@fastify/sensible'));

  // Security headers (Helmet)
  await app.register(require('@fastify/helmet'), {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Required for Swagger UI
        scriptSrc: ["'self'", "'unsafe-inline'"], // Required for Swagger UI
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false, // Allow embedding for OAuth callbacks
  });

  // CORS with stricter configuration
  await app.register(require('@fastify/cors'), {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);
      
      const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000').split(',');
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      
      // Log rejected origins in development
      if (process.env.NODE_ENV === 'development') {
        app.log.warn({ origin }, 'Blocked CORS request from unknown origin');
      }
      return callback(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Rate limiting
  await app.register(require('@fastify/rate-limit'), {
    max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
    timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000
  });

  // Multipart/file uploads
  await app.register(require('@fastify/multipart'), {
    limits: {
      fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 // 10MB default
    }
  });

  // JWT Authentication
  await app.register(require('@fastify/jwt'), {
    secret: process.env.JWT_SECRET || 'change-this-secret-in-production'
  });

  // Swagger Documentation
  await app.register(require('@fastify/swagger'), {
    openapi: {
      info: {
        title: 'AutoGradeX API',
        description: 'AI-powered grading assistant API',
        version: '1.0.0'
      },
      servers: [
        { url: `http://localhost:${process.env.PORT || 3001}`, description: 'Development' },
        { url: 'http://0.0.0.0:3001', description: 'Server' }
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'JWT Bearer token - obtain from /api/v1/auth/login'
          }
        }
      }
    }
  });

  await app.register(require('@fastify/swagger-ui'), {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
      persistAuthorization: true,
      displayOperationId: true
    },
    staticCSP: false,
    transformStaticAssetUrl: (url) => url,
    transformSpec: (spec) => ({
      ...spec,
      info: {
        ...spec.info,
        'x-logo': {
          url: 'https://fastapi.tiangolo.com/img/logo-margin/logo-teal.png'
        }
      }
    })
  });

  // Custom plugins
  await app.register(require('./plugins/database'));
  await app.register(require('./plugins/auth'));
  await app.register(require('./plugins/error-handler'));
  await app.register(require('./plugins/metrics'));

  // Health check
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // API documentation info endpoint
  app.get('/api-info', async () => ({
    status: 'ok',
    message: 'AutoGradeX API v1.0.0',
    documentation: 'Visit http://localhost:3001/docs for interactive API documentation',
    authenticate: 'Login at POST /api/v1/auth/login to get a JWT token',
    tokenUsage: 'Add the token to the Authorization header as: Bearer <your-token>'
  }));

  // API v1 routes
  await app.register(require('./routes/auth'), { prefix: '/api/v1/auth' });
  await app.register(require('./routes/files'), { prefix: '/api/v1/files' });
  await app.register(require('./routes/submissions'), { prefix: '/api/v1/submissions' });
  await app.register(require('./routes/grades'), { prefix: '/api/v1/grades' });
  await app.register(require('./routes/rubrics'), { prefix: '/api/v1/rubrics' });
  await app.register(require('./routes/assignments'), { prefix: '/api/v1/assignments' });
  await app.register(require('./routes/courses'), { prefix: '/api/v1/courses' });
  await app.register(require('./routes/users'), { prefix: '/api/v1/users' });
  await app.register(require('./routes/batch'), { prefix: '/api/v1/batch' });
  await app.register(require('./routes/export'), { prefix: '/api/v1/export' });
  await app.register(require('./routes/audit'), { prefix: '/api/v1/audit' });
  await app.register(require('./routes/quiz'), { prefix: '/api/v1/quizzes' });

  return app;
}

module.exports = buildApp;
