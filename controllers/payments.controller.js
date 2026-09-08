const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const paymentsService = require('../services/payments.service');

const dashboard = asyncHandler(async (req, res) => {
  const data = await paymentsService.getDashboard(req.club.id, req.authContext, req.user.id);
  return ApiResponse.ok(res, data, 'Resumen de tesorería obtenido correctamente.');
});

const listForMember = asyncHandler(async (req, res) => {
  const data = await paymentsService.listForMember(req.club.id, Number(req.params.memberId), req.user.id, req.authContext);
  return ApiResponse.ok(res, data, 'Pagos obtenidos correctamente.');
});

const chargeMatrix = asyncHandler(async (req, res) => {
  const data = await paymentsService.getChargeMatrix(
    req.club.id,
    Number(req.params.chargeId),
    { anchor: req.query.anchor, columns: req.query.columns ? Number(req.query.columns) : undefined },
    req.user.id,
    req.authContext
  );
  return ApiResponse.ok(res, data, 'Estado del cobro obtenido correctamente.');
});

const ensureInstance = asyncHandler(async (req, res) => {
  const data = await paymentsService.ensureInstance(
    req.club.id,
    Number(req.params.chargeId),
    Number(req.params.memberId),
    req.body.periodKey,
    req.user.id,
    req.authContext
  );
  return ApiResponse.ok(res, data, 'Período preparado correctamente.');
});

const listForInstance = asyncHandler(async (req, res) => {
  const data = await paymentsService.listForInstance(req.club.id, Number(req.params.instanceId), req.user.id, req.authContext);
  return ApiResponse.ok(res, data, 'Pagos del período obtenidos correctamente.');
});

// PAYMENT_CREATED se registra en payments.service.js#create (con el id real), no acá.
const create = asyncHandler(async (req, res) => {
  const payment = await paymentsService.create(req.club.id, req.body, req.user.id, req.authContext);
  return ApiResponse.created(res, payment, 'Pago registrado correctamente.');
});

const update = asyncHandler(async (req, res) => {
  const payment = await paymentsService.update(req.club.id, Number(req.params.id), req.body, req.user.id, req.authContext);
  return ApiResponse.ok(res, payment, 'Pago actualizado correctamente.');
});

const remove = asyncHandler(async (req, res) => {
  await paymentsService.remove(req.club.id, Number(req.params.id), req.user.id, req.authContext);
  return ApiResponse.ok(res, null, 'Pago eliminado correctamente.');
});

const exemptInstance = asyncHandler(async (req, res) => {
  await paymentsService.exemptInstance(req.club.id, Number(req.params.instanceId), req.body.reason, req.body.type, req.user.id, req.authContext);
  return ApiResponse.ok(res, null, 'Período marcado correctamente.');
});

const unexemptInstance = asyncHandler(async (req, res) => {
  await paymentsService.unexemptInstance(req.club.id, Number(req.params.instanceId), req.user.id, req.authContext);
  return ApiResponse.ok(res, null, 'Exención eliminada correctamente.');
});

const exemptMany = asyncHandler(async (req, res) => {
  const result = await paymentsService.exemptMany(
    req.club.id,
    req.body.instanceIds,
    req.body.reason,
    req.body.type,
    req.user.id,
    req.authContext
  );
  return ApiResponse.ok(res, result, 'Períodos marcados correctamente.');
});

const listSettlements = asyncHandler(async (req, res) => {
  const data = await paymentsService.listSettlements(
    req.club.id,
    Number(req.params.chargeId),
    req.params.periodKey,
    Number(req.query.responsibleMemberId),
    req.user.id,
    req.authContext
  );
  return ApiResponse.ok(res, data, 'Transferencias obtenidas correctamente.');
});

const createSettlement = asyncHandler(async (req, res) => {
  const data = await paymentsService.createSettlement(req.club.id, Number(req.params.chargeId), req.body, req.user.id, req.authContext);
  return ApiResponse.created(res, data, 'Transferencia registrada correctamente.');
});

const updateSettlement = asyncHandler(async (req, res) => {
  const data = await paymentsService.updateSettlement(req.club.id, Number(req.params.id), req.body, req.user.id, req.authContext);
  return ApiResponse.ok(res, data, 'Transferencia actualizada correctamente.');
});

const removeSettlement = asyncHandler(async (req, res) => {
  await paymentsService.removeSettlement(req.club.id, Number(req.params.id), req.user.id, req.authContext);
  return ApiResponse.ok(res, null, 'Transferencia eliminada correctamente.');
});

module.exports = {
  dashboard,
  listForMember,
  chargeMatrix,
  ensureInstance,
  listForInstance,
  create,
  update,
  remove,
  exemptInstance,
  unexemptInstance,
  exemptMany,
  listSettlements,
  createSettlement,
  updateSettlement,
  removeSettlement,
};
