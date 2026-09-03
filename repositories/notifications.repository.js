const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');

class NotificationsRepository extends BaseRepository {
  constructor() {
    super('notifications', 'id');
  }

  async createNotification(data, conn = pool) {
    const [result] = await conn.query(
      `INSERT INTO notifications (user_id, club_id, type, title, message, link)
       VALUES (:userId, :clubId, :type, :title, :message, :link)`,
      data
    );
    return result.insertId;
  }

  async paginateByUser(userId, { limit, offset, unreadOnly, clubId }) {
    const params = [userId];
    const where = ['user_id = ?'];
    if (unreadOnly) where.push('is_read = 0');
    if (clubId) {
      where.push('club_id = ?');
      params.push(clubId);
    }
    const whereSql = where.join(' AND ');
    const [rows] = await pool.query(
      `SELECT * FROM notifications WHERE ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM notifications WHERE ${whereSql}`, params);
    // El conteo de no leídas siempre es global (todos los clubes) — alimenta la campana del
    // header, que muestra notificaciones de todos los clubes independiente del club actual.
    const [unreadRows] = await pool.query(
      'SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND is_read = 0',
      [userId]
    );
    return { rows, total: countRows[0].total, unreadCount: unreadRows[0].total };
  }

  async markRead(id, userId, conn = pool) {
    await conn.query('UPDATE notifications SET is_read = 1, read_at = NOW() WHERE id = ? AND user_id = ?', [
      id,
      userId,
    ]);
  }

  async markAllRead(userId, clubId, conn = pool) {
    const where = ['user_id = ?', 'is_read = 0'];
    const params = [userId];
    if (clubId) {
      where.push('club_id = ?');
      params.push(clubId);
    }
    await conn.query(`UPDATE notifications SET is_read = 1, read_at = NOW() WHERE ${where.join(' AND ')}`, params);
  }
}

module.exports = new NotificationsRepository();
