const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');

/** Solicitudes de inscripción enviadas desde el formulario público (ver sql/051_member_applications.sql). */
class MemberApplicationsRepository extends BaseRepository {
  constructor() {
    super('member_applications', 'id');
  }

  async create({ clubId, fields, message, groupId = null }, conn = pool) {
    const [result] = await conn.query('INSERT INTO member_applications (uuid, club_id, fields, group_id, message) VALUES (UUID(), ?, ?, ?, ?)', [
      clubId,
      JSON.stringify(fields || {}),
      groupId,
      message,
    ]);
    return result.insertId;
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
      `SELECT ma.*, u.username AS reviewed_by_username, g.name AS group_name
       FROM member_applications ma LEFT JOIN users u ON u.id = ma.reviewed_by
       LEFT JOIN member_groups g ON g.id = ma.group_id
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
