const BaseRepository = require('./BaseRepository');
const { pool } = require('../config/database');

/** Invitaciones del club a un usuario existente (ver clubUserInvitations.service.js). */
class ClubUserInvitationsRepository extends BaseRepository {
  constructor() {
    super('club_user_invitations');
  }

  async findByClubAndUser(clubId, userId, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM club_user_invitations WHERE club_id = ? AND user_id = ? LIMIT 1', [clubId, userId]);
    return rows[0] || null;
  }

  async create({ clubId, userId, invitedBy, message, roleIds }, conn = pool) {
    const [result] = await conn.query('INSERT INTO club_user_invitations (club_id, user_id, invited_by, message) VALUES (?, ?, ?, ?)', [
      clubId,
      userId,
      invitedBy,
      message,
    ]);
    if (roleIds.length) {
      await conn.query('INSERT INTO club_user_invitation_roles (invitation_id, role_id) VALUES ?', [roleIds.map((roleId) => [result.insertId, roleId])]);
    }
    return result.insertId;
  }

  /** Roles que recibirá al aceptar (solo los que siguen existiendo en ese club). */
  async findRoles(invitationIds, conn = pool) {
    if (!invitationIds.length) return [];
    const [rows] = await conn.query(
      `SELECT cuir.invitation_id, r.id, r.name, r.color
       FROM club_user_invitation_roles cuir
       INNER JOIN club_user_invitations cui ON cui.id = cuir.invitation_id
       INNER JOIN roles r ON r.id = cuir.role_id AND r.club_id = cui.club_id
       WHERE cuir.invitation_id IN (?)
       ORDER BY r.name ASC`,
      [invitationIds]
    );
    return rows;
  }

  /** Pendientes de un usuario, con los datos del club y de quién invitó (clubes activos). */
  async findPendingForUser(userId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT cui.*, c.name AS club_name, c.description AS club_description, c.logo_url AS club_logo_url,
              c.banner_url AS club_banner_url, c.primary_color AS club_primary_color, c.secondary_color AS club_secondary_color,
              u.username AS inviter_username
       FROM club_user_invitations cui
       INNER JOIN clubs c ON c.id = cui.club_id AND c.deleted_at IS NULL AND c.status = 'active'
       LEFT JOIN users u ON u.id = cui.invited_by
       WHERE cui.user_id = ?
       ORDER BY cui.created_at DESC`,
      [userId]
    );
    return rows;
  }

  async countPendingForUser(userId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT COUNT(*) AS total FROM club_user_invitations cui
       INNER JOIN clubs c ON c.id = cui.club_id AND c.deleted_at IS NULL AND c.status = 'active'
       WHERE cui.user_id = ?`,
      [userId]
    );
    return rows[0].total;
  }

  /** Borra y devuelve si la fila existía: resuelve la carrera aceptar/rechazar/cancelar a la vez
   * (solo quien la borra primero sigue adelante). */
  async claimDelete(id, conn = pool) {
    const [result] = await conn.query('DELETE FROM club_user_invitations WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }
}

module.exports = new ClubUserInvitationsRepository();
