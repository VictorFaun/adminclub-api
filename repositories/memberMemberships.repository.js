const { pool } = require('../config/database');
const { toDateOnly } = require('../helpers/membership');

const toDto = (r) => ({ id: r.id, startedOn: toDateOnly(r.started_on), endedOn: toDateOnly(r.ended_on) });

/** Historial de pertenencia al club (ver sql/049_member_memberships.sql). */
class MemberMembershipsRepository {
  /** Períodos de un miembro, del más antiguo al más nuevo. */
  async findByMember(memberId, conn = pool) {
    const [rows] = await conn.query(
      'SELECT id, started_on, ended_on FROM member_memberships WHERE member_id = ? ORDER BY COALESCE(started_on, "0000-01-01") ASC, id ASC',
      [memberId]
    );
    return rows.map(toDto);
  }

  /** `Map<memberId, [{startedOn, endedOn}]>` para varios miembros a la vez. */
  async findByMembers(memberIds, conn = pool) {
    const map = new Map(memberIds.map((id) => [id, []]));
    if (!memberIds.length) return map;
    const [rows] = await conn.query(
      'SELECT id, member_id, started_on, ended_on FROM member_memberships WHERE member_id IN (?) ORDER BY COALESCE(started_on, "0000-01-01") ASC, id ASC',
      [memberIds]
    );
    for (const r of rows) map.get(r.member_id)?.push(toDto(r));
    return map;
  }

  async create(memberId, startedOn, conn = pool) {
    const [result] = await conn.query('INSERT INTO member_memberships (member_id, started_on, ended_on) VALUES (?, ?, NULL)', [memberId, startedOn]);
    return result.insertId;
  }

  async setEnd(id, endedOn, conn = pool) {
    await conn.query('UPDATE member_memberships SET ended_on = ? WHERE id = ?', [endedOn, id]);
  }

  async setStart(id, startedOn, conn = pool) {
    await conn.query('UPDATE member_memberships SET started_on = ? WHERE id = ?', [startedOn, id]);
  }
}

module.exports = new MemberMembershipsRepository();
