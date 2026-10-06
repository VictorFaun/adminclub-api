const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const paymentProofsService = require('../services/paymentProofs.service');

// --- Público (sin sesión) ---
const publicClub = asyncHandler(async (req, res) => {
  const data = await paymentProofsService.getPublicClub(req.params.code);
  return ApiResponse.ok(res, data, 'Club obtenido correctamente.');
});

// Un RUT inexistente/inválido responde 200 con `{ found: false }` (nunca un error).
const publicLookup = asyncHandler(async (req, res) => {
  const data = await paymentProofsService.lookup(req.params.code, req.query.rut);
  return ApiResponse.ok(res, data, 'Consulta realizada correctamente.');
});

const publicSubmit = asyncHandler(async (req, res) => {
  const data = await paymentProofsService.submitPublicProof(req.params.code, req.body, req.file);
  return ApiResponse.created(res, data, 'Comprobante enviado. Será revisado a la brevedad.');
});

// --- Administración ---
const list = asyncHandler(async (req, res) => {
  const { status, groupId, chargeId, search, from, to } = req.query;
  const data = await paymentProofsService.list(req.club.id, { status, groupId, chargeId, search, from, to }, req.user.id, req.authContext);
  return ApiResponse.ok(res, data, 'Comprobantes obtenidos correctamente.');
});

const filterOptions = asyncHandler(async (req, res) => {
  const data = await paymentProofsService.filterOptions(req.club.id, req.user.id, req.authContext);
  return ApiResponse.ok(res, data, 'Filtros obtenidos correctamente.');
});

const pendingCount = asyncHandler(async (req, res) => {
  const data = await paymentProofsService.countPending(req.club.id, req.user.id, req.authContext);
  return ApiResponse.ok(res, data, 'Comprobantes pendientes obtenidos correctamente.');
});

const file = asyncHandler(async (req, res) => {
  const f = await paymentProofsService.getFile(req.club.id, Number(req.params.id), req.user.id, req.authContext);
  res.type(f.mimeType);
  return res.download(f.absolutePath, f.name);
});

const approve = asyncHandler(async (req, res) => {
  const data = await paymentProofsService.approve(req.club.id, Number(req.params.id), req.body, req.user.id, req.authContext);
  return ApiResponse.ok(res, data, 'Comprobante aprobado y pago registrado.');
});

const reject = asyncHandler(async (req, res) => {
  await paymentProofsService.reject(req.club.id, Number(req.params.id), req.body, req.user.id, req.authContext);
  return ApiResponse.ok(res, null, 'Comprobante rechazado.');
});

const publicPaymentsSetting = asyncHandler(async (req, res) => {
  const data = await paymentProofsService.getPublicPaymentsSetting(req.club.id);
  return ApiResponse.ok(res, data, 'Configuración obtenida correctamente.');
});

const updatePublicPaymentsSetting = asyncHandler(async (req, res) => {
  const data = await paymentProofsService.setPublicPaymentsSetting(req.club.id, req.body.enabled, req.user.id);
  return ApiResponse.ok(res, data, 'Configuración actualizada correctamente.');
});

module.exports = { publicClub, publicLookup, publicSubmit, list, filterOptions, pendingCount, file, approve, reject, publicPaymentsSetting, updatePublicPaymentsSetting };
