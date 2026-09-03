const env = require('./env');

/**
 * Whitelist de orígenes permitidos (web, capacitor, ionic).
 * Nunca usar `origin: '*'` junto a `credentials: true`.
 */
const allowedOrigins = new Set(env.clientUrls.length ? env.clientUrls : [env.clientUrl]);

const corsOptions = {
  origin(origin, callback) {
    // Peticiones sin origin (apps móviles nativas, curl, healthchecks) se permiten.
    if (!origin || allowedOrigins.has(origin)) {
      return callback(null, true);
    }
    return callback(new Error('No permitido por la política de CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Club-Id'],
  exposedHeaders: ['X-Total-Count'],
  maxAge: 86400,
};

module.exports = corsOptions;
