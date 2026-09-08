const crypto = require('crypto');
const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');

/** Mirror de chargeInstances.repository.js + el `findAccessibleMemberIds` de
 * payments.repository.js, colapsados en una sola tabla (`training_attendances` = "sesión" +
 * "estado de asistencia" de un miembro, no hay tabla de sesiones ni de pagos aparte — una
 * marca de asistencia es un hecho único, no admite "abono parcial"). */
class TrainingAttendancesRepository extends BaseRepository {
  constructor() {
    super('training_attendances', 'id');
  }

  async findActiveById(id, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM training_attendances WHERE id = ? LIMIT 1', [id]);
    return rows[0] || null;
  }

  async findByTrainingMemberDate(trainingId, memberId, sessionDate, conn = pool) {
    const [rows] = await conn.query(
      'SELECT * FROM training_attendances WHERE training_id = ? AND member_id = ? AND session_date = ? LIMIT 1',
      [trainingId, memberId, sessionDate]
    );
    return rows[0] || null;
  }

  async findForTrainingAndMembers(trainingId, memberIds, conn = pool) {
    if (!memberIds.length) return [];
    const [rows] = await conn.query('SELECT * FROM training_attendances WHERE training_id = ? AND member_id IN (?)', [trainingId, memberIds]);
    return rows;
  }

  /** Mismo mirror de chargeInstances.repository.js#findForMember — ya NO trae responsable
   * pegado con JOIN (con varios entrenadores por grupo no hay uno solo que resolver acá, y a
   * diferencia de Pagos, marcar asistencia no necesita saber "a quién se le paga"). */
  async findForMember(memberId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT ta.*, t.name AS training_name, t.color AS training_color
       FROM training_attendances ta
       INNER JOIN trainings t ON t.id = ta.training_id
       WHERE ta.member_id = ? AND t.deleted_at IS NULL
       ORDER BY ta.session_date DESC`,
      [memberId]
    );
    return rows;
  }

  /** UUID generado en JS (no MySQL `UUID()`) — mismo motivo que
   * chargeInstances.repository.js#bulkInsertIgnore (el bulk `VALUES ?` no admite mezclar una
   * función SQL por fila). Idempotente vía `INSERT IGNORE` sobre
   * `UNIQUE(training_id,member_id,session_date)`. */
  async bulkInsertIgnore(rows, conn = pool) {
    if (!rows.length) return 0;
    const values = rows.map((r) => [crypto.randomUUID(), r.trainingId, r.memberId, r.sessionDate]);
    const [result] = await conn.query('INSERT IGNORE INTO training_attendances (uuid, training_id, member_id, session_date) VALUES ?', [values]);
    return result.affectedRows;
  }

  async markAttendance(id, { status, exemptType, exemptReason, markedBy }, conn = pool) {
    await conn.query(
      'UPDATE training_attendances SET status = ?, exempt_type = ?, exempt_reason = ?, marked_by = ?, marked_at = NOW() WHERE id = ?',
      [status, status === 'exempt' ? exemptType || 'frozen' : null, status === 'exempt' ? exemptReason || null : null, markedBy, id]
    );
  }

  /** A qué miembros da acceso de asistencia un rol con VIEW_ATTENDANCE_SCOPED — mirror EXACTO
   * de payments.repository.js#findAccessibleMemberIds, tablas paralelas
   * (role_attendance_scope/role_attendance_group_scope). */
  async findAccessibleMemberIds(userId, clubId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT m.id AS id FROM role_attendance_scope ras
         INNER JOIN user_roles ur ON ur.role_id = ras.role_id
         INNER JOIN members m ON m.id = ras.member_id AND m.deleted_at IS NULL
         WHERE ur.user_id = ? AND ur.club_id = ?
       UNION
       SELECT m.id AS id FROM role_attendance_group_scope rags
         INNER JOIN user_roles ur ON ur.role_id = rags.role_id
         INNER JOIN member_group_members mgm ON mgm.group_id = rags.group_id
         INNER JOIN members m ON m.id = mgm.member_id AND m.deleted_at IS NULL
         WHERE ur.user_id = ? AND ur.club_id = ?`,
      [userId, clubId, userId, clubId]
    );
    return rows.map((r) => r.id);
  }
}

module.exports = new TrainingAttendancesRepository();
