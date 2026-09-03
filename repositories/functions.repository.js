const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');

class FunctionsRepository extends BaseRepository {
  constructor() {
    super('functions', 'id');
  }

  async findAllGrouped(conn = pool) {
    const [rows] = await conn.query('SELECT * FROM functions ORDER BY category ASC, name ASC');
    return rows;
  }

  /**
   * Solo las funcionalidades asignables a un rol de club (excluye las de plataforma,
   * como MANAGE_PLATFORM/VIEW_ALL_CLUBS, reservadas a roles globales por encima del
   * administrador de club). Usado por el catálogo público (GET /functions) y por la
   * validación al crear/editar un rol de club (`roles.service.js`).
   */
  async findClubAssignableGrouped(conn = pool) {
    const [rows] = await conn.query('SELECT * FROM functions WHERE is_club_assignable = 1 ORDER BY category ASC, name ASC');
    return rows;
  }

  async findByCode(code, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM functions WHERE code = ? LIMIT 1', [code]);
    return rows[0] || null;
  }

  /**
   * Devuelve el set de codes de funcionalidades habilitadas para un usuario en un club
   * (unión de funciones de sus roles globales + funciones de sus roles del club).
   */
  async findUserPermissionCodes(userId, clubId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT DISTINCT f.code FROM user_roles ur
       INNER JOIN role_functions rf ON rf.role_id = ur.role_id
       INNER JOIN functions f ON f.id = rf.function_id
       WHERE ur.user_id = ? AND (ur.club_id IS NULL OR ur.club_id = ?)`,
      [userId, clubId]
    );
    return rows.map((r) => r.code);
  }

  async findGlobalPermissionCodes(userId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT DISTINCT f.code FROM user_roles ur
       INNER JOIN role_functions rf ON rf.role_id = ur.role_id
       INNER JOIN functions f ON f.id = rf.function_id
       INNER JOIN roles r ON r.id = ur.role_id AND r.scope = 'global'
       WHERE ur.user_id = ?`,
      [userId]
    );
    return rows.map((r) => r.code);
  }
}

module.exports = new FunctionsRepository();
