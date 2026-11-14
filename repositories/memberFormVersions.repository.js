const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');

/**
 * Versiones de las fichas de cada miembro (sql/078): una fila por respuesta de cada ficha. La
 * principal de cada (miembro, ficha) tiene `snapshot` NULL = los datos vigentes del miembro (por
 * defecto la última; se puede elegir otra); las demás guardan la copia congelada. Ver services/memberFormVersions.service.js.
 */
class MemberFormVersionsRepository extends BaseRepository {
  constructor() {
    super('member_form_versions', 'id');
  }

  /** Toda ficha asignada tiene al menos una versión (la vigente): crea la que falte. */
  async ensureForMembers(memberIds, conn = pool) {
    if (!memberIds.length) return;
    await conn.query(
      `INSERT INTO member_form_versions (member_id, form_id, source, created_by)
       SELECT mfm.member_id, mfm.form_id, 'initial', m.created_by
       FROM member_form_members mfm
       INNER JOIN members m ON m.id = mfm.member_id
       WHERE mfm.member_id IN (?)
         AND NOT EXISTS (SELECT 1 FROM member_form_versions v WHERE v.member_id = mfm.member_id AND v.form_id = mfm.form_id)`,
      [memberIds]
    );
  }

  async ensureForForm(formId, conn = pool) {
    await conn.query(
      `INSERT INTO member_form_versions (member_id, form_id, source, created_by)
       SELECT mfm.member_id, mfm.form_id, 'initial', m.created_by
       FROM member_form_members mfm
       INNER JOIN members m ON m.id = mfm.member_id
       WHERE mfm.form_id = ?
         AND NOT EXISTS (SELECT 1 FROM member_form_versions v WHERE v.member_id = mfm.member_id AND v.form_id = mfm.form_id)`,
      [formId]
    );
  }

  /** Versiones del miembro (todas sus fichas), de la más antigua a la más nueva por ficha. */
  async listByMember(memberId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT v.*, u.username AS created_by_username
       FROM member_form_versions v
       LEFT JOIN users u ON u.id = v.created_by
       WHERE v.member_id = ?
       ORDER BY v.form_id ASC, v.id ASC`,
      [memberId]
    );
    return rows;
  }

  async listForForm(memberId, formId, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM member_form_versions WHERE member_id = ? AND form_id = ? ORDER BY id ASC', [memberId, formId]);
    return rows;
  }

  /** Cuántas versiones tiene cada ficha de cada miembro: { memberId: { formId: n } }. */
  async countsByMembers(memberIds, conn = pool) {
    if (!memberIds.length) return {};
    const [rows] = await conn.query('SELECT member_id, form_id, COUNT(*) AS n FROM member_form_versions WHERE member_id IN (?) GROUP BY member_id, form_id', [memberIds]);
    const out = {};
    for (const r of rows) (out[r.member_id] ??= {})[r.form_id] = Number(r.n);
    return out;
  }

  /** La versión principal: la que no tiene copia congelada (sus datos son los vigentes). No es
   * siempre la última: se puede elegir una anterior ("Usar como principal"). */
  async latest(memberId, formId, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM member_form_versions WHERE member_id = ? AND form_id = ? ORDER BY (snapshot IS NULL) DESC, id DESC LIMIT 1', [memberId, formId]);
    return rows[0] || null;
  }

  async create({ memberId, formId, source, createdBy }, conn = pool) {
    const [result] = await conn.query('INSERT INTO member_form_versions (member_id, form_id, source, created_by) VALUES (?, ?, ?, ?)', [memberId, formId, source, createdBy || null]);
    return result.insertId;
  }

  async setSnapshot(id, snapshot, conn = pool) {
    await conn.query('UPDATE member_form_versions SET snapshot = ? WHERE id = ?', [snapshot, id]);
  }

  /** Copias congeladas del miembro (para saber qué imágenes y documentos siguen en uso). */
  async snapshotsOf(memberId, conn = pool) {
    const [rows] = await conn.query('SELECT id, snapshot FROM member_form_versions WHERE member_id = ? AND snapshot IS NOT NULL', [memberId]);
    return rows;
  }
}

module.exports = new MemberFormVersionsRepository();
