const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', process.env.LOG_DIR || 'logs');

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const streams = {
  combined: fs.createWriteStream(path.join(LOG_DIR, 'combined.log'), { flags: 'a' }),
  error: fs.createWriteStream(path.join(LOG_DIR, 'error.log'), { flags: 'a' }),
};

function timestamp() {
  return new Date().toISOString();
}

function write(stream, level, message, meta) {
  const line = `[${timestamp()}] [${level}] ${message}${meta ? ` ${JSON.stringify(meta)}` : ''}\n`;
  stream.write(line);
}

/**
 * Logger de aplicación minimalista basado en filesystem.
 * Escribe a consola y a archivos rotables por proceso externo (logrotate/pm2).
 */
const logger = {
  info(message, meta) {
    // eslint-disable-next-line no-console
    console.log(`[INFO] ${message}`, meta || '');
    write(streams.combined, 'INFO', message, meta);
  },
  warn(message, meta) {
    // eslint-disable-next-line no-console
    console.warn(`[WARN] ${message}`, meta || '');
    write(streams.combined, 'WARN', message, meta);
  },
  error(message, meta) {
    // eslint-disable-next-line no-console
    console.error(`[ERROR] ${message}`, meta || '');
    write(streams.combined, 'ERROR', message, meta);
    write(streams.error, 'ERROR', message, meta);
  },
};

module.exports = logger;
