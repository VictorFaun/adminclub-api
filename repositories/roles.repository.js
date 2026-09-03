const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');

class RolesRepository extends BaseRepository {
  constructor() {
    super('roles', 'id');
  }

  async findByNameInScope(name, clubId, conn = pool) {
    const sql = clubId
      ? 'SELECT * FROM roles WHERE name = ? AND club_id = ? LIMIT 1'
      : 'SELECT * FROM roles WHERE name = ? AND club_id IS NULL LIMIT 1';
    const params = clubId ? [name, clubId] : [name];
    const [rows] = await conn.query(sql, params);
    return rows[0] || null;
  }

  async findGlobalRoles(conn = pool) {
    const [rows] = await conn.query('SELECT * FROM roles WHERE scope = "global" ORDER BY name ASC');
    return rows;
  }

  async findClubRoles(clubId, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM roles WHERE club_id = ? ORDER BY name ASC', [clubId]);
    return rows;
  }

  async createRole(data, conn = pool) {
    const [result] = await conn.query(
      `INSERT INTO roles (uuid, club_id, name, description, scope, color, is_system)
       VALUES (UUID(), :clubId, :name, :description, :scope, :color, :isSystem)`,
      data
    );
    return result.insertId;
  }

  async getFunctionCodes(roleId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT f.code FROM role_functions rf INNER JOIN functions f ON f.id = rf.function_id WHERE rf.role_id = ?`,
      [roleId]
    );
    return rows.map((r) => r.code);
  }

  async getFunctionIds(roleId, conn = pool) {
    const [rows] = await conn.query('SELECT function_id FROM role_functions WHERE role_id = ?', [roleId]);
    return rows.map((r) => r.function_id);
  }

  async setFunctions(roleId, functionIds, conn = pool) {
    await conn.query('DELETE FROM role_functions WHERE role_id = ?', [roleId]);
    if (!functionIds.length) return;
    const values = functionIds.map((functionId) => [roleId, functionId]);
    await conn.query('INSERT INTO role_functions (role_id, function_id) VALUES ?', [values]);
  }

  async countUsersWithRole(roleId, conn = pool) {
    const [rows] = await conn.query('SELECT COUNT(DISTINCT user_id) AS total FROM user_roles WHERE role_id = ?', [
      roleId,
    ]);
    return rows[0].total;
  }

  async assignToUser({ userId, roleId, clubId, assignedBy }, conn = pool) {
    await conn.query(
      `INSERT IGNORE INTO user_roles (user_id, role_id, club_id, assigned_by, assigned_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [userId, roleId, clubId, assignedBy]
    );
  }

  async unassignFromUser({ userId, roleId, clubId }, conn = pool) {
    const sql = clubId
      ? 'DELETE FROM user_roles WHERE user_id = ? AND role_id = ? AND club_id = ?'
      : 'DELETE FROM user_roles WHERE user_id = ? AND role_id = ? AND club_id IS NULL';
    const params = clubId ? [userId, roleId, clubId] : [userId, roleId];
    await conn.query(sql, params);
  }

  async findRolesForUser(userId, clubId, conn = pool) {
    const sql = clubId
      ? `SELECT r.* FROM user_roles ur INNER JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = ? AND ur.club_id = ?`
      : `SELECT r.* FROM user_roles ur INNER JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = ? AND ur.club_id IS NULL`;
    const params = clubId ? [userId, clubId] : [userId];
    const [rows] = await conn.query(sql, params);
    return rows;
  }

  /**
   * Roles de varios usuarios en un club, en una sola consulta (evita N+1 en
   * listados). Devuelve un mapa `{ [userId]: { id, name, color }[] }`.
   */
  async findRolesForUsers(userIds, clubId, conn = pool) {
    if (!userIds.length) return {};
    const [rows] = await conn.query(
      `SELECT ur.user_id AS user_id, r.id, r.name, r.color FROM user_roles ur
       INNER JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id IN (?) AND ur.club_id = ?`,
      [userIds, clubId]
    );
    const byUser = {};
    for (const row of rows) {
      if (!byUser[row.user_id]) byUser[row.user_id] = [];
      byUser[row.user_id].push({ id: row.id, name: row.name, color: row.color });
    }
    return byUser;
  }

  async findAllRolesForUserAcrossClubs(userId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT r.*, ur.club_id AS assignment_club_id FROM user_roles ur
       INNER JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`,
      [userId]
    );
    return rows;
  }

  async deleteRole(roleId, conn = pool) {
    const [result] = await conn.query('DELETE FROM roles WHERE id = ? AND is_system = 0', [roleId]);
    return result.affectedRows > 0;
  }
}

module.exports = new RolesRepository();
