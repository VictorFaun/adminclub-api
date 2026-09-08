require('dotenv').config();

/**
 * Config centralizada y tipada a partir de variables de entorno.
 * Ningún otro módulo debe leer `process.env` directamente.
 */
const toBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
};

const toArray = (value) =>
  (value || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

const port = Number(process.env.PORT) || 3000;

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port,
  apiPrefix: process.env.API_PREFIX || '/api/v1',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:8100',
  clientUrls: toArray(process.env.CLIENT_URLS) || [],
  // Origen público de esta API (protocolo + host + puerto), usado para convertir
  // rutas relativas de /uploads en URLs absolutas. El frontend puede correr en un
  // puerto distinto (Angular dev server, app nativa, etc.), así que una ruta
  // relativa como "/uploads/logos/x.png" se resolvería contra el origen del
  // frontend en vez del backend. Por defecto asume localhost en el mismo puerto.
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, ''),

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'admin_club',
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    issuer: process.env.JWT_ISSUER || 'admin-club-api',
  },

  tokens: {
    resetPasswordExpiresMin: Number(process.env.RESET_PASSWORD_TOKEN_EXPIRES_MIN) || 30,
    verifyEmailExpiresHours: Number(process.env.VERIFY_EMAIL_TOKEN_EXPIRES_HOURS) || 48,
  },

  security: {
    bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS) || 12,
    rateLimitWindowMin: Number(process.env.RATE_LIMIT_WINDOW_MIN) || 15,
    rateLimitMax: Number(process.env.RATE_LIMIT_MAX) || 300,
    authRateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX) || 20,
  },

  upload: {
    maxMb: Number(process.env.UPLOAD_MAX_MB) || 5,
    dir: process.env.UPLOAD_DIR || 'uploads',
  },

  cookies: {
    refreshCookieName: process.env.REFRESH_COOKIE_NAME || 'admin_club_rt',
    secure: toBool(process.env.COOKIE_SECURE, false),
    domain: process.env.COOKIE_DOMAIN || undefined,
  },

  logs: {
    dir: process.env.LOG_DIR || 'logs',
    level: process.env.LOG_LEVEL || 'dev',
  },

  // Login con Google — solo hace falta el Client ID (público, NO un secreto): se verifica el
  // `id_token` que ya emitió Google del lado del navegador (Google Identity Services), sin
  // flujo de redirect/callback ni `client_secret` de por medio (ver GOOGLE_LOGIN_SETUP.md).
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
  },

  // Envío de correo real vía Resend — mientras falte RESEND_API_KEY, email.service.js sigue
  // cayendo a su comportamiento de siempre (loguear en vez de enviar), ver RESEND_EMAIL_SETUP.md.
  email: {
    resendApiKey: process.env.RESEND_API_KEY,
    fromAddress: process.env.EMAIL_FROM || 'no-reply@adminclub.dev',
    fromName: process.env.EMAIL_FROM_NAME || 'Admin Club',
  },
};

const requiredInProduction = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'DB_PASSWORD'];

if (env.isProduction) {
  const missing = requiredInProduction.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Faltan variables de entorno obligatorias en producción: ${missing.join(', ')}`);
  }
}

if (!env.jwt.accessSecret || !env.jwt.refreshSecret) {
  // El fallback inseguro SOLO se permite con NODE_ENV="development" explícito — nunca como
  // catch-all de "cualquier cosa que no sea 'production'". El check de arriba (`isProduction`)
  // no cubre el caso real de riesgo: un despliegue que simplemente OLVIDA exportar NODE_ENV
  // (arranque directo con `node server.js`, un contenedor/PM2 mal configurado) queda con
  // `nodeEnv` en su default 'development' sin que nadie lo haya decidido a propósito, y antes
  // este bloque firmaba/verificaba JWT en silencio con estas dos cadenas literales, que están
  // en el código fuente y son by definición conocidas por cualquiera con acceso al repo —
  // cualquiera podría forjar un access token válido para cualquier usuario, incluido un
  // Super Admin, sin tocar la base de datos. Ahora hace falta poner el flag a mano para
  // arrancar sin secretos reales.
  if (process.env.NODE_ENV !== 'development' || process.env.ALLOW_INSECURE_DEV_SECRETS !== 'true') {
    throw new Error(
      'Faltan JWT_ACCESS_SECRET/JWT_REFRESH_SECRET. Definilas en .env, o si es intencional en ' +
        'desarrollo local, seteá también ALLOW_INSECURE_DEV_SECRETS=true.'
    );
  }
  // eslint-disable-next-line no-console
  console.warn(
    '[config] JWT_ACCESS_SECRET/JWT_REFRESH_SECRET no definidos. Usando valores de desarrollo inseguros ' +
      '(ALLOW_INSECURE_DEV_SECRETS=true). NUNCA usar esta configuración fuera de desarrollo local.'
  );
  env.jwt.accessSecret = env.jwt.accessSecret || 'dev_access_secret_do_not_use_in_prod';
  env.jwt.refreshSecret = env.jwt.refreshSecret || 'dev_refresh_secret_do_not_use_in_prod';
}

module.exports = env;
