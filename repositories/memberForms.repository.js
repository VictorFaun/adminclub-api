const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');

/**
 * Fichas del club (ver sql/072): cada una es una selección ordenada de campos del catálogo
 * (`member_form_fields`) y se asigna a los miembros que deben responderla (`member_form_members`).
 */
class MemberFormsRepository extends BaseRepository {
  constructor() {
    super('member_forms', 'id');
  }

  async findByClub(clubId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT f.*,
              (SELECT COUNT(*) FROM member_form_members fm INNER JOIN members m ON m.id = fm.member_id
                WHERE fm.form_id = f.id AND m.deleted_at IS NULL) AS member_count
       FROM member_forms f WHERE f.club_id = ? ORDER BY f.sort_order ASC, f.id ASC`,
      [clubId]
    );
    return rows;
  }

  async findInClub(clubId, id, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM member_forms WHERE id = ? AND club_id = ? LIMIT 1', [id, clubId]);
    return rows[0] || null;
  }

  /** Solo las del club (descarta ids ajenos), en el orden de las fichas. */
  async findByIds(clubId, ids, conn = pool) {
    if (!ids.length) return [];
    const [rows] = await conn.query('SELECT * FROM member_forms WHERE club_id = ? AND id IN (?) ORDER BY sort_order ASC, id ASC', [clubId, ids]);
    return rows;
  }

  async findDefaultIds(clubId, conn = pool) {
    const [rows] = await conn.query('SELECT id FROM member_forms WHERE club_id = ? AND is_default = 1 ORDER BY sort_order ASC, id ASC', [clubId]);
    return rows.map((r) => r.id);
  }

  async findByName(clubId, name, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM member_forms WHERE club_id = ? AND name = ? LIMIT 1', [clubId, name]);
    return rows[0] || null;
  }

  async nextSortOrder(clubId, conn = pool) {
    const [[row]] = await conn.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM member_forms WHERE club_id = ?', [clubId]);
    return row.next;
  }

  async createForm({ clubId, name, description = null, isDefault = 0, sortOrder }, conn = pool) {
    const [result] = await conn.query(
      'INSERT INTO member_forms (uuid, club_id, name, description, is_default, sort_order) VALUES (UUID(), ?, ?, ?, ?, ?)',
      [clubId, name, description, isDefault, sortOrder]
    );
    return result.insertId;
  }

  async deleteForm(clubId, id, conn = pool) {
    const [result] = await conn.query('DELETE FROM member_forms WHERE id = ? AND club_id = ?', [id, clubId]);
    return result.affectedRows > 0;
  }

  // ------------------------------------------------------------------ campos de cada ficha

  /** `{ formId: [fieldId, ...] }` en el orden de cada ficha. */
  async fieldIdsByForm(clubId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT ff.form_id, ff.field_id FROM member_form_fields ff INNER JOIN member_forms f ON f.id = ff.form_id
       WHERE f.club_id = ? ORDER BY ff.form_id, ff.sort_order ASC, ff.field_id ASC`,
      [clubId]
    );
    const map = {};
    for (const r of rows) (map[r.form_id] = map[r.form_id] || []).push(r.field_id);
    return map;
  }

  /** Reemplaza los campos de la ficha (y su orden). */
  async setFields(formId, fieldIds, conn = pool) {
    await conn.query('DELETE FROM member_form_fields WHERE form_id = ?', [formId]);
    if (!fieldIds.length) return;
    await conn.query('INSERT INTO member_form_fields (form_id, field_id, sort_order) VALUES ?', [fieldIds.map((id, i) => [formId, id, i + 1])]);
  }

  /** Agrega un campo al final de la ficha (si ya estaba, no hace nada). */
  async appendField(formId, fieldId, conn = pool) {
    await conn.query(
      `INSERT IGNORE INTO member_form_fields (form_id, field_id, sort_order)
       SELECT ?, ?, COALESCE(MAX(sort_order), 0) + 1 FROM member_form_fields WHERE form_id = ?`,
      [formId, fieldId, formId]
    );
  }

  /** Campos (de `fieldIds`) que no están en ninguna ficha salvo, opcionalmente, `exceptFormId`. */
  async fieldsOnlyIn(fieldIds, exceptFormId, conn = pool) {
    if (!fieldIds.length) return [];
    const [rows] = await conn.query(
      `SELECT mf.id, mf.label FROM member_fields mf
       WHERE mf.id IN (?) AND NOT EXISTS (SELECT 1 FROM member_form_fields ff WHERE ff.field_id = mf.id AND ff.form_id <> ?)`,
      [fieldIds, exceptFormId]
    );
    return rows;
  }

  // ------------------------------------------------------------------ asignación a miembros

  /** `{ memberId: [formId, ...] }`. */
  async formIdsByMembers(memberIds, conn = pool) {
    if (!memberIds.length) return {};
    const [rows] = await conn.query(
      `SELECT fm.member_id, fm.form_id FROM member_form_members fm INNER JOIN member_forms f ON f.id = fm.form_id
       WHERE fm.member_id IN (?) ORDER BY f.sort_order ASC, f.id ASC`,
      [memberIds]
    );
    const map = {};
    for (const r of rows) (map[r.member_id] = map[r.member_id] || []).push(r.form_id);
    return map;
  }

  async formIdsForMember(memberId, conn = pool) {
    return (await this.formIdsByMembers([memberId], conn))[memberId] || [];
  }

  /** Reemplaza las fichas asignadas al miembro. */
  async setMemberForms(memberId, formIds, conn = pool) {
    await conn.query('DELETE FROM member_form_members WHERE member_id = ?', [memberId]);
    if (formIds.length) await conn.query('INSERT INTO member_form_members (form_id, member_id) VALUES ?', [formIds.map((id) => [id, memberId])]);
  }

  /** Agrega fichas al miembro (conserva las que ya tenía). */
  async addMemberForms(memberId, formIds, conn = pool) {
    if (formIds.length) await conn.query('INSERT IGNORE INTO member_form_members (form_id, member_id) VALUES ?', [formIds.map((id) => [id, memberId])]);
  }

  /** Asigna la ficha a varios miembros. Devuelve cuántas asignaciones nuevas hubo. */
  async assign(formId, memberIds, conn = pool) {
    if (!memberIds.length) return 0;
    const [result] = await conn.query('INSERT IGNORE INTO member_form_members (form_id, member_id) VALUES ?', [memberIds.map((id) => [formId, id])]);
    return result.affectedRows;
  }

  async unassign(formId, memberIds, conn = pool) {
    if (!memberIds.length) return 0;
    const [result] = await conn.query('DELETE FROM member_form_members WHERE form_id = ? AND member_id IN (?)', [formId, memberIds]);
    return result.affectedRows;
  }

  /** Miembros (no eliminados) que tienen asignada la ficha. */
  async findMembers(formId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT m.id FROM member_form_members fm INNER JOIN members m ON m.id = fm.member_id
       WHERE fm.form_id = ? AND m.deleted_at IS NULL`,
      [formId]
    );
    return rows.map((r) => r.id);
  }
}

module.exports = new MemberFormsRepository();
