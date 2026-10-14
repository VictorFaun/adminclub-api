const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const selfService = require('../services/selfService.service');

// "Mi club": todo resuelto con la cuenta de la sesión (req.user.id); ver selfService.service.js.
const ctx = (req) => [req.club.id, req.user.id];
const mid = (req) => Number(req.params.memberId);

const overview = asyncHandler(async (req, res) => ApiResponse.ok(res, await selfService.overview(...ctx(req)), 'Mi club obtenido correctamente.'));
const summary = asyncHandler(async (req, res) => ApiResponse.ok(res, await selfService.summary(...ctx(req), mid(req)), 'Resumen obtenido correctamente.'));
const payments = asyncHandler(async (req, res) => ApiResponse.ok(res, await selfService.payments(...ctx(req), mid(req)), 'Pagos obtenidos correctamente.'));
const payOptions = asyncHandler(async (req, res) => ApiResponse.ok(res, await selfService.payOptions(...ctx(req), mid(req)), 'Períodos por pagar obtenidos correctamente.'));
const proofs = asyncHandler(async (req, res) => ApiResponse.ok(res, await selfService.proofs(...ctx(req), mid(req)), 'Comprobantes obtenidos correctamente.'));
const attendance = asyncHandler(async (req, res) => ApiResponse.ok(res, await selfService.attendance(...ctx(req), mid(req)), 'Asistencia obtenida correctamente.'));
const profile = asyncHandler(async (req, res) => ApiResponse.ok(res, await selfService.profile(...ctx(req), mid(req)), 'Ficha obtenida correctamente.'));
const guardians = asyncHandler(async (req, res) => ApiResponse.ok(res, await selfService.myGuardians(...ctx(req), mid(req)), 'Apoderados obtenidos correctamente.'));

const submitProof = asyncHandler(async (req, res) => {
  const data = await selfService.submitProof(...ctx(req), mid(req), req.body || {}, req.file || null);
  return ApiResponse.created(res, data, 'Comprobante enviado. La directiva lo revisará pronto.');
});

const receipt = asyncHandler(async (req, res) => {
  const { buffer, filename } = await selfService.receipt(...ctx(req), Number(req.params.paymentId));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  return res.send(buffer);
});

const updateProfile = asyncHandler(async (req, res) => {
  const data = await selfService.updateProfile(...ctx(req), mid(req), { fields: req.body.fields });
  return ApiResponse.ok(res, data, 'Ficha actualizada correctamente.');
});

const setImage = asyncHandler(async (req, res) => {
  const data = await selfService.setImage(...ctx(req), mid(req), Number(req.params.fieldId), req.file || null);
  return ApiResponse.ok(res, data, 'Imagen actualizada correctamente.');
});

const removeImage = asyncHandler(async (req, res) => {
  await selfService.removeImage(...ctx(req), mid(req), Number(req.params.fieldId), req.query.url || null);
  return ApiResponse.ok(res, null, 'Imagen eliminada correctamente.');
});

const inviteGuardian = asyncHandler(async (req, res) => {
  const data = await selfService.inviteGuardian(...ctx(req), mid(req), req.body);
  return ApiResponse.ok(res, data, data.added ? 'Apoderado agregado.' : 'Invitación enviada.');
});

// --- Directiva: configuración y apoderados de una ficha ---

const getSettings = asyncHandler(async (req, res) => ApiResponse.ok(res, await selfService.getSettings(req.club.id), 'Configuración obtenida correctamente.'));
const updateSettings = asyncHandler(async (req, res) => {
  const data = await selfService.updateSettings(req.club.id, req.body, req.user.id);
  return ApiResponse.ok(res, data, 'Configuración actualizada correctamente.');
});

module.exports = { overview, summary, payments, payOptions, proofs, attendance, profile, guardians, submitProof, receipt, updateProfile, setImage, removeImage, inviteGuardian, getSettings, updateSettings };
