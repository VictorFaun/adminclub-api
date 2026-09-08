const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');

/** Mirror de charges.repository.js, adaptado a entrenamientos: sin `amount`/`recurrence` (no hay
 * precio ni mensual/anual, ver training_schedules para el horario semanal). */
class TrainingsRepository extends BaseRepository {
  constructor() {
    super('trainings', 'id');
  }

  async findActiveById(id, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM trainings WHERE id = ? AND deleted_at IS NULL LIMIT 1', [id]);
    return rows[0] || null;
  }

  async findByClub(clubId, { sortBy = 'name', sortOrder = 'ASC' } = {}, conn = pool) {
    const [rows] = await conn.query(
      `SELECT * FROM trainings WHERE club_id = ? AND deleted_at IS NULL AND archived_at IS NULL ORDER BY ${sortBy} ${sortOrder}`,
      [clubId]
    );
    return rows;
  }

  /** Entrenamientos de los que ESTE miembro es responsable (de lo que sea, cualquier grupo) —
   * usado cuando el actor no tiene VIEW_TRAININGS pero su ficha vinculada figura como responsable
   * de al menos uno (ver trainings.service.js#listForClub/actorHasAnyResponsibleTraining). */
  async findByClubResponsibleMember(clubId, memberId, { sortBy = 'name', sortOrder = 'ASC' } = {}, conn = pool) {
    const [rows] = await conn.query(
      `SELECT DISTINCT t.* FROM trainings t
       INNER JOIN training_responsible_members trm ON trm.training_id = t.id
       WHERE t.club_id = ? AND trm.member_id = ? AND t.deleted_at IS NULL AND t.archived_at IS NULL ORDER BY t.${sortBy} ${sortOrder}`,
      [clubId, memberId]
    );
    return rows;
  }

