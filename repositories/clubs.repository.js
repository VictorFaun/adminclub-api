const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');

class ClubsRepository extends BaseRepository {
  constructor() {
    super('clubs', 'id');
  }

  async findActiveById(id, conn = pool) {
    const [rows] = await conn.query("SELECT * FROM clubs WHERE id = ? AND deleted_at IS NULL LIMIT 1", [id]);
    return rows[0] || null;
  }

  async findByPublicCode(publicCode, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM clubs WHERE public_code = ? AND deleted_at IS NULL LIMIT 1', [
      publicCode,
    ]);
    return rows[0] || null;
  }

  async findByInviteCode(inviteCode, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM clubs WHERE invite_code = ? AND deleted_at IS NULL LIMIT 1', [
      inviteCode,
    ]);
    return rows[0] || null;
  }

  async publicCodeExists(publicCode, excludeClubId = null, conn = pool) {
    const sql = excludeClubId
      ? 'SELECT id FROM clubs WHERE public_code = ? AND id != ? LIMIT 1'
      : 'SELECT id FROM clubs WHERE public_code = ? LIMIT 1';
    const params = excludeClubId ? [publicCode, excludeClubId] : [publicCode];
    const [rows] = await conn.query(sql, params);
    return rows.length > 0;
  }

  async createClub(data, conn = pool) {
    const [result] = await conn.query(
      `INSERT INTO clubs
        (uuid, name, public_code, invite_code, description, primary_color, secondary_color, theme, timezone, status, is_public, created_by)
       VALUES (UUID(), :name, :publicCode, :inviteCode, :description, :primaryColor, :secondaryColor, :theme, :timezone, :status, :isPublic, :createdBy)`,
      data
    );
    return result.insertId;
  }

  async paginatePublic({ limit, offset, search }) {
    const params = [];
    const where = ["deleted_at IS NULL", "status = 'active'", "is_public = 1"];
    if (search) {
      where.push('name LIKE ?');
      params.push(`%${search}%`);
    }
    const whereSql = where.join(' AND ');
    const [rows] = await pool.query(
      `SELECT id, uuid, name, public_code, description, logo_url, banner_url, primary_color, secondary_color
       FROM clubs WHERE ${whereSql} ORDER BY name ASC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM clubs WHERE ${whereSql}`, params);
    return { rows, total: countRows[0].total };
  }

  async paginateAll({ limit, offset, sortBy, sortOrder, search, status }) {
    const params = [];
    const where = ['deleted_at IS NULL'];
    if (status) {
      where.push('status = ?');
      params.push(status);
    }
    if (search) {
      where.push('name LIKE ?');
      params.push(`%${search}%`);
    }
    const whereSql = where.join(' AND ');
    const [rows] = await pool.query(
      `SELECT * FROM clubs WHERE ${whereSql} ORDER BY ${sortBy} ${sortOrder} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM clubs WHERE ${whereSql}`, params);
    return { rows, total: countRows[0].total };
  }

  async softDelete(id, conn = pool) {
    await conn.query('UPDATE clubs SET deleted_at = NOW(), status = "inactive" WHERE id = ?', [id]);
  }

  async regenerateInviteCode(id, inviteCode, conn = pool) {
    await conn.query('UPDATE clubs SET invite_code = ? WHERE id = ?', [inviteCode, id]);
  }

  async countUsers(clubId, conn = pool) {
    const [rows] = await conn.query(
      "SELECT COUNT(*) AS total FROM user_clubs WHERE club_id = ? AND status = 'active'",
      [clubId]
    );
    return rows[0].total;
  }

  async countRoles(clubId, conn = pool) {
    const [rows] = await conn.query('SELECT COUNT(*) AS total FROM roles WHERE club_id = ?', [clubId]);
    return rows[0].total;
  }

  async countActiveInvitations(clubId, conn = pool) {
    const [rows] = await conn.query(
      "SELECT COUNT(*) AS total FROM invitations WHERE club_id = ? AND status = 'active'",
      [clubId]
    );
    return rows[0].total;
  }
}

module.exports = new ClubsRepository();
