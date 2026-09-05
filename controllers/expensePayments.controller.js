const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const expensePaymentsService = require('../services/expensePayments.service');

const periods = asyncHandler(async (req, res) => {
  const data = await expensePaymentsService.getPeriods(req.club.id, Number(req.params.expenseId), {
    anchor: req.query.anchor,
    columns: req.query.columns ? Number(req.query.columns) : undefined,
  });
  return ApiResponse.ok(res, data, 'Períodos del gasto obtenidos correctamente.');
});

const ensureInstance = asyncHandler(async (req, res) => {
  const data = await expensePaymentsService.ensureInstance(req.club.id, Number(req.params.expenseId), req.body.periodKey);
  return ApiResponse.ok(res, data, 'Período preparado correctamente.');
});

const listForInstance = asyncHandler(async (req, res) => {
  const data = await expensePaymentsService.listForInstance(req.club.id, Number(req.params.instanceId));
  return ApiResponse.ok(res, data, 'Pagos del período obtenidos correctamente.');
});

// EXPENSE_PAYMENT_CREATED se registra en expensePayments.service.js#create (con el id real).
const create = asyncHandler(async (req, res) => {
  const payment = await expensePaymentsService.create(req.club.id, req.body, req.user.id);
  return ApiResponse.created(res, payment, 'Pago registrado correctamente.');
});

const update = asyncHandler(async (req, res) => {
  const payment = await expensePaymentsService.update(req.club.id, Number(req.params.id), req.body, req.user.id);
  return ApiResponse.ok(res, payment, 'Pago actualizado correctamente.');
});

const remove = asyncHandler(async (req, res) => {
  await expensePaymentsService.remove(req.club.id, Number(req.params.id), req.user.id);
  return ApiResponse.ok(res, null, 'Pago eliminado correctamente.');
});

module.exports = { periods, ensureInstance, listForInstance, create, update, remove };
