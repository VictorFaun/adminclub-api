const memberFormVersionsRepository = require('../repositories/memberFormVersions.repository');
const membersRepository = require('../repositories/members.repository');
const memberFieldsRepository = require('../repositories/memberFields.repository');
const memberFormsRepository = require('../repositories/memberForms.repository');
const memberFormsService = require('./memberForms.service');
const auditRepository = require('../repositories/audit.repository');
const AppError = require('../helpers/AppError');
const { withTransaction } = require('../config/database');
const { LAYOUT_TYPES, imageList, parseSettings } = require('../helpers/memberFieldTypes');
const { hiddenFieldsOf, formViewScope } = require('../helpers/sensitiveFields');
const { deleteUploadedFile } = require('../helpers/mediaUrl');
const { deletePrivateFile } = require('../middlewares/privateUpload.middleware');

/** members.service.js depende de este servicio: se carga al usarlo para no armar un ciclo. */
const members = () => require('./members.service');

/** Cómo llegó cada versión (se muestra junto a la fecha). */
// 'import': guardada desde una planilla de Excel (Importar miembros).
const SOURCES = ['initial', 'manual', 'application', 'self', 'import'];

/**
 * Versiones de las fichas (sql/078). Cada ficha de cada miembro tiene su historial de respuestas;
 * la principal (por defecto la última; "Usar como principal" elige otra) es la de `snapshot` NULL,
 * cuyos datos son los vigentes (member_field_values y los
 * documentos sin archivar). Las anteriores guardan una copia congelada (`snapshot`):
 *   { values: { <fieldId>: <valor> }, documents: { <fieldId>: [<documentId>] } }
 *
 * Imágenes y documentos se comparten entre versiones: un archivo solo se borra del disco cuando ya
 * no lo usa la ficha vigente ni ninguna versión (`retireImage` / `retireDocument`).
 */
class MemberFormVersionsService {
  _parse(snapshot) {
    if (!snapshot) return null;
    try {
      const data = typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot;
      return { values: data.values || {}, documents: data.documents || {} };
    } catch {
      return { values: {}, documents: {} };
    }
  }

  /** Campos con datos de una ficha (sin secciones) y, de ellos, los de archivos. */
  async _formFields(clubId, formId, conn) {
    const fields = (await memberFormsService.fieldsOf(clubId, [formId], conn)).filter((f) => !LAYOUT_TYPES.includes(f.field_type));
    return { fields, fileFields: fields.filter((f) => f.field_type === 'file') };
  }

  /** Documentos sin campo (anteriores a los campos de archivos) van al primer campo de archivos del club. */
  async _docFieldId(clubId, doc, conn) {
    if (doc.field_id) return doc.field_id;
    const first = (await memberFieldsRepository.findByClub(clubId, conn)).find((f) => f.field_type === 'file');
    return first?.id ?? null;
  }

  /** Lo vigente de una ficha, en el formato de `snapshot`. */
  async _live(clubId, memberId, formId, conn) {
    const { fields, fileFields } = await this._formFields(clubId, formId, conn);
    const valueIds = new Set(fields.filter((f) => f.field_type !== 'file').map((f) => f.id));
    const values = {};
    for (const v of await membersRepository.getFieldValues(memberId, conn)) {
      if (valueIds.has(v.field_id) && v.value !== null) values[v.field_id] = v.value;
    }
    const fileIds = new Set(fileFields.map((f) => f.id));
    const documents = {};
    for (const d of await membersRepository.findDocuments(memberId, conn)) {
      const fieldId = await this._docFieldId(clubId, d, conn);
      if (fieldId && fileIds.has(fieldId)) (documents[fieldId] ??= []).push(d.id);
    }
    return { values, documents };
  }

  /** La principal de una lista de versiones (la de `snapshot` NULL; si no hay, la última). */
  _currentOf(versions) {
    return versions.find((v) => v.snapshot === null || v.snapshot === undefined) ?? versions[versions.length - 1];
  }

  /**
   * Pone en la ficha vigente los datos de una copia congelada (valores y documentos de esa ficha;
   * las otras fichas no cambian). Devuelve lo que había antes, en el mismo formato.
   */
  async _restore(clubId, memberId, formId, snap, conn) {
    const { fields, fileFields } = await this._formFields(clubId, formId, conn);
    const before = await this._live(clubId, memberId, formId, conn);
    const set = {};
    const clear = [];
    for (const f of fields) {
      if (f.field_type === 'file') continue;
      if (snap.values[f.id] !== undefined && snap.values[f.id] !== null) set[f.id] = snap.values[f.id];
      else clear.push(f.id);
    }
    if (Object.keys(set).length) await membersRepository.upsertFieldValues(memberId, set, conn);
    await membersRepository.deleteFieldValues(memberId, clear, conn);
    // Documentos: vuelven los de la copia; los que estaban salen de la ficha (quedan archivados).
    const keep = new Set(fileFields.flatMap((f) => (snap.documents[f.id] || []).map(Number)));
    await membersRepository.setDocumentsArchived([...keep], false, conn);
    const current = Object.values(before.documents).flat().map(Number).filter((id) => !keep.has(id));
    await membersRepository.setDocumentsArchived(current, true, conn);
    return before;
  }

