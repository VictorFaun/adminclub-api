const memberFieldsRepository = require('../repositories/memberFields.repository');
const memberFormsRepository = require('../repositories/memberForms.repository');
const membersRepository = require('../repositories/members.repository');
const permissionService = require('../services/permission.service');
const AppError = require('./AppError');
const { parseSettings } = require('./memberFieldTypes');
const { FUNCTIONS } = require('../config/constants');

/**
 * Qué campos de la ficha puede ver el actor. Dos motivos para ocultar uno:
 *  - Sensibles (salud, alergias, documentos privados…): solo con VIEW_SENSITIVE_MEMBER_FIELDS.
 *  - De fichas que no puede ver (sql/081): con "Ver todas las fichas" (o "Editar miembros") ve
 *    todas; si no, solo las de "Ver fichas específicas" + las fichas y campos que puede editar.
 * El resto recibe la ficha sin esos valores (como si no existieran) y no puede modificarlos.
 */
function canSeeSensitive(authContext) {
  return !!authContext && permissionService.hasFunction(authContext, FUNCTIONS.VIEW_SENSITIVE_MEMBER_FIELDS);
}

const has = (authContext, ...codes) => permissionService.hasAnyFunction(authContext, codes);

/**
 * Fichas cuyos datos puede ver: `{ all: true }` o `{ all: false, formIds, fieldIds }` (`fieldIds`:
 * todos los campos visibles, de esas fichas + los sueltos que puede editar). Sin authContext
 * (flujos internos) no se restringe. Se guarda en el authContext (uno por request).
 */
async function formViewScope(clubId, authContext) {
  if (!authContext || has(authContext, FUNCTIONS.VIEW_MEMBER_FORM_DATA, FUNCTIONS.EDIT_MEMBERS)) return { all: true, formIds: [], fieldIds: [] };
  const cache = (authContext._formViewScope ||= {});
  if (cache[clubId]) return cache[clubId];
  const formIds = new Set();
  const looseFieldIds = new Set();
  if (authContext.userId) {
    if (has(authContext, FUNCTIONS.VIEW_MEMBER_FORM_DATA_SCOPED)) {
      for (const id of await membersRepository.findViewFormScope(authContext.userId, clubId)) formIds.add(id);
    }
    // Lo que puede editar, también lo puede ver.
    if (has(authContext, FUNCTIONS.EDIT_MEMBER_FORMS_SCOPED, FUNCTIONS.EDIT_MEMBER_FIELD_VALUES_SCOPED)) {
      const edit = await membersRepository.findEditScope(authContext.userId, clubId);
      if (has(authContext, FUNCTIONS.EDIT_MEMBER_FORMS_SCOPED)) edit.formIds.forEach((id) => formIds.add(id));
      if (has(authContext, FUNCTIONS.EDIT_MEMBER_FIELD_VALUES_SCOPED)) edit.fieldIds.forEach((id) => looseFieldIds.add(id));
    }
  }
  const byForm = await memberFormsRepository.fieldIdsByForm(clubId);
  const fieldIds = new Set(looseFieldIds);
  for (const id of formIds) for (const fieldId of byForm[id] || []) fieldIds.add(fieldId);
  cache[clubId] = { all: false, formIds: [...formIds], fieldIds: [...fieldIds] };
  return cache[clubId];
}

/** Campos que el actor NO puede ver (sensibles sin permiso + los de fichas que no ve).
 * `sensitiveOnly`: solo los sensibles (solicitudes de inscripción: no son fichas de un miembro). */
async function hiddenFieldsOf(clubId, authContext, { sensitiveOnly = false } = {}) {
  const catalog = await memberFieldsRepository.findByClub(clubId);
  const hideSensitive = !canSeeSensitive(authContext);
  const scope = sensitiveOnly ? { all: true, fieldIds: [] } : await formViewScope(clubId, authContext);
  const visible = new Set(scope.fieldIds);
  return catalog.filter((f) => (hideSensitive && parseSettings(f).sensitive) || (!scope.all && !visible.has(f.id)));
}

// Atajos de solo lectura del miembro que salen de un campo con uso especial.
const SHORTCUT_BY_ROLE = {
  identifier: ['rut'],
  email: ['email'],
  phone: ['phone'],
  birth_date: ['birthDate'],
  avatar: ['avatarUrl'],
  birthday_photo: ['birthdayPhotoUrl'],
};

/** Quita los valores que el actor no puede ver de una ficha (o lista de fichas). */
async function stripSensitive(clubId, authContext, data, { sensitiveOnly = false } = {}) {
  if (!data) return data;
  const fields = await hiddenFieldsOf(clubId, authContext, { sensitiveOnly });
  const scope = sensitiveOnly ? { all: true, formIds: [] } : await formViewScope(clubId, authContext);
  if (!fields.length && scope.all) return data;
  const codes = fields.map((f) => f.code);
  const ids = new Set(fields.map((f) => f.id));
  const shortcuts = fields.flatMap((f) => SHORTCUT_BY_ROLE[f.role] || []);
  const strip = (dto) => {
    if (!dto || !dto.fields) return dto;
    const clean = { ...dto.fields };
    for (const code of codes) delete clean[code];
    const out = { ...dto, fields: clean };
    for (const key of shortcuts) if (key in out) out[key] = null;
    // Fichas que responde: solo las que puede ver.
    if (!scope.all && Array.isArray(out.formIds)) out.formIds = out.formIds.filter((id) => scope.formIds.includes(id));
    // Archivos adjuntos de esos campos (solicitudes de inscripción).
    if (Array.isArray(dto.files)) out.files = dto.files.filter((f) => !ids.has(f.fieldId));
    return out;
  };
  return Array.isArray(data) ? data.map(strip) : strip(data);
}

/** Documentos (o adjuntos) visibles: sin los de campos que el actor no puede ver. */
async function filterSensitiveDocuments(clubId, authContext, docs) {
  const ids = new Set((await hiddenFieldsOf(clubId, authContext)).map((f) => f.id));
  if (!ids.size) return docs;
  return docs.filter((d) => !ids.has(d.fieldId));
}

/** Rechaza operar sobre un campo que el actor no puede ver (subir/quitar imágenes o archivos, descargar). */
async function assertFieldAccessible(clubId, authContext, fieldId, { sensitiveOnly = false } = {}) {
  if (!fieldId) return;
  if ((await hiddenFieldsOf(clubId, authContext, { sensitiveOnly })).some((f) => f.id === Number(fieldId))) {
    throw AppError.forbidden('No tienes permiso para ver ni modificar este campo.');
  }
}

module.exports = { canSeeSensitive, formViewScope, hiddenFieldsOf, stripSensitive, filterSensitiveDocuments, assertFieldAccessible };
