const { pool } = require('../config/database');

class SettingsRepository {
  async findAllByClub(clubId, conn = pool) {
    const [rows] = await conn.query('SELECT setting_key, setting_value FROM club_settings WHERE club_id = ?', [
      clubId,
    ]);
    return rows.reduce((acc, row) => {
      acc[row.setting_key] = row.setting_value;
      return acc;
    }, {});
  }

  async upsertMany(clubId, entries, conn = pool) {
    const keys = Object.keys(entries);
    if (!keys.length) return;
    const values = keys.map((key) => [clubId, key, String(entries[key])]);
    await conn.query(
      `INSERT INTO club_settings (club_id, setting_key, setting_value) VALUES ?
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = NOW()`,
      [values]
    );
  }
}

module.exports = new SettingsRepository();
