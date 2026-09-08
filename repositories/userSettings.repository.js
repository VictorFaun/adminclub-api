const { pool } = require('../config/database');

/** Mismo patrón clave/valor que `settings.repository.js` (club_settings), pero además por
 * usuario — ver sql/029_user_settings.sql. */
class UserSettingsRepository {
  async findAllForUser(userId, clubId, conn = pool) {
    const [rows] = await conn.query('SELECT setting_key, setting_value FROM user_settings WHERE user_id = ? AND club_id = ?', [
      userId,
      clubId,
    ]);
    return rows.reduce((acc, row) => {
      acc[row.setting_key] = row.setting_value;
      return acc;
    }, {});
  }

  async upsertMany(userId, clubId, entries, conn = pool) {
    const keys = Object.keys(entries);
    if (!keys.length) return;
    const values = keys.map((key) => [userId, clubId, key, String(entries[key])]);
    await conn.query(
      `INSERT INTO user_settings (user_id, club_id, setting_key, setting_value) VALUES ?
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = NOW()`,
      [values]
    );
  }
}

module.exports = new UserSettingsRepository();
