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
      `INSERT INTO invitations (uuid, club_id, code, created_by, max_uses, expires_at, status, default_role_id, requires_account, requires_member_profile, note)
       VALUES (UUID(), :clubId, :code, :createdBy, :maxUses, :expiresAt, :status, :defaultRoleId, :requiresAccount, :requiresMemberProfile, :note)`,
      { requiresAccount: 1, ...data }
    );
    return result.insertId;
  }

  // ------------------------------------------------------------------ fichas que pide (sql/072)

  /** Ids de las fichas que pide la invitación, en el orden de las fichas. */
  async findFormIds(invitationId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT f.id FROM invitation_forms i INNER JOIN member_forms f ON f.id = i.form_id
       WHERE i.invitation_id = ? ORDER BY f.sort_order ASC, f.id ASC`,
      [invitationId]
    );
    return rows.map((r) => r.id);
  }

  /** `{ invitationId: [{ id, name }] }`. */
  async findFormsFor(invitationIds, conn = pool) {
    if (!invitationIds.length) return {};
    const [rows] = await conn.query(
      `SELECT i.invitation_id, f.id, f.name FROM invitation_forms i INNER JOIN member_forms f ON f.id = i.form_id
       WHERE i.invitation_id IN (?) ORDER BY f.sort_order ASC, f.id ASC`,
      [invitationIds]
    );
    const map = {};
    for (const r of rows) (map[r.invitation_id] = map[r.invitation_id] || []).push({ id: r.id, name: r.name });
    return map;
  }

  async setForms(invitationId, formIds, conn = pool) {
    await conn.query('DELETE FROM invitation_forms WHERE invitation_id = ?', [invitationId]);
    if (formIds.length) await conn.query('INSERT INTO invitation_forms (invitation_id, form_id) VALUES ?', [formIds.map((id) => [invitationId, id])]);
  }

  /** Última invitación (id) con la que esa cuenta entró al club. */
  async findLatestUseFor(userId, clubId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT iu.invitation_id FROM invitation_uses iu INNER JOIN invitations i ON i.id = iu.invitation_id
       WHERE iu.user_id = ? AND i.club_id = ? ORDER BY iu.used_at DESC, iu.id DESC LIMIT 1`,
      [userId, clubId]
    );
    return rows[0]?.invitation_id ?? null;
  }

  /** Cuentas que entraron con esta invitación y siguen con fichas pendientes: pasan a tener
   * pendientes `formIds` (sin fichas = ya no tienen nada pendiente). */
  async syncPendingForms(invitationId, clubId, formIds, conn = pool) {
    await conn.query(
      `UPDATE user_clubs uc
       INNER JOIN invitation_uses iu ON iu.user_id = uc.user_id AND iu.invitation_id = ?
       SET uc.requires_profile_completion = ?, uc.pending_form_ids = ?
       WHERE uc.club_id = ? AND uc.requires_profile_completion = 1`,
      [invitationId, formIds.length ? 1 : 0, formIds.length ? JSON.stringify(formIds) : null, clubId]
    );
  }

  /** ¿El club tiene alguna invitación activa que pida fichas? (para mostrar Solicitudes). */
  async clubHasFormInvitations(clubId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT 1 FROM invitations i WHERE i.club_id = ? AND i.status = 'active'
       AND EXISTS (SELECT 1 FROM invitation_forms f WHERE f.invitation_id = i.id) LIMIT 1`,
      [clubId]
    );
    return rows.length > 0;
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

  async updateFields(invitationId, { maxUses, expiresAt, defaultRoleId, requiresAccount, requiresMemberProfile, note, status }, conn = pool) {
    await conn.query(
      `UPDATE invitations
       SET max_uses = ?, expires_at = ?, default_role_id = ?, requires_account = ?, requires_member_profile = ?, note = ?, status = ?
       WHERE id = ?`,
      [maxUses, expiresAt, defaultRoleId, requiresAccount, requiresMemberProfile, note, status, invitationId]
    );
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

  /** Un uso: una cuenta que entró al club (`userId`) o una solicitud enviada sin cuenta (`applicationId`). */
  async recordUse({ invitationId, userId = null, applicationId = null }, conn = pool) {
    await conn.query('INSERT INTO invitation_uses (invitation_id, user_id, application_id, used_at) VALUES (?, ?, ?, NOW())', [
      invitationId,
      userId,
      applicationId,
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
