const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');

class JoinRequestsRepository extends BaseRepository {
  constructor() {
    super('join_requests', 'id');
  }

  async findPending(userId, clubId, conn = pool) {
    const [rows] = await conn.query(
      "SELECT * FROM join_requests WHERE user_id = ? AND club_id = ? AND status = 'pending' LIMIT 1",
      [userId, clubId]
    );
    return rows[0] || null;
  }

  async createRequest({ userId, clubId, message }, conn = pool) {
    const [result] = await conn.query(
      'INSERT INTO join_requests (user_id, club_id, message, status) VALUES (?, ?, ?, "pending")',
      [userId, clubId, message || null]
    );
    return result.insertId;
  }

  /** `archived`: true = solo las archivadas (de cualquier estado); si no, solo las no archivadas. */
  async paginateByClub(clubId, { limit, offset, status, search, archived = false }) {
    const params = [clubId];
    const where = ['jr.club_id = ?', archived ? 'jr.archived_at IS NOT NULL' : 'jr.archived_at IS NULL'];
    if (status) {
      where.push('jr.status = ?');
      params.push(status);
    }
    if (search) {
      where.push('(u.username LIKE ? OR u.email LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    const whereSql = where.join(' AND ');
    const [rows] = await pool.query(
      `SELECT jr.*, u.username, u.email, u.avatar_url, rv.username AS reviewed_by_username
       FROM join_requests jr INNER JOIN users u ON u.id = jr.user_id
       LEFT JOIN users rv ON rv.id = jr.reviewed_by
       WHERE ${whereSql} ORDER BY jr.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM join_requests jr INNER JOIN users u ON u.id = jr.user_id WHERE ${whereSql}`,
      params
    );
    return { rows, total: countRows[0].total };
  }

  /** Archiva/desarchiva (solo lo ya revisado de ese club). Devuelve cuántas filas cambió. */
  async setArchived(clubId, ids, archived, actorId, conn = pool) {
    if (!ids.length) return 0;
    const [result] = await conn.query(
      `UPDATE join_requests SET archived_at = ${archived ? 'NOW()' : 'NULL'}, archived_by = ?
       WHERE club_id = ? AND id IN (?) AND status <> 'pending' AND archived_at IS ${archived ? 'NULL' : 'NOT NULL'}`,
      [archived ? actorId : null, clubId, ids]
    );
    return result.affectedRows;
  }

  async resolve({ id, status, reviewedBy }, conn = pool) {
    await conn.query('UPDATE join_requests SET status = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?', [
      status,
      reviewedBy,
      id,
    ]);
  }
}

module.exports = new JoinRequestsRepository();