  // ------------------------------------------------------------------ crear

  /**
   * Respuesta nueva de las fichas indicadas: congela la versión vigente de cada una y abre otra
   * (que pasa a ser la principal). Llamar ANTES de guardar los valores nuevos. Las fichas que el
   * miembro todavía no tenía no se tocan (al asignarlas parten con su versión).
   * Devuelve los ids de las fichas que quedaron con versión nueva.
   */
  async startNew(clubId, memberId, formIds, { source = 'manual', actorId = null } = {}, conn) {
    const created = [];
    for (const formId of [...new Set((formIds || []).map(Number))]) {
      const latest = await memberFormVersionsRepository.latest(memberId, formId, conn);
      if (!latest) continue;
      const live = await this._live(clubId, memberId, formId, conn);
      await memberFormVersionsRepository.setSnapshot(latest.id, JSON.stringify(live), conn);
      await memberFormVersionsRepository.create({ memberId, formId, source: SOURCES.includes(source) ? source : 'manual', createdBy: actorId }, conn);
      created.push(formId);
    }
    return created;
  }

  // ------------------------------------------------------------------ archivos compartidos

  async _referenced(memberId, conn) {
    const docs = new Set();
    const values = [];
    for (const row of await memberFormVersionsRepository.snapshotsOf(memberId, conn)) {
      const snap = this._parse(row.snapshot);
      for (const ids of Object.values(snap.documents)) for (const id of ids) docs.add(Number(id));
      values.push(...Object.values(snap.values).map(String));
    }
    return { docs, values };
  }

  /** Quita un documento de la ficha vigente: si una versión anterior lo usa se archiva; si no, se borra. */
  async retireDocument(memberId, doc, conn) {
    const { docs } = await this._referenced(memberId, conn);
    if (docs.has(doc.id)) {
      await membersRepository.setDocumentsArchived([doc.id], true, conn);
      return;
    }
    await membersRepository.deleteDocument(doc.id, conn);
    deletePrivateFile(doc.file_path);
  }

  /** Borra del disco una imagen que salió de la ficha vigente, salvo que una versión la use. */
  async retireImage(memberId, url, conn) {
    if (!url) return;
    const { values } = await this._referenced(memberId, conn);
    if (values.some((v) => imageList(v).includes(url))) return;
    deleteUploadedFile(url);
  }

  // ------------------------------------------------------------------ ver

  /**
   * Versiones de las fichas del miembro, agrupadas por ficha (la última = principal), cada una
   * con sus valores (`fields`, por código, como en la ficha) y sus documentos. Sin datos
   * sensibles si el actor no tiene el permiso. El acceso al miembro lo revisa quien llama.
   */
  async listForMember(clubId, member, authContext) {
    const membersService = members();
    // Solo las fichas que puede ver y sin los campos ocultos (sensibles / ajenos, sql/081).
    const scope = await formViewScope(clubId, authContext);
    const formIds = (await memberFormsRepository.formIdsForMember(member.id)).filter((id) => scope.all || scope.formIds.includes(id));
    await memberFormVersionsRepository.ensureForMembers([member.id]);
    const rows = (await memberFormVersionsRepository.listByMember(member.id)).filter((r) => formIds.includes(r.form_id));
    const hidden = new Set((await hiddenFieldsOf(clubId, authContext)).map((f) => f.id));
    const visible = (f) => !hidden.has(f.id);

    const out = [];
    for (const formId of formIds) {
      const versions = rows.filter((r) => r.form_id === formId);
      if (!versions.length) continue;
      const { fields, fileFields } = await this._formFields(clubId, formId);
      const live = await this._live(clubId, member.id, formId);
      const list = [];
      const currentId = this._currentOf(versions).id;
      for (const [i, v] of versions.entries()) {
        const isCurrent = v.id === currentId;
        const snap = isCurrent ? live : this._parse(v.snapshot) || { values: {}, documents: {} };
        const values = {};
        for (const f of fields) {
          if (f.field_type === 'file' || !visible(f)) continue;
          values[f.code] = membersService._fieldValueDto(f, snap.values[f.id] ?? null);
        }
        const docIds = fileFields.filter(visible).flatMap((f) => (snap.documents[f.id] || []).map(Number));
        const docs = await membersRepository.findDocumentsByIds(member.id, docIds);
        const fieldOfDoc = new Map();
        for (const f of fileFields) for (const id of snap.documents[f.id] || []) fieldOfDoc.set(Number(id), f.id);
        list.push({
          id: v.id,
          formId,
          number: i + 1,
          isCurrent,
          source: v.source,
          createdAt: v.created_at,
          createdByName: v.created_by_username ?? null,
          fields: values,
          // El campo al que pertenece cada documento en ESTA versión (los antiguos sin campo).
          documents: docs.map((d) => ({ ...membersService._documentDto(d), fieldId: fieldOfDoc.get(d.id) ?? d.field_id ?? null })),
        });
      }
      out.push({ formId, versions: list.reverse() });
    }
    return out;
  }