  async existsResponsibleMember(clubId, memberId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT 1 FROM trainings t
       INNER JOIN training_responsible_members trm ON trm.training_id = t.id
       WHERE t.club_id = ? AND trm.member_id = ? AND t.deleted_at IS NULL AND t.archived_at IS NULL LIMIT 1`,
      [clubId, memberId]
    );
    return rows.length > 0;
  }

  async findArchivedByClub(clubId, { sortBy = 'archived_at', sortOrder = 'DESC' } = {}, conn = pool) {
    const [rows] = await conn.query(
      `SELECT * FROM trainings WHERE club_id = ? AND deleted_at IS NULL AND archived_at IS NOT NULL ORDER BY ${sortBy} ${sortOrder}`,
      [clubId]
    );
    return rows;
  }

  async findActiveByClubForGeneration(clubId, conn = pool) {
    const [rows] = await conn.query(
      "SELECT * FROM trainings WHERE club_id = ? AND status = 'active' AND deleted_at IS NULL AND archived_at IS NULL",
      [clubId]
    );
    return rows;
  }

  async findAllActiveForGeneration(conn = pool) {
    const [rows] = await conn.query("SELECT * FROM trainings WHERE status = 'active' AND deleted_at IS NULL AND archived_at IS NULL");
    return rows;
  }

  async archive(id, conn = pool) {
    await conn.query('UPDATE trainings SET archived_at = NOW() WHERE id = ?', [id]);
  }

  async restore(id, conn = pool) {
    await conn.query('UPDATE trainings SET archived_at = NULL WHERE id = ?', [id]);
  }

  async createTraining(data, conn = pool) {
    const [result] = await conn.query(
      `INSERT INTO trainings (uuid, club_id, name, description, color, start_date, end_date, status, created_by)
       VALUES (UUID(), :clubId, :name, :description, :color, :startDate, :endDate, :status, :createdBy)`,
      data
    );
    return result.insertId;
  }

  async softDelete(id, conn = pool) {
    await conn.query('UPDATE trainings SET deleted_at = NOW() WHERE id = ?', [id]);
  }

  // --- Horario semanal (días + hora) ---

  async getSchedules(trainingId, conn = pool) {
    const [rows] = await conn.query(
      'SELECT id, day_of_week, start_time, end_time FROM training_schedules WHERE training_id = ? ORDER BY day_of_week ASC, start_time ASC',
      [trainingId]
    );
    return rows.map((r) => ({ dayOfWeek: r.day_of_week, startTime: r.start_time, endTime: r.end_time }));
  }

  /** `schedules`: `[{dayOfWeek, startTime, endTime}]`. */
  async setSchedules(trainingId, schedules, conn = pool) {
    await conn.query('DELETE FROM training_schedules WHERE training_id = ?', [trainingId]);
    if (schedules.length) {
      await conn.query('INSERT INTO training_schedules (training_id, day_of_week, start_time, end_time) VALUES ?', [
        schedules.map((s) => [trainingId, s.dayOfWeek, s.startTime, s.endTime ?? null]),
      ]);
    }
  }

  // --- Targets (miembros / grupos / exclusiones) — mirror de charges.repository.js, sin monto ---

  async getTargetMembers(trainingId, conn = pool) {
    const [rows] = await conn.query('SELECT member_id FROM training_target_members WHERE training_id = ?', [trainingId]);
    return rows.map((r) => r.member_id);
  }

  async getTargetGroups(trainingId, conn = pool) {
    const [rows] = await conn.query('SELECT group_id FROM training_target_groups WHERE training_id = ?', [trainingId]);
    return rows.map((r) => r.group_id);
  }

  async getExclusionMemberIds(trainingId, conn = pool) {
    const [rows] = await conn.query('SELECT member_id FROM training_target_exclusions WHERE training_id = ?', [trainingId]);
    return rows.map((r) => r.member_id);
  }

  async setTargetMembers(trainingId, memberIds, conn = pool) {
    await conn.query('DELETE FROM training_target_members WHERE training_id = ?', [trainingId]);
    if (memberIds.length) {
      await conn.query('INSERT INTO training_target_members (training_id, member_id) VALUES ?', [memberIds.map((id) => [trainingId, id])]);
    }
  }

  async setTargetGroups(trainingId, groupIds, conn = pool) {
    await conn.query('DELETE FROM training_target_groups WHERE training_id = ?', [trainingId]);
    if (groupIds.length) {
      await conn.query('INSERT INTO training_target_groups (training_id, group_id) VALUES ?', [groupIds.map((id) => [trainingId, id])]);
    }
  }

  async setExclusions(trainingId, memberIds, conn = pool) {
    await conn.query('DELETE FROM training_target_exclusions WHERE training_id = ?', [trainingId]);
    if (memberIds.length) {
      await conn.query('INSERT INTO training_target_exclusions (training_id, member_id) VALUES ?', [memberIds.map((id) => [trainingId, id])]);
    }
  }

  /** Miembros ACTIVOS a quienes aplica hoy este entrenamiento: unión de miembros puntuales +
   * miembros de los grupos apuntados, menos las exclusiones — mirror de
   * charges.repository.js#expandTargetMemberIds. */
  async expandTargetMemberIds(trainingId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT DISTINCT m.id FROM members m
       WHERE m.deleted_at IS NULL AND m.id IN (
         SELECT member_id FROM training_target_members WHERE training_id = ?
         UNION
         SELECT mgm.member_id FROM training_target_groups ttg
           INNER JOIN member_group_members mgm ON mgm.group_id = ttg.group_id
           WHERE ttg.training_id = ?
       )
       AND m.id NOT IN (SELECT member_id FROM training_target_exclusions WHERE training_id = ?)`,
      [trainingId, trainingId, trainingId]
    );
    return rows.map((r) => r.id);
  }

  // --- Responsables (entrenadores) — mirror EXACTO de charges.repository.js ---

  async getResponsibleMembers(trainingId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT trm.member_id, trm.group_id, trm.position,
              NULLIF(CONCAT_WS(' ', m.first_name, m.last_name), '') AS member_name,
              mg.name AS group_name
       FROM training_responsible_members trm
       INNER JOIN members m ON m.id = trm.member_id
       LEFT JOIN member_groups mg ON mg.id = trm.group_id
       WHERE trm.training_id = ? ORDER BY trm.position ASC`,
      [trainingId]
    );
    return rows.map((r) => ({ memberId: r.member_id, memberName: r.member_name, groupId: r.group_id, groupName: r.group_name, position: r.position }));
  }

  async setResponsibleMembers(trainingId, targets, conn = pool) {
    await conn.query('DELETE FROM training_responsible_members WHERE training_id = ?', [trainingId]);
    if (targets.length) {
      await conn.query('INSERT INTO training_responsible_members (training_id, member_id, group_id, position) VALUES ?', [
        targets.map((t, i) => [trainingId, t.memberId, t.groupId ?? null, i]),
      ]);
    }
  }

  async isAnyResponsible(trainingId, memberId, conn = pool) {
    const [rows] = await conn.query('SELECT 1 FROM training_responsible_members WHERE training_id = ? AND member_id = ? LIMIT 1', [
      trainingId,
      memberId,
    ]);
    return rows.length > 0;
  }

  /** Responsable efectivo por miembro para este entrenamiento — mismo algoritmo exacto que
   * charges.repository.js#resolveResponsibles (ver ese comentario para el detalle completo). */
  async resolveResponsibles(trainingId, memberIds, conn = pool) {
    const result = new Map(memberIds.map((id) => [id, null]));
    if (!memberIds.length) return result;

    const [wildcardRows] = await conn.query(
      `SELECT trm.member_id, NULLIF(CONCAT_WS(' ', m.first_name, m.last_name), '') AS member_name
       FROM training_responsible_members trm INNER JOIN members m ON m.id = trm.member_id
       WHERE trm.training_id = ? AND trm.group_id IS NULL ORDER BY trm.position ASC LIMIT 1`,
      [trainingId]
    );
    if (wildcardRows.length) {
      const fallback = { memberId: wildcardRows[0].member_id, memberName: wildcardRows[0].member_name };
      for (const id of memberIds) result.set(id, fallback);
    }

    const [groupRows] = await conn.query(
      `SELECT mgm.member_id, trm.member_id AS responsible_member_id,
              NULLIF(CONCAT_WS(' ', m.first_name, m.last_name), '') AS responsible_member_name
       FROM training_responsible_members trm
       INNER JOIN member_group_members mgm ON mgm.group_id = trm.group_id
       INNER JOIN members m ON m.id = trm.member_id
       WHERE trm.training_id = ? AND trm.group_id IS NOT NULL AND mgm.member_id IN (?)
       ORDER BY trm.position ASC`,
      [trainingId, memberIds]
    );
    const seen = new Set();
    for (const row of groupRows) {
      if (seen.has(row.member_id)) continue;
      seen.add(row.member_id);
      result.set(row.member_id, { memberId: row.responsible_member_id, memberName: row.responsible_member_name });
    }

    return result;
  }
}

module.exports = new TrainingsRepository();
