const { pool } = require('../config/database');

/** Mirror EXACTO de chargeStatusColors.repository.js. */
class TrainingStatusColorsRepository {
  async findByClub(clubId, conn = pool) {
    const [rows] = await conn.query('SELECT status_code, color FROM training_status_colors WHERE club_id = ?', [clubId]);
    return rows;
  }

  /** `entries`: [{ statusCode, color }] — `color` puede ser `null` (guarda "sin color" a propósito). */
  async upsertMany(clubId, entries, conn = pool) {
    if (!entries.length) return;
    const values = entries.map((e) => [clubId, e.statusCode, e.color]);
    await conn.query(
      `INSERT INTO training_status_colors (club_id, status_code, color) VALUES ?
       ON DUPLICATE KEY UPDATE color = VALUES(color), updated_at = NOW()`,
      [values]
    );
  }
}

module.exports = new TrainingStatusColorsRepository();
