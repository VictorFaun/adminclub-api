const asyncHandler = require('../helpers/asyncHandler');
const memberSpreadsheetService = require('../services/memberSpreadsheet.service');
const { sendWorkbook } = require('../helpers/excel');
const AppError = require('../helpers/AppError');
const { stripSensitive, filterSensitiveDocuments, assertFieldAccessible, canSeeSensitive } = require('../helpers/sensitiveFields');
const membersRepository = require('../repositories/members.repository');
const ApiResponse = require('../helpers/ApiResponse');
const membersService = require('../services/members.service');
const birthdaysService = require('../services/birthdays.service');
const paymentsService = require('../services/payments.service');
const permissionService = require('../services/permission.service');
const { toAbsoluteMediaUrl } = require('../helpers/mediaUrl');
const { FUNCTIONS } = require('../config/constants');

/** Agrega `canViewPayments` a uno o varios miembros ya resueltos por membersService — vive acá
 * (no en members.service.js) para evitar un ciclo de imports: payments.service.js ya depende de
 * members.service.js (para revalidar visibilidad de perfil), así que members.service.js no
 * puede depender de vuelta de payments.service.js. Sin VIEW_PAYMENTS/VIEW_PAYMENTS_SCOPED, el
 * flag es `false` para todos sin ninguna query extra. */
async function attachCanViewPayments(members, clubId, actorId, authContext) {
  const hasAny = permissionService.hasAnyFunction(authContext, [FUNCTIONS.VIEW_PAYMENTS, FUNCTIONS.VIEW_PAYMENTS_SCOPED]);
  if (!hasAny) return members.map((m) => ({ ...m, canViewPayments: false }));

  const access = await paymentsService.resolveAccessForController(authContext, actorId, clubId);
  return members.map((m) => ({ ...m, canViewPayments: access.full || access.memberIds.includes(m.id) }));
}

const exportMembers = asyncHandler(async (req, res) => {
  const sheet = await memberSpreadsheetService.exportSheet(req.club.id, req.query, req.authContext, req.user.id);
  return sendWorkbook(res, `miembros-${req.club.public_code || req.club.id}.xlsx`, [sheet]);
});

const importTemplate = asyncHandler(async (req, res) => {
  const sheets = await memberSpreadsheetService.templateSheets(req.club.id, req.authContext);
  return sendWorkbook(res, 'planilla-miembros.xlsx', sheets);
});

const importMembers = asyncHandler(async (req, res) => {
  if (!req.file) throw AppError.badRequest('Debes adjuntar la planilla (.xlsx).');
  const dryRun = String(req.body.dryRun ?? 'true') !== 'false';
  const data = await memberSpreadsheetService.importFile(req.club.id, req.file.buffer, { dryRun }, req.user.id, req.authContext);
  return ApiResponse.ok(res, data, dryRun ? 'Planilla revisada.' : `Se importaron ${data.results.filter((r) => r.ok).length} miembros.`);
});

const listSettings = asyncHandler(async (req, res) => {
  const data = await membersService.getListSettings(req.club.id);
  return ApiResponse.ok(res, data, 'Columnas del listado obtenidas correctamente.');
});

const updateListSettings = asyncHandler(async (req, res) => {
  const data = await membersService.updateListSettings(req.club.id, req.body, req.user.id);
  return ApiResponse.ok(res, data, 'Columnas del listado actualizadas correctamente.');
});

const list = asyncHandler(async (req, res) => {
  const result = await membersService.listForClub(req.club.id, req.query, req.authContext, req.user.id);
  const items = await stripSensitive(req.club.id, req.authContext, result.items);
  const { meta } = result;
  const withPayments = await attachCanViewPayments(items, req.club.id, req.user.id, req.authContext);
  return ApiResponse.paginated(res, withPayments, meta, 'Miembros obtenidos correctamente.');
});

