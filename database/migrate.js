/* eslint-disable no-console */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const env = require('../config/env');

const SQL_DIR = path.join(__dirname, '..', 'sql');

// Errores de MySQL que solo pueden significar "esta sentencia ya se aplicó antes" (columna/
// índice/tabla duplicados, entrada duplicada, o un DROP sobre algo que ya no existe). Antes de
// este tracking, migrate.js no llevaba registro de qué archivos ya habían corrido y volvía a
// ejecutarlos TODOS en cada llamada — inofensivo para los que usan CREATE TABLE IF NOT EXISTS /
// INSERT IGNORE, pero varias migraciones más viejas (006, y probablemente otras más adelante)
// tienen sentencias que solo tienen sentido corriendo una vez (ALTER TABLE ADD/DROP COLUMN sin
// guarda). Cualquier otro código de error aborta el proceso como siempre: solo estos códigos
// puntuales son señal inequívoca de "ya aplicada", nunca de un bug real.
const ALREADY_APPLIED_ERRNOS = new Set([
  1050, // ER_TABLE_EXISTS_ERROR
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
  1062, // ER_DUP_ENTRY
  1091, // ER_CANT_DROP_FIELD_OR_KEY
]);

async function ensureMigrationsTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function getAppliedMigrations(connection) {
  const [rows] = await connection.query('SELECT filename FROM schema_migrations');
  return new Set(rows.map((r) => r.filename));
}

async function markApplied(connection, file) {
  await connection.query('INSERT IGNORE INTO schema_migrations (filename) VALUES (?)', [file]);
}

async function run() {
  const connection = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    multipleStatements: true,
  });

  try {
    // ensureMigrationsTable necesita una base seleccionada, pero eso hasta ahora solo lo hacía
    // el propio 001_schema.sql (CREATE DATABASE IF NOT EXISTS + USE) al correr como parte del
    // loop de archivos. Se adelanta acá para que la tabla de tracking se pueda crear ANTES de
    // ejecutar ningún archivo, sin depender de que 001 sea siempre el primero.
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${env.db.database}\`; USE \`${env.db.database}\`;`
    );
    await ensureMigrationsTable(connection);
    const applied = await getAppliedMigrations(connection);

    const files = fs
      .readdirSync(SQL_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`[migrate] Omitida ${file} (ya aplicada).`);
        continue; // eslint-disable-line no-continue
      }

      let sql = fs.readFileSync(path.join(SQL_DIR, file), 'utf8');
      // Cada archivo trae hardcodeado `` `admin_club` `` en su propio CREATE DATABASE/USE (ver
      // sql/001_schema.sql y el resto, que repiten "USE `admin_club`;") — si alguien cambia
      // DB_NAME en .env (el propio .env.example invita a hacerlo), la app y `seed.js` sí
      // respetan esa variable (vía config/database.js), pero migrate.js seguía creando/migrando
      // siempre la base `admin_club` literal, dejando la base realmente configurada sin tablas.
      // Se sustituye el identificador entrecomillado por el nombre configurado antes de
      // ejecutar cada archivo, sin tener que editar el histórico de migraciones a mano.
      if (env.db.database !== 'admin_club') {
        sql = sql.replace(/`admin_club`/g, `\`${env.db.database}\``);
      }
      console.log(`[migrate] Ejecutando ${file} ...`);
      try {
        // eslint-disable-next-line no-await-in-loop
        await connection.query(sql);
        console.log(`[migrate] OK ${file}`);
      } catch (err) {
        if (!ALREADY_APPLIED_ERRNOS.has(err.errno)) throw err;
        // Base migrada a mano antes de que existiera esta tabla de tracking (o una corrida
        // vieja que falló a mitad de un archivo no idempotente): el error confirma que esta
        // migración específica ya estaba aplicada, así que se registra y se sigue con la
        // siguiente en vez de abortar toda la migración.
        console.log(`[migrate] ${file} ya estaba aplicada (${err.code}), se registra y continúa.`);
      }
      // eslint-disable-next-line no-await-in-loop
      await markApplied(connection, file);
    }

    console.log('[migrate] Migración completa.');
  } finally {
    await connection.end();
  }
}

run().catch((err) => {
  console.error('[migrate] Error:', err.message);
  process.exit(1);
});
