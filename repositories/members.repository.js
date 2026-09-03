const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');

class MembersRepository extends BaseRepository {
  constructor() {
    super('members', 'id');
  }

  async findActiveById(id, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM members WHERE id = ? AND deleted_at IS NULL LIMIT 1', [id]);
    return rows[0] || null;
  }

  async findByUserId(userId, clubId, conn = pool) {
    const [rows] = await conn.query(
      'SELECT * FROM members WHERE user_id = ? AND club_id = ? AND deleted_at IS NULL LIMIT 1',
      [userId, clubId]
    );
    return rows[0] || null;
  }

  async rutExists(rut, clubId, excludeMemberId = null, conn = pool) {
    const sql = excludeMemberId
      ? 'SELECT id FROM members WHERE rut = ? AND club_id = ? AND id != ? AND deleted_at IS NULL LIMIT 1'
      : 'SELECT id FROM members WHERE rut = ? AND club_id = ? AND deleted_at IS NULL LIMIT 1';
    const params = excludeMemberId ? [rut, clubId, excludeMemberId] : [rut, clubId];
    const [rows] = await conn.query(sql, params);
    return rows.length > 0;
  }

  async createMember(data, conn = pool) {
    const [result] = await conn.query(
      `INSERT INTO members
        (uuid, club_id, first_name, middle_name, last_name, second_last_name, email, phone, rut, birth_date, user_id, status, created_by)
       VALUES (UUID(), :clubId, :firstName, :middleName, :lastName, :secondLastName, :email, :phone, :rut, :birthDate, :userId, :status, :createdBy)`,
      data
    );
    return result.insertId;
  }

  async softDelete(id, conn = pool) {
    await conn.query('UPDATE members SET deleted_at = NOW() WHERE id = ?', [id]);
  }

  /**
   * Filtros combinables: `search` (nombre/email/rut), `status`, `groupId` (miembros de ESE
   * grupo), `linked` ('yes'/'no', si tienen cuenta de usuario vinculada) y `memberIds`
   * (whitelist explícita — la usa members.service.js cuando el actor solo tiene
   * VIEW_MEMBERS_SCOPED; si viene un arreglo VACÍO, el llamador debe evitar llamar acá y
   * devolver una página vacía directamente, sin query).
   */
  async paginateByClub(clubId, { limit, offset, sortBy, sortOrder, search, status, groupId, linked, memberIds }) {
    const params = [clubId];
    const where = ['m.club_id = ?', 'm.deleted_at IS NULL'];
    const joins = [];

    if (status) {
      where.push('m.status = ?');
      params.push(status);
    }
    if (search) {
      where.push(
        '(m.first_name LIKE ? OR m.middle_name LIKE ? OR m.last_name LIKE ? OR m.second_last_name LIKE ? OR m.email LIKE ? OR m.rut LIKE ?)'
      );
      params.push(...Array(6).fill(`%${search}%`));
    }
    if (groupId) {
      joins.push('INNER JOIN member_group_members mgm_f ON mgm_f.member_id = m.id AND mgm_f.group_id = ?');
      params.push(groupId);
    }
    if (linked === 'yes') where.push('m.user_id IS NOT NULL');
    if (linked === 'no') where.push('m.user_id IS NULL');
    if (memberIds) {
      if (!memberIds.length) return { rows: [], total: 0 };
      where.push('m.id IN (?)');
      params.push(memberIds);
    }

    const joinSql = joins.join(' ');
    const whereSql = where.join(' AND ');

    const [rows] = await pool.query(
      `SELECT m.* FROM members m ${joinSql} WHERE ${whereSql}
       ORDER BY m.${sortBy} ${sortOrder} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM members m ${joinSql} WHERE ${whereSql}`, params);
    return { rows, total: countRows[0].total };
  }