const options = asyncHandler(async (req, res) => {
  const items = await membersService.findOptions(req.club.id);
  return ApiResponse.ok(res, items, 'Miembros obtenidos correctamente.');
});

const dashboard = asyncHandler(async (req, res) => {
  const data = await membersService.getDashboard(req.club.id, req.authContext, req.user.id);
  return ApiResponse.ok(res, data, 'Resumen de miembros obtenido correctamente.');
});

const birthdays = asyncHandler(async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 0), 366);
  const search = req.query.search ? String(req.query.search).trim().slice(0, 100) : undefined;
  const groupId = req.query.groupId ? Number(req.query.groupId) : undefined;
  const data = await membersService.listUpcomingBirthdays(req.club.id, days, req.authContext, req.user.id, { search, groupId });
  return ApiResponse.ok(res, data, 'Próximos cumpleaños obtenidos correctamente.');
});

const birthdaySettings = asyncHandler(async (req, res) => {
  const data = await birthdaysService.getMySettings(req.user.id, req.club.id);
  return ApiResponse.ok(res, data, 'Ajustes de cumpleaños obtenidos correctamente.');
});

const updateBirthdaySettings = asyncHandler(async (req, res) => {
  const data = await birthdaysService.updateMySettings(req.user.id, req.club.id, req.body);
  return ApiResponse.ok(res, data, 'Ajustes de cumpleaños actualizados correctamente.');
});

const sendBirthdaysToMe = asyncHandler(async (req, res) => {
  const data = await birthdaysService.sendMeNow(req.user.id, req.club.id, req.body?.days);
  return ApiResponse.ok(res, data, 'Te enviamos el correo de cumpleaños.');
});

const getBirthdayTemplate = asyncHandler(async (req, res) => {
  const format = String(req.query.format || '');
  const data = await birthdaysService.getTemplate(req.club.id, format);
  return ApiResponse.ok(res, data, 'Plantilla de cumpleaños obtenida correctamente.');
});

const saveBirthdayTemplate = asyncHandler(async (req, res) => {
  const format = String(req.body?.format || '');
  const data = await birthdaysService.saveTemplate(req.club.id, format, req.body);
  return ApiResponse.ok(res, data, 'Plantilla de cumpleaños guardada correctamente.');
});

// Imagen suelta para un elemento de la plantilla (fondo/decoración) — no se asocia a ninguna
// fila propia (a diferencia del logo/foto de socio, que reemplazan un slot único): la URL queda
// referenciada dentro del JSON del diseño, así que acá solo se sube el archivo y se devuelve su
// URL absoluta.
const uploadBirthdayTemplateImage = asyncHandler(async (req, res) => {
  if (!req.file) throw AppError.badRequest('Debes adjuntar una imagen.');
  const url = `/uploads/birthday-template/${req.file.filename}`;
  return ApiResponse.ok(res, { url: toAbsoluteMediaUrl(url) }, 'Imagen subida correctamente.');
});

const getById = asyncHandler(async (req, res) => {
  const member = await stripSensitive(req.club.id, req.authContext, await membersService.getById(req.club.id, Number(req.params.id), req.authContext, req.user.id));
  const [withPayments] = await attachCanViewPayments([member], req.club.id, req.user.id, req.authContext);
  return ApiResponse.ok(res, withPayments, 'Miembro obtenido correctamente.');
});

// MEMBER_CREATED se registra en members.service.js#create (con el id real), no acá.
const create = asyncHandler(async (req, res) => {
  const member = await stripSensitive(req.club.id, req.authContext, await membersService.create(req.club.id, req.body, req.user.id, { allowSensitive: canSeeSensitive(req.authContext) }));
  return ApiResponse.created(res, member, 'Miembro creado correctamente.');
});

const createSelf = asyncHandler(async (req, res) => {
  const member = await membersService.createSelf(req.club.id, req.user.id, req.body, req.files);
  return ApiResponse.created(res, member, 'Ficha completada correctamente.');
});

