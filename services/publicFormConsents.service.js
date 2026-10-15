const publicFormConsentsRepository = require('../repositories/publicFormConsents.repository');
const auditRepository = require('../repositories/audit.repository');
const AppError = require('../helpers/AppError');
const { resolvePrivatePath, deletePrivateFile } = require('../middlewares/privateUpload.middleware');

/** Carpeta privada de los PDFs de los consentimientos (ver routes/memberApplications.routes.js). */
const CONSENT_FILES_SUBDIR = 'consent-files';
const MAX_FILES_PER_CONSENT = 10;

/**
 * Consentimientos y documentos del formulario público de inscripción: el club agrega los que
 * quiera (uso de imagen, términos y condiciones, protocolo de ingreso, reglamento...), cada uno
 * con su texto, el texto de la casilla y PDFs adjuntos. Los activos aparecen al final del
 * formulario; los obligatorios hay que marcarlos para poder enviar. Lo aceptado se guarda como
 * copia en la solicitud (memberApplications.service.js#submit).
 */
class PublicFormConsentsService {
  _fileDto(f) {
    return { id: f.id, name: f.name, mimeType: f.mime_type, sizeBytes: f.size_bytes };
  }

  async _withFiles(rows) {
    const files = await publicFormConsentsRepository.findFiles(rows.map((r) => r.id));
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      checkboxLabel: r.checkbox_label,
      isRequired: !!r.is_required,
      isActive: !!r.is_active,
      files: files.filter((f) => f.consent_id === r.id).map((f) => this._fileDto(f)),
    }));
  }

  // ------------------------------------------------------------------ administración

  async list(clubId) {
    return this._withFiles(await publicFormConsentsRepository.listByClub(clubId));
  }

  _normalize(data) {
    const title = String(data.title ?? '').trim();
    const checkboxLabel = String(data.checkboxLabel ?? '').trim();
    if (!title) throw AppError.badRequest('El título es obligatorio.');
    if (!checkboxLabel) throw AppError.badRequest('El texto de la casilla es obligatorio.');
    return {
      title: title.slice(0, 150),
      body: String(data.body ?? '').trim().slice(0, 20000) || null,
      checkboxLabel: checkboxLabel.slice(0, 300),
      isRequired: data.isRequired !== false,
      isActive: data.isActive !== false,
    };
  }

  async _get(clubId, id) {
    const row = await publicFormConsentsRepository.findInClub(clubId, id);
    if (!row) throw AppError.notFound('Consentimiento no encontrado.');
    return row;
  }

  async _dto(clubId, id) {
    return (await this._withFiles([await this._get(clubId, id)]))[0];
  }

  async create(clubId, data, actorId) {
    const fields = this._normalize(data);
    const id = await publicFormConsentsRepository.create({ clubId, ...fields });
    await auditRepository.logAction({ userId: actorId, clubId, action: 'PUBLIC_FORM_CONSENT_CREATED', entityType: 'public_form_consent', entityId: id, changes: { title: fields.title } });
    return this._dto(clubId, id);
  }

  async update(clubId, id, data, actorId) {
    const before = await this._get(clubId, id);
    // Un cambio parcial (p. ej. solo el interruptor de activo) conserva el resto tal cual.
    const merged = {
      title: data.title ?? before.title,
      body: data.body !== undefined ? data.body : before.body,
      checkboxLabel: data.checkboxLabel ?? before.checkbox_label,
      isRequired: data.isRequired !== undefined ? data.isRequired : !!before.is_required,
      isActive: data.isActive !== undefined ? data.isActive : !!before.is_active,
    };
    const fields = this._normalize(merged);
    await publicFormConsentsRepository.update(id, fields);
    await auditRepository.logAction({ userId: actorId, clubId, action: 'PUBLIC_FORM_CONSENT_UPDATED', entityType: 'public_form_consent', entityId: id, changes: { title: fields.title } });
    return this._dto(clubId, id);
  }

  async remove(clubId, id, actorId) {
    const row = await this._get(clubId, id);
    const files = await publicFormConsentsRepository.findFiles([id]);
    await publicFormConsentsRepository.deleteById(id);
    for (const f of files) deletePrivateFile(f.file_path);
    await auditRepository.logAction({ userId: actorId, clubId, action: 'PUBLIC_FORM_CONSENT_DELETED', entityType: 'public_form_consent', entityId: id, changes: { title: row.title } });
  }

  async reorder(clubId, ids) {
    const own = new Set((await publicFormConsentsRepository.listByClub(clubId)).map((r) => r.id));
    const valid = (ids || []).map(Number).filter((id) => own.has(id));
    await publicFormConsentsRepository.setOrder(clubId, valid);
    return this.list(clubId);
  }

  /** PDFs recién subidos por multer (ya validados como PDF). */
  async addFiles(clubId, id, files, actorId) {
    const list = files || [];
    try {
      await this._get(clubId, id);
      if (!list.length) throw AppError.badRequest('Selecciona al menos un archivo PDF.');
      const existing = await publicFormConsentsRepository.findFiles([id]);
      if (existing.length + list.length > MAX_FILES_PER_CONSENT) throw AppError.badRequest(`Cada consentimiento admite hasta ${MAX_FILES_PER_CONSENT} archivos.`);
      for (const file of list) {
        // eslint-disable-next-line no-await-in-loop
        await publicFormConsentsRepository.addFile(id, {
          name: String(file.originalname || 'documento.pdf').slice(0, 160),
          filePath: `${CONSENT_FILES_SUBDIR}/${file.filename}`,
          mimeType: file.mimetype,
          sizeBytes: file.size,
        });
      }
    } catch (error) {
      for (const file of list) deletePrivateFile(`${CONSENT_FILES_SUBDIR}/${file.filename}`);
      throw error;
    }
    await auditRepository.logAction({ userId: actorId, clubId, action: 'PUBLIC_FORM_CONSENT_UPDATED', entityType: 'public_form_consent', entityId: id, changes: { filesAdded: list.map((f) => f.originalname) } });
    return this._dto(clubId, id);
  }

  async removeFile(clubId, id, fileId, actorId) {
    await this._get(clubId, id);
    const file = (await publicFormConsentsRepository.findFiles([id])).find((f) => f.id === fileId);
    if (!file) throw AppError.notFound('Archivo no encontrado.');
    await publicFormConsentsRepository.deleteFile(fileId);
    deletePrivateFile(file.file_path);
    await auditRepository.logAction({ userId: actorId, clubId, action: 'PUBLIC_FORM_CONSENT_UPDATED', entityType: 'public_form_consent', entityId: id, changes: { fileRemoved: file.name } });
    return this._dto(clubId, id);
  }

  /** Archivo de un consentimiento. `activeOnly`: para el formulario público (sin sesión), solo si
   * el consentimiento sigue activo. */
  async getFile(clubId, id, fileId, { activeOnly = false } = {}) {
    const row = await publicFormConsentsRepository.findInClub(clubId, id);
    if (!row || (activeOnly && !row.is_active)) throw AppError.notFound('Archivo no encontrado.');
    const file = (await publicFormConsentsRepository.findFiles([id])).find((f) => f.id === fileId);
    const absolutePath = file && resolvePrivatePath(file.file_path);
    if (!absolutePath) throw AppError.notFound('Archivo no encontrado.');
    return { absolutePath, name: file.name, mimeType: file.mime_type };
  }

  // ------------------------------------------------------------------ formulario público

  /** Consentimientos activos, tal como se muestran en el formulario. */
  async listActive(clubId) {
    return (await this._withFiles(await publicFormConsentsRepository.listByClub(clubId, { activeOnly: true }))).map(({ isActive, ...rest }) => rest);
  }

  /** Valida lo marcado al enviar y arma la copia que se guarda en la solicitud. */
  async resolveAcceptance(clubId, acceptedIds, { ipAddress, userAgent } = {}) {
    const accepted = new Set((Array.isArray(acceptedIds) ? acceptedIds : []).map(Number));
    const active = await this.listActive(clubId);
    const missing = active.filter((c) => c.isRequired && !accepted.has(c.id));
    if (missing.length) {
      throw AppError.badRequest(missing.length === 1 ? `Debes aceptar «${missing[0].title}» para enviar la inscripción.` : 'Debes aceptar los consentimientos obligatorios para enviar la inscripción.');
    }
    return active.map((c) => ({
      consentId: c.id,
      title: c.title,
      body: c.body,
      checkboxLabel: c.checkboxLabel,
      fileNames: c.files.map((f) => f.name),
      isRequired: c.isRequired,
      accepted: accepted.has(c.id),
      ipAddress,
      userAgent,
    }));
  }

  async saveAcceptance(applicationId, records) {
    await publicFormConsentsRepository.addApplicationConsents(applicationId, records);
  }

  /** Lo aceptado por cada solicitud, para la revisión (agrupado por id de solicitud). */
  async acceptanceByApplication(applicationIds) {
    const rows = await publicFormConsentsRepository.findApplicationConsents(applicationIds);
    const map = new Map();
    for (const r of rows) {
      let fileNames = [];
      try {
        fileNames = typeof r.file_names === 'string' ? JSON.parse(r.file_names) : r.file_names || [];
      } catch {
        fileNames = [];
      }
      if (!map.has(r.application_id)) map.set(r.application_id, []);
      map.get(r.application_id).push({
        title: r.title,
        body: r.body,
        checkboxLabel: r.checkbox_label,
        fileNames,
        isRequired: !!r.is_required,
        accepted: !!r.accepted,
        acceptedAt: r.accepted_at,
        ipAddress: r.ip_address ? String(r.ip_address).replace(/^::ffff:/, '') : null,
      });
    }
    return map;
  }
}

module.exports = new PublicFormConsentsService();
module.exports.CONSENT_FILES_SUBDIR = CONSENT_FILES_SUBDIR;
