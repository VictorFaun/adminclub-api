const { pool } = require('../config/database');

/** Fila única (id=1) de configuración global de la plataforma — ver sql/008_platform_settings.sql. */
class PlatformSettingsRepository {
  async get(conn = pool) {
    const [rows] = await conn.query('SELECT * FROM platform_settings WHERE id = 1 LIMIT 1');
    return rows[0] || null;
  }

  async updateTimezone(timezone, conn = pool) {
    await conn.query('UPDATE platform_settings SET timezone = ? WHERE id = 1', [timezone]);
  }
}

module.exports = new PlatformSettingsRepository();