const update = asyncHandler(async (req, res) => {
  const member = await stripSensitive(req.club.id, req.authContext, await membersService.update(req.club.id, Number(req.params.id), req.body, req.user.id, req.authContext));
  return ApiResponse.ok(res, member, 'Miembro actualizado correctamente.');
});

const remove = asyncHandler(async (req, res) => {
  await membersService.remove(req.club.id, Number(req.params.id), req.user.id, req.authContext);
  return ApiResponse.ok(res, null, 'Miembro eliminado correctamente.');
});

const linkUser = asyncHandler(async (req, res) => {
  const member = await stripSensitive(req.club.id, req.authContext, await membersService.linkUser(req.club.id, Number(req.params.id), req.body.userId || null, req.user.id, req.authContext));
  return ApiResponse.ok(res, member, req.body.userId ? 'Cuenta vinculada correctamente.' : 'Cuenta desvinculada correctamente.');
});

// Imagen de un campo de tipo "imagen" de la ficha (ej. la foto).
const setImage = asyncHandler(async (req, res) => {
  await assertFieldAccessible(req.club.id, req.authContext, req.params.fieldId);
  const data = await membersService.setImage(req.club.id, Number(req.params.id), Number(req.params.fieldId), req.file, req.user.id, req.authContext);
  return ApiResponse.ok(res, data, 'Imagen actualizada correctamente.');
});

const removeImage = asyncHandler(async (req, res) => {
  await assertFieldAccessible(req.club.id, req.authContext, req.params.fieldId);
  await membersService.removeImage(req.club.id, Number(req.params.id), Number(req.params.fieldId), req.user.id, req.authContext, req.query.url || null);
  return ApiResponse.ok(res, null, 'Imagen eliminada correctamente.');
});

const listDocuments = asyncHandler(async (req, res) => {
  const data = await filterSensitiveDocuments(req.club.id, req.authContext, await membersService.listDocuments(req.club.id, Number(req.params.id), req.user.id, req.authContext));
  return ApiResponse.ok(res, data, 'Documentos obtenidos correctamente.');
});

const addDocument = asyncHandler(async (req, res) => {
  await assertFieldAccessible(req.club.id, req.authContext, req.body.fieldId);
  const data = await membersService.addDocument(req.club.id, Number(req.params.id), req.body.fieldId, req.file, req.body.name, req.user.id, req.authContext);
  return ApiResponse.created(res, data, 'Documento subido correctamente.');
});

const removeDocument = asyncHandler(async (req, res) => {
  await assertFieldAccessible(req.club.id, req.authContext, (await membersRepository.findDocument(Number(req.params.documentId)))?.field_id);
  await membersService.removeDocument(req.club.id, Number(req.params.id), Number(req.params.documentId), req.user.id, req.authContext);
  return ApiResponse.ok(res, null, 'Documento eliminado correctamente.');
});

const downloadDocument = asyncHandler(async (req, res) => {
  await assertFieldAccessible(req.club.id, req.authContext, (await membersRepository.findDocument(Number(req.params.documentId)))?.field_id);
  const file = await membersService.getDocumentFile(req.club.id, Number(req.params.id), Number(req.params.documentId), req.user.id, req.authContext);
  res.type(file.mimeType);
  return res.download(file.absolutePath, file.name);
});

module.exports = {
  exportMembers,
  importTemplate,
  importMembers,
  listSettings,
  updateListSettings,
  birthdaySettings,
  updateBirthdaySettings,
  sendBirthdaysToMe,
  getBirthdayTemplate,
  saveBirthdayTemplate,
  uploadBirthdayTemplateImage,
  setImage,
  removeImage,
  listDocuments,
  addDocument,
  removeDocument,
  downloadDocument,
  birthdays,
  list,
  options,
  dashboard,
  getById,
  create,
  createSelf,
  update,
  remove,
  linkUser,
};
