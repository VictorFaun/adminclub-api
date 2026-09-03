const mysql = require('mysql2/promise');
const env = require('./env');
const logger = require('../helpers/logger');

/**
 * Pool de conexiones MySQL único para toda la aplicación.
 * mysql2 con placeholders (?) protege automáticamente contra SQL Injection
 * siempre que las queries se escriban parametrizadas (obligatorio en todo el código).
 */
const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  waitForConnections: true,
  connectionLimit: env.db.connectionLimit,
  queueLimit: 0,
  namedPlaceholders: true,
  dateStrings: false,
  // OJO: esta opción SOLO afecta cómo el driver convierte entre objetos Date de JS y el
  // formato DATETIME de MySQL al leer/escribir (ver node_modules/mysql2/lib/parsers/*) — NO
  // cambia la variable de sesión `time_zone` de MySQL, así que funciones SQL server-side como
  // NOW()/CURRENT_TIMESTAMP siguen usando la zona horaria real del servidor (por defecto
  // 'SYSTEM', la del SO) sin importar este valor. Por eso además se fuerza `time_zone` en cada
  // conexión más abajo — de lo contrario, comparaciones como `expires_at < NOW()` mezclan un
  // valor guardado en UTC (lo que manda el frontend, ya normalizado) contra un NOW() en hora
  // local del servidor, desalineados por el offset de esa zona horaria.
  timezone: 'Z',
});

// Fuerza la sesión de MySQL a UTC en cada conexión física del pool (una vez por conexión, no
// por query) — sin esto, `NOW()`/`CURRENT_TIMESTAMP` usan la hora local del servidor
// (`time_zone=SYSTEM`) mientras la app ya guarda y compara fechas en UTC, produciendo
// resultados desplazados por el offset horario del servidor (ej. invitaciones que expiran
// horas antes o después de lo esperado).
pool.on('connection', (connection) => {
  connection.query("SET time_zone = '+00:00'", (err) => {
    if (err) logger.error('[database] No se pudo fijar time_zone=+00:00 en la conexión', { error: err.message });
  });
});

// mysql2 emite 'error' sobre el propio pool cuando una conexión INACTIVA se cae por una causa
// transitoria (blip de red, restart de MySQL: PROTOCOL_CONNECTION_LOST, ECONNRESET, etc.) —
// normalmente el pool descartaría esa conexión y abriría una nueva sin más, pero un evento
// 'error' sin listener es tratado por Node como excepción no capturada, y
// `process.on('uncaughtException', ...)` en server.js hace `process.exit(1)`. Sin este
// listener, un simple corte de red momentáneo con la BD tumbaba TODO el proceso en vez de
// degradarse (las siguientes requests fallarían con 500 hasta que la conexión volviera, pero
// el servidor seguiría de pie).
pool.on('error', (error) => {
  logger.error('[database] Error en el pool de conexiones (posible corte transitorio con MySQL)', {
    code: error.code,
    message: error.message,
  });
});

async function testConnection() {
  const connection = await pool.getConnection();
  try {
    await connection.ping();
    logger.info(`[database] Conectado a MySQL en ${env.db.host}:${env.db.port}/${env.db.database}`);
  } finally {
    connection.release();
  }
}

/**
 * Ejecuta un callback dentro de una transacción MySQL.
 * @param {(conn: import('mysql2/promise').PoolConnection) => Promise<any>} callback
 */
async function withTransaction(callback) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { pool, testConnection, withTransaction };
