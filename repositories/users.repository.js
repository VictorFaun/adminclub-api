const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');

class UsersRepository extends BaseRepository {
  constructor() {
    super('users', 'id');
  }

  async findByEmail(email, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
    return rows[0] || null;
  }

  async emailExists(email, excludeUserId = null, conn = pool) {
    const params = [email];
    let sql = 'SELECT id FROM users WHERE email = ?';
    if (excludeUserId) {
      sql += ' AND id != ?';
      params.push(excludeUserId);
    }
    const [rows] = await conn.query(`${sql} LIMIT 1`, params);
    return rows.length > 0;
  }

  async createUser(data, conn = pool) {
    const [result] = await conn.query(
      `INSERT INTO users (uuid, username, email, password_hash, status, phone)
       VALUES (UUID(), :username, :email, :passwordHash, :status, :phone)`,
      data
    );
    return result.insertId;
  }

  async setEmailVerified(userId, conn = pool) {
    await conn.query('UPDATE users SET email_verified_at = NOW() WHERE id = ?', [userId]);
  }

  async updatePasswordHash(userId, passwordHash, conn = pool) {
    await conn.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);
  }

  async touchLastLogin(userId, conn = pool) {
    await conn.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [userId]);
  }

  async setDefaultClub(userId, clubId, conn = pool) {
    await conn.query('UPDATE users SET default_club_id = ? WHERE id = ?', [clubId, userId]);
  }

  async paginate({ limit, offset, sortBy, sortOrder, search, clubId, status }) {
    const params = [];
    const joins = [];
    const where = ['u.deleted_at IS NULL'];
    let selectExtra = '';

    if (clubId) {
      joins.push('INNER JOIN user_clubs uc ON uc.user_id = u.id AND uc.club_id = ?');
      params.push(clubId);
      // El estado que importa para un admin de club es la membresía (uc.status),
      // no el estado global de la cuenta: suspender/reactivar solo cambia uc.status.
      selectExtra = ', uc.status AS membership_status';
    }
    if (status) {
      where.push(clubId ? 'uc.status = ?' : 'u.status = ?');
      params.push(status);
    }
    if (search) {
      where.push('(u.username LIKE ? OR u.email LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    const whereSql = where.join(' AND ');
    const joinSql = joins.join(' ');

    const [rows] = await pool.query(
      `SELECT DISTINCT u.*${selectExtra} FROM users u ${joinSql} WHERE ${whereSql}
       ORDER BY u.${sortBy} ${sortOrder} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [countRows] = await pool.query(
      `SELECT COUNT(DISTINCT u.id) AS total FROM users u ${joinSql} WHERE ${whereSql}`,
      params
    );
    return { rows, total: countRows[0].total };
  }

  async findClubsForUser(userId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT c.*, uc.status AS membership_status, uc.is_default, uc.joined_at
       FROM user_clubs uc INNER JOIN clubs c ON c.id = uc.club_id
       WHERE uc.user_id = ? AND c.deleted_at IS NULL
       ORDER BY uc.is_default DESC, c.name ASC`,
      [userId]
    );
    return rows;
  }

  async findMembership(userId, clubId, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM user_clubs WHERE user_id = ? AND club_id = ? LIMIT 1', [
      userId,
      clubId,
    ]);
    return rows[0] || null;
  }

  async addToClub({ userId, clubId, status, isDefault }, conn = pool) {
    // is_default también se reafirma en el UPDATE: todos los llamadores pasan un
    // isDefault deliberado (p.ej. setDefaultClub reactiva una membresía existente
    // con isDefault: true), no solo para la fila nueva del INSERT.
    await conn.query(
      `INSERT INTO user_clubs (user_id, club_id, status, is_default, joined_at)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE status = VALUES(status), is_default = VALUES(is_default)`,
      [userId, clubId, status, isDefault ? 1 : 0]
    );
  }

  async setMembershipStatus(userId, clubId, status, conn = pool) {
    await conn.query('UPDATE user_clubs SET status = ? WHERE user_id = ? AND club_id = ?', [status, userId, clubId]);
  }

  async clearDefaultClub(userId, conn = pool) {
    await conn.query('UPDATE user_clubs SET is_default = 0 WHERE user_id = ?', [userId]);
  }

  async countClubsForUser(userId, conn = pool) {
    const [rows] = await conn.query(
      "SELECT COUNT(*) AS total FROM user_clubs WHERE user_id = ? AND status = 'active'",
      [userId]
    );
    return rows[0].total;
  }

  async findGlobalRoleCodes(userId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT r.name FROM user_roles ur
       INNER JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = ? AND r.scope = 'global'`,
      [userId]
    );
    return rows.map((r) => r.name);
  }

  async softDelete(userId, conn = pool) {
    await conn.query('UPDATE users SET deleted_at = NOW() WHERE id = ?', [userId]);
  }
}

module.exports = new UsersRepository();
