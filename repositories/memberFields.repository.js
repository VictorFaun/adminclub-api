const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');

/** Campos de la ficha de miembro de cada club (todos configurables, ver helpers/memberFieldTypes.js). */
class MemberFieldsRepository extends BaseRepository {
  constructor() {
    super('member_fields', 'id');
  }

  async findByClub(clubId, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM member_fields WHERE club_id = ? ORDER BY sort_order ASC, id ASC', [clubId]);
    return rows;
  }

  async findByCode(clubId, code, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM member_fields WHERE club_id = ? AND code = ? LIMIT 1', [clubId, code]);
    return rows[0] || null;
  }

  /** Todos los campos con ese uso (uno por ficha, sql/086), en el orden del catálogo. */
  async findAllByRole(clubId, role, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM member_fields WHERE club_id = ? AND role = ? ORDER BY sort_order ASC, id ASC', [clubId, role]);
    return rows;
  }

  async findByRole(clubId, role, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM member_fields WHERE club_id = ? AND role = ? LIMIT 1', [clubId, role]);
    return rows[0] || null;
  }

  async nextSortOrder(clubId, conn = pool) {
    const [[row]] = await conn.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM member_fields WHERE club_id = ?', [clubId]);
    return row.next;
  }

  async createField(data, conn = pool) {
    const [result] = await conn.query(
      `INSERT INTO member_fields (club_id, code, label, field_type, role, options, settings, help_text, is_required, in_public_form, sort_order)
       VALUES (:clubId, :code, :label, :fieldType, :role, :options, :settings, :helpText, :isRequired, :inPublicForm, :sortOrder)`,
      { settings: null, ...data }
    );
    return result.insertId;
  }

  async deleteField(id, clubId, conn = pool) {
    const [result] = await conn.query('DELETE FROM member_fields WHERE id = ? AND club_id = ?', [id, clubId]);
    return result.affectedRows > 0;
  }

  /** Reordena: `ids` en el orden final (los que no vengan conservan su lugar relativo al final). */
  async reorder(clubId, ids, conn = pool) {
    for (let i = 0; i < ids.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await conn.query('UPDATE member_fields SET sort_order = ? WHERE id = ? AND club_id = ?', [i + 1, ids[i], clubId]);
    }
  }

  /** ¿Algún otro miembro del club ya tiene este identificador? (`normalized` en mayúsculas/canon). */
  /** `fieldIds`: un campo o todos los de uso Identificador (pueden estar en varias fichas). */
  async identifierExists(clubId, fieldIds, normalized, excludeMemberId = null, conn = pool) {
    const ids = [].concat(fieldIds);
    if (!ids.length) return false;
    const params = [ids, clubId, normalized];
    let exclude = '';
    if (excludeMemberId) {
      exclude = 'AND m.id <> ?';
      params.push(excludeMemberId);
    }
    const [rows] = await conn.query(
      `SELECT 1 FROM member_field_values v INNER JOIN members m ON m.id = v.member_id
       WHERE v.field_id IN (?) AND m.club_id = ? AND m.deleted_at IS NULL AND UPPER(v.value) = ? ${exclude} LIMIT 1`,
      params
    );
    return rows.length > 0;
  }

  /** Miembro (no eliminado) del club que tiene este identificador (`normalized` en mayúsculas/canon). */
  async findMemberIdByIdentifier(clubId, fieldIds, normalized, conn = pool) {
    const ids = [].concat(fieldIds);
    if (!ids.length) return null;
    const [rows] = await conn.query(
      `SELECT m.id FROM member_field_values v INNER JOIN members m ON m.id = v.member_id
       WHERE v.field_id IN (?) AND m.club_id = ? AND m.deleted_at IS NULL AND UPPER(v.value) = ? LIMIT 1`,
      [ids, clubId, normalized]
    );
    return rows[0]?.id ?? null;
  }
}

module.exports = new MemberFieldsRepository();
