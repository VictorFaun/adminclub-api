const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const service = require('../services/memberApplications.service');
const { stripSensitive, assertFieldAccessible } = require('../helpers/sensitiveFields');
const memberApplicationsRepository = require('../repositories/memberApplications.repository');

// --- Público (sin sesión) ---
const publicForm = asyncHandler(async (req, res) => {
  const data = await service.getPublicForm(req.params.code);
  return ApiResponse.ok(res, data, 'Formulario obtenido correctamente.');
});

const publicSubmit = asyncHandler(async (req, res) => {
  const data = await service.submit(req.params.code, req.body, req.files, { ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  return ApiResponse.created(res, data, 'Solicitud enviada. El club la revisará a la brevedad.');
});

// --- Ficha exigida por una invitación (con sesión, ver members.routes.js GET /me/form) ---
const invitationForm = asyncHandler(async (req, res) => {
  const data = await service.getInvitationForm(req.club, req.membership);
  return ApiResponse.ok(res, data, 'Formulario obtenido correctamente.');
});

// --- Administración ---
const list = asyncHandler(async (req, res) => {
  const archived = req.query.archived === 'true' || req.query.archived === '1';
  const items = await stripSensitive(req.club.id, req.authContext, await service.list(req.club.id, req.query.status, { archived }), { sensitiveOnly: true });
  // La del apoderado (sql/082) va dentro de cada una: mismas reglas.
  const data = await Promise.all(
    items.map(async (item) => (item.guardian ? { ...item, guardian: await stripSensitive(req.club.id, req.authContext, item.guardian, { sensitiveOnly: true }) } : item))
  );
  return ApiResponse.ok(res, data, 'Solicitudes obtenidas correctamente.');
});

const pendingCount = asyncHandler(async (req, res) => {
  const data = await service.countPending(req.club.id);
  return ApiResponse.ok(res, data, 'Solicitudes pendientes obtenidas correctamente.');
});

const approve = asyncHandler(async (req, res) => {
  const data = await service.approve(req.club.id, Number(req.params.id), req.body, req.user.id);
  return ApiResponse.ok(res, data, data.merged ? 'Solicitud aceptada: las respuestas se sumaron a la ficha del miembro existente.' : 'Solicitud aceptada: se creó la ficha del miembro.');
});

const reject = asyncHandler(async (req, res) => {
  await service.reject(req.club.id, Number(req.params.id), req.body, req.user.id);
  return ApiResponse.ok(res, null, 'Solicitud rechazada.');
});

const getSetting = asyncHandler(async (req, res) => {
  const data = await service.getSetting(req.club.id);
  return ApiResponse.ok(res, data, 'Configuración obtenida correctamente.');
});

const updateSetting = asyncHandler(async (req, res) => {
  const data = await service.setSetting(req.club.id, req.body, req.user.id);
  return ApiResponse.ok(res, data, 'Configuración actualizada correctamente.');
});

const downloadFile = asyncHandler(async (req, res) => {
  const row = (await memberApplicationsRepository.findFiles([Number(req.params.id)])).find((f) => f.id === Number(req.params.fileId));
  await assertFieldAccessible(req.club.id, req.authContext, row?.field_id, { sensitiveOnly: true });
  const file = await service.getFile(req.club.id, Number(req.params.id), Number(req.params.fileId));
  res.type(file.mimeType);
  return res.download(file.absolutePath, file.name);
});

const archive = asyncHandler(async (req, res) => {
  const archived = req.body.archived !== false;
  const data = await service.archive(req.club.id, req.body.ids, archived, req.user.id);
  return ApiResponse.ok(res, data, archived ? 'Solicitudes archivadas.' : 'Solicitudes desarchivadas.');
});

module.exports = { archive, publicForm, publicSubmit, invitationForm, list, pendingCount, approve, reject, getSetting, updateSetting, downloadFile };