  /** Lista liviana `{id, ...}` para pickers (scope de rol, selector de grupo) — sin paginar. */
  async findOptions(clubId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT id, first_name, middle_name, last_name, second_last_name FROM members
       WHERE club_id = ? AND deleted_at IS NULL ORDER BY first_name ASC, last_name ASC`,
      [clubId]
    );
    return rows;
  }

  async findByIds(ids, clubId, conn = pool) {
    if (!ids.length) return [];
    const [rows] = await conn.query('SELECT id FROM members WHERE id IN (?) AND club_id = ? AND deleted_at IS NULL', [
      ids,
      clubId,
    ]);
    return rows;
  }

  /**
   * Miembros accesibles para un usuario que NO tiene VIEW_MEMBERS (solo VIEW_MEMBERS_SCOPED):
   * unión de miembros vinculados directamente a alguno de sus roles en el club + miembros que
   * pertenecen a algún grupo vinculado a alguno de sus roles. Una sola query (UNION), evita
   * N+1 y evita traer roles/scopes a JS solo para volver a consultar.
   */
  async findAccessibleMemberIds(userId, clubId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT m.id AS id FROM role_member_scope rms
         INNER JOIN user_roles ur ON ur.role_id = rms.role_id
         INNER JOIN members m ON m.id = rms.member_id AND m.deleted_at IS NULL
         WHERE ur.user_id = ? AND ur.club_id = ?
       UNION
       SELECT m.id AS id FROM role_member_group_scope rmgs
         INNER JOIN user_roles ur ON ur.role_id = rmgs.role_id
         INNER JOIN member_group_members mgm ON mgm.group_id = rmgs.group_id
         INNER JOIN members m ON m.id = mgm.member_id AND m.deleted_at IS NULL
         WHERE ur.user_id = ? AND ur.club_id = ?`,
      [userId, clubId, userId, clubId]
    );
    return rows.map((r) => r.id);
  }

  // --- Grupos de un miembro / de varios miembros (batch, evita N+1 en listados) ---

  async getGroupsForMember(memberId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT g.id, g.name, g.color FROM member_group_members mgm
       INNER JOIN member_groups g ON g.id = mgm.group_id WHERE mgm.member_id = ? ORDER BY g.name ASC`,
      [memberId]
    );
    return rows;
  }

  async getGroupsForMembers(memberIds, conn = pool) {
    if (!memberIds.length) return {};
    const [rows] = await conn.query(
      `SELECT mgm.member_id, g.id, g.name, g.color FROM member_group_members mgm
       INNER JOIN member_groups g ON g.id = mgm.group_id WHERE mgm.member_id IN (?)`,
      [memberIds]
    );
    const byMember = {};
    for (const row of rows) {
      (byMember[row.member_id] ??= []).push({ id: row.id, name: row.name, color: row.color });
    }
    return byMember;
  }

  async setGroups(memberId, groupIds, conn = pool) {
    await conn.query('DELETE FROM member_group_members WHERE member_id = ?', [memberId]);
    if (!groupIds.length) return;
    const values = groupIds.map((groupId) => [groupId, memberId]);
    await conn.query('INSERT INTO member_group_members (group_id, member_id) VALUES ?', [values]);
  }

  // --- Valores de campos personalizados ---

  async getFieldValues(memberId, conn = pool) {
    const [rows] = await conn.query('SELECT field_id, value FROM member_field_values WHERE member_id = ?', [memberId]);
    return rows;
  }

  async getFieldValuesForMembers(memberIds, conn = pool) {
    if (!memberIds.length) return {};
    const [rows] = await conn.query('SELECT member_id, field_id, value FROM member_field_values WHERE member_id IN (?)', [
      memberIds,
    ]);
    const byMember = {};
    for (const row of rows) {
      (byMember[row.member_id] ??= []).push({ field_id: row.field_id, value: row.value });
    }
    return byMember;
  }

  async upsertFieldValues(memberId, entries, conn = pool) {
    const fieldIds = Object.keys(entries);
    if (!fieldIds.length) return;
    const values = fieldIds.map((fieldId) => [memberId, Number(fieldId), entries[fieldId]]);
    await conn.query(
      `INSERT INTO member_field_values (member_id, field_id, value) VALUES ?
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      [values]
    );
  }

  async countByClub(clubId, conn = pool) {
    const [rows] = await conn.query('SELECT COUNT(*) AS total FROM members WHERE club_id = ? AND deleted_at IS NULL', [
      clubId,
    ]);
    return rows[0].total;
  }

  async countByClubAndStatus(clubId, status, conn = pool) {
    const [rows] = await conn.query(
      'SELECT COUNT(*) AS total FROM members WHERE club_id = ? AND status = ? AND deleted_at IS NULL',
      [clubId, status]
    );
    return rows[0].total;
  }
}

module.exports = new MembersRepository();
