const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');

/** Consentimientos y documentos del formulario público de inscripción (ver sql/068). */
class PublicFormConsentsRepository extends BaseRepository {
  constructor() {
    super('public_form_consents', 'id');
  }

  async listByClub(clubId, { activeOnly = false } = {}, conn = pool) {
    const [rows] = await conn.query(
      `SELECT * FROM public_form_consents WHERE club_id = ?${activeOnly ? ' AND is_active = 1' : ''} ORDER BY sort_order ASC, id ASC`,
      [clubId]
    );
    return rows;
  }

  async findInClub(clubId, id, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM public_form_consents WHERE club_id = ? AND id = ? LIMIT 1', [clubId, id]);
    return rows[0] || null;
  }

  async create({ clubId, title, body, checkboxLabel, isRequired, isActive }, conn = pool) {
    const [[{ next }]] = await conn.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM public_form_consents WHERE club_id = ?', [clubId]);
    const [result] = await conn.query(
      'INSERT INTO public_form_consents (club_id, title, body, checkbox_label, is_required, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [clubId, title, body, checkboxLabel, isRequired ? 1 : 0, isActive ? 1 : 0, next]
    );
    return result.insertId;
  }

  async update(id, { title, body, checkboxLabel, isRequired, isActive }, conn = pool) {
    await conn.query('UPDATE public_form_consents SET title = ?, body = ?, checkbox_label = ?, is_required = ?, is_active = ? WHERE id = ?', [
      title,
      body,
      checkboxLabel,
      isRequired ? 1 : 0,
      isActive ? 1 : 0,
      id,
    ]);
  }

  async setOrder(clubId, ids, conn = pool) {
    for (let i = 0; i < ids.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await conn.query('UPDATE public_form_consents SET sort_order = ? WHERE id = ? AND club_id = ?', [i + 1, ids[i], clubId]);
    }
  }

  // ---------------------------------------------------------------- archivos

  async findFiles(consentIds, conn = pool) {
    if (!consentIds.length) return [];
    const [rows] = await conn.query('SELECT * FROM public_form_consent_files WHERE consent_id IN (?) ORDER BY id', [consentIds]);
    return rows;
  }

  async addFile(consentId, { name, filePath, mimeType, sizeBytes }, conn = pool) {
    const [result] = await conn.query(
      'INSERT INTO public_form_consent_files (consent_id, name, file_path, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?)',
      [consentId, name, filePath, mimeType, sizeBytes]
    );
    return result.insertId;
  }

  async deleteFile(fileId, conn = pool) {
    await conn.query('DELETE FROM public_form_consent_files WHERE id = ?', [fileId]);
  }

  // ---------------------------------------------------------------- lo aceptado en cada solicitud

  async addApplicationConsents(applicationId, records, conn = pool) {
    for (const r of records) {
      // eslint-disable-next-line no-await-in-loop
      await conn.query(
        `INSERT INTO member_application_consents
          (application_id, consent_id, title, body, checkbox_label, file_names, is_required, accepted, accepted_at, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          applicationId,
          r.consentId,
          r.title,
          r.body,
          r.checkboxLabel,
          JSON.stringify(r.fileNames || []),
          r.isRequired ? 1 : 0,
          r.accepted ? 1 : 0,
          r.accepted ? new Date() : null,
          r.ipAddress || null,
          r.userAgent ? String(r.userAgent).slice(0, 255) : null,
        ]
      );
    }
  }

  async findApplicationConsents(applicationIds, conn = pool) {
    if (!applicationIds.length) return [];
    const [rows] = await conn.query('SELECT * FROM member_application_consents WHERE application_id IN (?) ORDER BY id', [applicationIds]);
    return rows;
  }
}

module.exports = new PublicFormConsentsRepository();
