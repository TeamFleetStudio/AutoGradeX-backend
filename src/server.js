/**
 * AutoGradeX Backend Server
 * Entry point for the Fastify application
 */

require('dotenv').config();

const buildApp = require('./app');

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

let app;

/**
 * Start the server
 */
async function start() {
  try {
    app = await buildApp();
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`Server running at http://${HOST}:${PORT}`);
    app.log.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    app.log.info(`API Documentation: http://${HOST}:${PORT}/docs`);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Graceful shutdown
const signals = ['SIGINT', 'SIGTERM'];
signals.forEach((signal) => {
  process.on(signal, async () => {
    if (app) {
      app.log.info(`Received ${signal}, shutting down gracefully...`);
      try {
        await app.close();
        app.log.info('Server closed');
        process.exit(0);
      } catch (err) {
        app.log.error('Error during shutdown:', err);
        process.exit(1);
      }
    } else {
      process.exit(0);
    }
  });
});

start();
