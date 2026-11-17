const { pool } = require('../config/database');

/**
 * Orden en que se miran las fichas de un miembro para cada dato especial repetido (sql/086):
 * `{ role: [formId, ...] }`. Lo usa la vista member_profiles.
 */
class MemberRolePriorityRepository {
  async findByMember(memberId, conn = pool) {
    const [rows] = await conn.query('SELECT role, form_id FROM member_role_priority WHERE member_id = ? ORDER BY role, position', [memberId]);
    const out = {};
    for (const r of rows) (out[r.role] ||= []).push(r.form_id);
    return out;
  }

  /** Reemplaza el orden de los usos indicados (los demás quedan como estaban). */
  async setForMember(memberId, priority, conn = pool) {
    const roles = Object.keys(priority || {}).filter((role) => Array.isArray(priority[role]) && priority[role].length);
    if (!roles.length) return;
    await conn.query('DELETE FROM member_role_priority WHERE member_id = ? AND role IN (?)', [memberId, roles]);
    const rows = roles.flatMap((role) => priority[role].map((formId, i) => [memberId, role, Number(formId), i + 1]));
    await conn.query('INSERT INTO member_role_priority (member_id, role, form_id, position) VALUES ?', [rows]);
  }
}

module.exports = new MemberRolePriorityRepository();
