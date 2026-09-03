const morgan = require('morgan');
const logger = require('../helpers/logger');
const env = require('../config/env');

/**
 * Logging HTTP de acceso. En producción se resume a una línea por request
 * y se persiste vía helpers/logger; en desarrollo usa el formato "dev" coloreado.
 */
const stream = {
  write: (message) => logger.info(message.trim()),
};

const loggerMiddleware = morgan(env.isProduction ? 'combined' : 'dev', {
  stream: env.isProduction ? stream : undefined,
});

module.exports = loggerMiddleware;
