/* eslint-disable no-console */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const env = require('../config/env');

const SQL_DIR = path.join(__dirname, '..', 'sql');

async function run() {
  const connection = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    multipleStatements: true,
  });

  try {
    const files = fs
      .readdirSync(SQL_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
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
      // eslint-disable-next-line no-await-in-loop
      await connection.query(sql);
      console.log(`[migrate] OK ${file}`);
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
