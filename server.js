const http = require('http');
const app = require('./app');
const env = require('./config/env');
const logger = require('./helpers/logger');
const { testConnection } = require('./config/database');
const { initSockets } = require('./sockets');
const registerAllCronJobs = require('./cron');

const httpServer = http.createServer(app);

async function start() {
  await testConnection();

  initSockets(httpServer);
  registerAllCronJobs();

  httpServer.listen(env.port, () => {
    logger.info(`[server] Admin Club API escuchando en el puerto ${env.port} (${env.nodeEnv})`);
    logger.info(`[server] Prefijo de API: ${env.apiPrefix}`);
  });
}

start().catch((error) => {
  logger.error('[server] Error fatal al iniciar el servidor', { error: error.message, stack: error.stack });
  process.exit(1);
});

function shutdown(signal) {
  logger.info(`[server] Señal ${signal} recibida. Cerrando servidor...`);
  httpServer.close(() => {
    logger.info('[server] Servidor cerrado correctamente.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('[server] Unhandled Rejection', { reason: reason?.message || reason });
});

process.on('uncaughtException', (error) => {
  logger.error('[server] Uncaught Exception', { error: error.message, stack: error.stack });
  process.exit(1);
});
