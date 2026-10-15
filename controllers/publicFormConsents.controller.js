const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const service = require('../services/publicFormConsents.service');
const memberApplicationsService = require('../services/memberApplications.service');

const list = asyncHandler(async (req, res) => ApiResponse.ok(res, await service.list(req.club.id), 'Consentimientos obtenidos correctamente.'));

const create = asyncHandler(async (req, res) => {
  const data = await service.create(req.club.id, req.body, req.user.id);
  return ApiResponse.created(res, data, 'Consentimiento creado correctamente.');
});

const update = asyncHandler(async (req, res) => {
  const data = await service.update(req.club.id, Number(req.params.consentId), req.body, req.user.id);
  return ApiResponse.ok(res, data, 'Consentimiento actualizado correctamente.');
});

const remove = asyncHandler(async (req, res) => {
  await service.remove(req.club.id, Number(req.params.consentId), req.user.id);
  return ApiResponse.ok(res, null, 'Consentimiento eliminado correctamente.');
});

const reorder = asyncHandler(async (req, res) => {
  const data = await service.reorder(req.club.id, req.body.ids);
  return ApiResponse.ok(res, data, 'Orden actualizado correctamente.');
});

const addFiles = asyncHandler(async (req, res) => {
  const data = await service.addFiles(req.club.id, Number(req.params.consentId), req.files, req.user.id);
  return ApiResponse.ok(res, data, 'Archivos agregados correctamente.');
});

const removeFile = asyncHandler(async (req, res) => {
  const data = await service.removeFile(req.club.id, Number(req.params.consentId), Number(req.params.fileId), req.user.id);
  return ApiResponse.ok(res, data, 'Archivo eliminado correctamente.');
});

function sendInline(res, file) {
  res.type(file.mimeType);
  // inline: el PDF se abre en el visor del navegador (con opción de descargar).
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  return res.sendFile(file.absolutePath);
}

const downloadFile = asyncHandler(async (req, res) => {
  const file = await service.getFile(req.club.id, Number(req.params.consentId), Number(req.params.fileId));
  return sendInline(res, file);
});

/** Público (sin sesión): solo con el formulario activo y el consentimiento activo. */
const publicDownloadFile = asyncHandler(async (req, res) => {
  const club = await memberApplicationsService.publicClub(req.params.code);
  const file = await service.getFile(club.id, Number(req.params.consentId), Number(req.params.fileId), { activeOnly: true });
  return sendInline(res, file);
});

module.exports = { list, create, update, remove, reorder, addFiles, removeFile, downloadFile, publicDownloadFile };
