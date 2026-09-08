const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');

class InvitationsRepository extends BaseRepository {
  constructor() {
    super('invitations', 'id');
  }

  async findByCode(code, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM invitations WHERE code = ? LIMIT 1', [code]);
    return rows[0] || null;
  }

  async createInvitation(data, conn = pool) {
    const [result] = await conn.query(
      `INSERT INTO invitations (uuid, club_id, code, created_by, max_uses, expires_at, status, default_role_id, requires_member_profile, note)
       VALUES (UUID(), :clubId, :code, :createdBy, :maxUses, :expiresAt, :status, :defaultRoleId, :requiresMemberProfile, :note)`,
      data
    );
    return result.insertId;
  }

  async paginateByClub(clubId, { limit, offset, sortBy, sortOrder, status }) {
    const params = [clubId];
    const where = ['club_id = ?'];
    if (status) {
      where.push('status = ?');
      params.push(status);
    }
    const whereSql = where.join(' AND ');
    const [rows] = await pool.query(
      `SELECT i.*, u.username AS creator_username
       FROM invitations i LEFT JOIN users u ON u.id = i.created_by
       WHERE ${whereSql} ORDER BY i.${sortBy} ${sortOrder} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM invitations WHERE ${whereSql}`, params);
    return { rows, total: countRows[0].total };
  }

  async incrementUse(invitationId, conn = pool) {
    await conn.query('UPDATE invitations SET uses_count = uses_count + 1 WHERE id = ?', [invitationId]);
  }

  /**
   * Reclama atómicamente un uso de la invitación: solo incrementa `uses_count` (y marca
   * 'exhausted' si con este uso se llega al límite) si la invitación SIGUE activa y por
   * debajo de `max_uses`, todo en una sola sentencia. Necesario porque el chequeo previo
   * de "¿está agotada?" en joinByCode se hace fuera de la transacción, contra un
   * `uses_count` que puede haber quedado obsoleto si otra request concurrente ya consumió
   * el último uso disponible — dos requests simultáneas podían pasar ambas esa validación
   * y dejar `uses_count` en 2 con `max_uses = 1`. El UPDATE con el límite en el propio WHERE
   * es atómico a nivel de fila (el lock de InnoDB serializa updates concurrentes sobre la
   * misma fila), así que como mucho una de las dos gana. Devuelve false si no se pudo
   * reclamar (ya inactiva o sin usos disponibles) — el llamador debe abortar la operación.
   */
  async claimUse(invitationId, conn = pool) {
    const [result] = await conn.query(
      `UPDATE invitations
       SET uses_count = uses_count + 1,
           status = CASE WHEN max_uses IS NOT NULL AND uses_count + 1 >= max_uses THEN 'exhausted' ELSE status END
       WHERE id = ? AND status = 'active' AND (max_uses IS NULL OR uses_count < max_uses)`,
      [invitationId]
    );
    return result.affectedRows > 0;
  }

  async setStatus(invitationId, status, conn = pool) {
    await conn.query('UPDATE invitations SET status = ? WHERE id = ?', [status, invitationId]);
  }

  async recordUse({ invitationId, userId }, conn = pool) {
    await conn.query('INSERT INTO invitation_uses (invitation_id, user_id, used_at) VALUES (?, ?, NOW())', [
      invitationId,
      userId,
    ]);
  }

  async expireOutdated(conn = pool) {
    const [result] = await conn.query(
      `UPDATE invitations SET status = 'expired'
       WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < NOW()`
    );
    return result.affectedRows;
  }
}

module.exports = new InvitationsRepository();
