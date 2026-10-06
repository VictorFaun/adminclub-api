const memberFieldsRepository = require('../repositories/memberFields.repository');
const permissionService = require('../services/permission.service');
const AppError = require('./AppError');
const { parseSettings } = require('./memberFieldTypes');
const { FUNCTIONS } = require('../config/constants');

/**
 * Campos de la ficha marcados como "sensibles" (salud, alergias, documentos privados…): solo los
 * ven y editan quienes tienen VIEW_SENSITIVE_MEMBER_FIELDS. El resto recibe la ficha sin esos
 * valores (como si estuvieran vacíos) y no puede modificarlos.
 */
function canSeeSensitive(authContext) {
  return !!authContext && permissionService.hasFunction(authContext, FUNCTIONS.VIEW_SENSITIVE_MEMBER_FIELDS);
}

async function sensitiveFieldsOf(clubId) {
  return (await memberFieldsRepository.findByClub(clubId)).filter((f) => parseSettings(f).sensitive);
}

/** Quita los valores sensibles de una ficha (o lista de fichas) si el actor no tiene el permiso. */
async function stripSensitive(clubId, authContext, data) {
  if (!data || canSeeSensitive(authContext)) return data;
  const fields = await sensitiveFieldsOf(clubId);
  if (!fields.length) return data;
  const codes = fields.map((f) => f.code);
  const strip = (dto) => {
    if (!dto || !dto.fields) return dto;
    const clean = { ...dto.fields };
    for (const code of codes) delete clean[code];
    // Archivos adjuntos de campos sensibles (solicitudes de inscripción).
    const files = Array.isArray(dto.files) ? dto.files.filter((f) => !fields.some((x) => x.id === f.fieldId)) : dto.files;
    return { ...dto, fields: clean, ...(files !== undefined ? { files } : {}) };
  };
  return Array.isArray(data) ? data.map(strip) : strip(data);
}

/** Documentos (o adjuntos) visibles: sin los de campos sensibles si el actor no tiene el permiso. */
async function filterSensitiveDocuments(clubId, authContext, docs) {
  if (canSeeSensitive(authContext)) return docs;
  const ids = new Set((await sensitiveFieldsOf(clubId)).map((f) => f.id));
  return docs.filter((d) => !ids.has(d.fieldId));
}

/** Rechaza operar sobre un campo sensible sin permiso (subir/quitar imágenes o archivos, descargar). */
async function assertFieldAccessible(clubId, authContext, fieldId) {
  if (!fieldId || canSeeSensitive(authContext)) return;
  if ((await sensitiveFieldsOf(clubId)).some((f) => f.id === Number(fieldId))) {
    throw AppError.forbidden('Este campo es sensible: no tienes permiso para verlo ni modificarlo.');
  }
}

module.exports = { canSeeSensitive, stripSensitive, filterSensitiveDocuments, assertFieldAccessible };