  // ------------------------------------------------------------------ principal

  /**
   * "Usar como principal": una versión anterior vuelve a ser la vigente (sus datos pasan a la
   * ficha) y la que era principal queda guardada como anterior. No se copia ni cambia de fecha ni
   * de número. `allowedFormIds`: con edición acotada (sql/080), solo esas fichas (null = todas).
   */
  async activate(clubId, member, versionId, actorId, allowedFormIds = null) {
    const version = await memberFormVersionsRepository.findById(versionId);
    if (!version || version.member_id !== member.id) throw AppError.notFound('Versión no encontrada.');
    if (allowedFormIds && !allowedFormIds.includes(version.form_id)) throw AppError.forbidden('No tienes permiso para editar esta ficha.');
    const versions = await memberFormVersionsRepository.listForForm(member.id, version.form_id);
    const current = this._currentOf(versions);
    if (current.id === version.id) return { activated: false };
    const number = versions.findIndex((v) => v.id === version.id) + 1;

    await withTransaction(async (conn) => {
      const before = await this._restore(clubId, member.id, version.form_id, this._parse(version.snapshot) || { values: {}, documents: {} }, conn);
      await memberFormVersionsRepository.setSnapshot(current.id, JSON.stringify(before), conn);
      await memberFormVersionsRepository.setSnapshot(version.id, null, conn);
    });

    const form = await memberFormsRepository.findInClub(clubId, version.form_id);
    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'MEMBER_FORM_VERSION_ACTIVATED',
      entityType: 'member',
      entityId: member.id,
      changes: { form: form?.name ?? version.form_id, version: number },
    });
    return { activated: true };
  }

  // ------------------------------------------------------------------ eliminar

  /**
   * Elimina una versión (siempre queda al menos una por ficha). Si es la principal, la anterior
   * vuelve a ser la vigente: sus datos pasan a la ficha del miembro (cada ficha tiene sus propios
   * campos, sql/079, así que las otras fichas no cambian).
   */
  async remove(clubId, member, versionId, actorId) {
    const version = await memberFormVersionsRepository.findById(versionId);
    if (!version || version.member_id !== member.id) throw AppError.notFound('Versión no encontrada.');
    const versions = await memberFormVersionsRepository.listForForm(member.id, version.form_id);
    if (versions.length <= 1) throw AppError.badRequest('La ficha debe conservar al menos una versión.');
    const isCurrent = this._currentOf(versions).id === version.id;
    const number = versions.findIndex((v) => v.id === version.id) + 1;

    const removedImages = [];
    const orphanDocs = [];
    await withTransaction(async (conn) => {
      const { fields } = await this._formFields(clubId, version.form_id, conn);
      let dropped;
      if (isCurrent) {
        // La más reciente de las que quedan pasa a ser la principal: sus datos vuelven a la ficha.
        const previous = versions.filter((v) => v.id !== version.id).pop();
        const snap = this._parse(previous.snapshot) || { values: {}, documents: {} };
        dropped = await this._restore(clubId, member.id, version.form_id, snap, conn);
        await memberFormVersionsRepository.setSnapshot(previous.id, null, conn);
      } else {
        dropped = this._parse(version.snapshot) || { values: {}, documents: {} };
      }
      await memberFormVersionsRepository.deleteById(version.id, conn);

      // Archivos que ya nadie usa (ni la ficha vigente ni otra versión): se borran.
      const { docs, values } = await this._referenced(member.id, conn);
      const liveValues = (await membersRepository.getFieldValues(member.id, conn)).map((v) => String(v.value ?? ''));
      const inUse = (url) => [...values, ...liveValues].some((v) => imageList(v).includes(url));
      for (const f of fields.filter((x) => x.field_type === 'image')) {
        for (const url of imageList(dropped.values[f.id])) if (!inUse(url)) removedImages.push(url);
      }
      const ids = Object.values(dropped.documents).flat().map(Number);
      for (const d of await membersRepository.findDocumentsByIds(member.id, ids, conn)) {
        if (d.archived_at && !docs.has(d.id)) {
          await membersRepository.deleteDocument(d.id, conn);
          orphanDocs.push(d.file_path);
        }
      }
    });
    for (const url of removedImages) deleteUploadedFile(url);
    for (const path of orphanDocs) deletePrivateFile(path);

    const form = await memberFormsRepository.findInClub(clubId, version.form_id);
    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'MEMBER_FORM_VERSION_DELETED',
      entityType: 'member',
      entityId: member.id,
      changes: { form: form?.name ?? version.form_id, version: number, wasCurrent: isCurrent },
    });
    return { removed: true, wasCurrent: isCurrent };
  }
}

module.exports = new MemberFormVersionsService();
