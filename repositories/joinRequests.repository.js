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

  async paginateByClub(clubId, { limit, offset, status, search }) {
    const params = [clubId];
    const where = ['jr.club_id = ?'];
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
      `SELECT jr.*, u.username, u.email, u.avatar_url
       FROM join_requests jr INNER JOIN users u ON u.id = jr.user_id
       WHERE ${whereSql} ORDER BY jr.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM join_requests jr INNER JOIN users u ON u.id = jr.user_id WHERE ${whereSql}`,
      params
    );
    return { rows, total: countRows[0].total };
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
