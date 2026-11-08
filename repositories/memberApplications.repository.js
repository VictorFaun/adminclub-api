const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');

/** Solicitudes de inscripción enviadas desde el formulario público (ver sql/051_member_applications.sql). */
class MemberApplicationsRepository extends BaseRepository {
  constructor() {
    super('member_applications', 'id');
  }

  /** `userId`: ficha enviada por una cuenta (código de invitación que exige ficha); null = formulario
   * público. `invitationId`: invitación de la que viene; `formIds`: fichas que responde;
   * `targetMemberId`: miembro existente (mismo identificador) al que se suma al aceptarla. */
  async create({ clubId, fields, message, groupId = null, userId = null, invitationId = null, formIds = [], targetMemberId = null }, conn = pool) {
    const [result] = await conn.query(
      `INSERT INTO member_applications (uuid, club_id, user_id, invitation_id, fields, form_ids, group_id, message, target_member_id)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?)`,
      [clubId, userId, invitationId, JSON.stringify(fields || {}), JSON.stringify(formIds || []), groupId, message, targetMemberId]
    );
    return result.insertId;
  }

  /** Última ficha que envió esa cuenta en el club (para saber si está en revisión o rechazada). */
  async findLatestForUser(clubId, userId, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM member_applications WHERE club_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1', [clubId, userId]);
    return rows[0] || null;
  }

  async findInClub(clubId, id, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM member_applications WHERE club_id = ? AND id = ? LIMIT 1', [clubId, id]);
    return rows[0] || null;
  }

  async listByClub(clubId, status, conn = pool) {
    const params = [clubId];
    let where = 'ma.club_id = ?';
    if (status) {
      where += ' AND ma.status = ?';
      params.push(status);
    }
    const [rows] = await conn.query(
      `SELECT ma.*, u.username AS reviewed_by_username, g.name AS group_name,
              au.username AS account_username, au.email AS account_email, au.avatar_url AS account_avatar_url,
              inv.code AS invitation_code, inv.note AS invitation_note
       FROM member_applications ma LEFT JOIN users u ON u.id = ma.reviewed_by
       LEFT JOIN users au ON au.id = ma.user_id
       LEFT JOIN member_groups g ON g.id = ma.group_id
       LEFT JOIN invitations inv ON inv.id = ma.invitation_id
       WHERE ${where}
       ORDER BY (ma.status = 'pending') DESC, ma.created_at DESC LIMIT 300`,
      params
    );
    return rows;
  }

  async countPending(clubId, conn = pool) {
    const [rows] = await conn.query("SELECT COUNT(*) AS total FROM member_applications WHERE club_id = ? AND status = 'pending'", [clubId]);
    return rows[0].total;
  }

  async markReviewed(id, { status, reviewedBy, reviewNote, memberId }, conn = pool) {
    await conn.query('UPDATE member_applications SET status = ?, reviewed_by = ?, reviewed_at = NOW(), review_note = ?, member_id = ? WHERE id = ?', [
      status,
      reviewedBy,
      reviewNote || null,
      memberId || null,
      id,
    ]);
  }

  // ---------------------------------------------------------------- archivos adjuntos

  async addFiles(applicationId, fieldId, files, conn = pool) {
    for (const f of files) {
      await conn.query('INSERT INTO member_application_files (application_id, field_id, name, file_path, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?, ?)', [
        applicationId,
        fieldId,
        f.name,
        f.file_path,
        f.mime_type,
        f.size_bytes,
      ]);
    }
  }

  async findFiles(applicationIds, conn = pool) {
    if (!applicationIds.length) return [];
    const [rows] = await conn.query('SELECT * FROM member_application_files WHERE application_id IN (?) ORDER BY id', [applicationIds]);
    return rows;
  }

  async deleteFiles(applicationId, conn = pool) {
    await conn.query('DELETE FROM member_application_files WHERE application_id = ?', [applicationId]);
  }

  /** Pasa a otra solicitud los archivos de una anterior (reenvío tras un rechazo), salvo los de
   * los campos en que se subió algo nuevo. Devuelve las filas que NO se pasaron (para borrar sus
   * archivos del disco). */
  async moveFiles(fromApplicationId, toApplicationId, exceptFieldIds = [], conn = pool) {
    await conn.query('UPDATE member_application_files SET application_id = ? WHERE application_id = ? AND field_id NOT IN (?)', [
      toApplicationId,
      fromApplicationId,
      exceptFieldIds.length ? exceptFieldIds : [0],
    ]);
    const [rest] = await conn.query('SELECT * FROM member_application_files WHERE application_id = ?', [fromApplicationId]);
    await this.deleteFiles(fromApplicationId, conn);
    return rest;
  }

  /** Usuarios activos del club que pueden aceptar solicitudes (tienen CREATE_MEMBERS). */
  async findReviewerUserIds(clubId, functionCode, conn = pool) {
    const [rows] = await conn.query(
      `SELECT DISTINCT ur.user_id
       FROM user_roles ur
       INNER JOIN roles r ON r.id = ur.role_id
       INNER JOIN role_functions rf ON rf.role_id = r.id
       INNER JOIN functions f ON f.id = rf.function_id
       INNER JOIN user_clubs uc ON uc.user_id = ur.user_id AND uc.club_id = ? AND uc.status = 'active'
       WHERE ur.club_id = ? AND f.code = ?`,
      [clubId, clubId, functionCode]
    );
    return rows.map((r) => r.user_id);
  }
}

module.exports = new MemberApplicationsRepository();
