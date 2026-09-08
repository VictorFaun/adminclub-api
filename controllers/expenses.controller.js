const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const expensesService = require('../services/expenses.service');

const list = asyncHandler(async (req, res) => {
  const items = await expensesService.listForClub(req.club.id, req.query);
  return ApiResponse.ok(res, items, 'Gastos obtenidos correctamente.');
});

const listArchived = asyncHandler(async (req, res) => {
  const items = await expensesService.listArchivedForClub(req.club.id, req.query);
  return ApiResponse.ok(res, items, 'Gastos archivados obtenidos correctamente.');
});

const getById = asyncHandler(async (req, res) => {
  const expense = await expensesService.getById(req.club.id, Number(req.params.id));
  return ApiResponse.ok(res, expense, 'Gasto obtenido correctamente.');
});

const create = asyncHandler(async (req, res) => {
  const expense = await expensesService.create(req.club.id, req.body, req.user.id);
  return ApiResponse.created(res, expense, 'Gasto creado correctamente.');
});

const update = asyncHandler(async (req, res) => {
  const expense = await expensesService.update(req.club.id, Number(req.params.id), req.body, req.user.id);
  return ApiResponse.ok(res, expense, 'Gasto actualizado correctamente.');
});

const remove = asyncHandler(async (req, res) => {
  await expensesService.remove(req.club.id, Number(req.params.id), req.user.id);
  return ApiResponse.ok(res, null, 'Gasto eliminado correctamente.');
});

const archive = asyncHandler(async (req, res) => {
  const expense = await expensesService.archive(req.club.id, Number(req.params.id), req.user.id);
  return ApiResponse.ok(res, expense, 'Gasto archivado correctamente.');
});

const restore = asyncHandler(async (req, res) => {
  const expense = await expensesService.restore(req.club.id, Number(req.params.id), req.user.id);
  return ApiResponse.ok(res, expense, 'Gasto restaurado correctamente.');
});

module.exports = { list, listArchived, getById, create, update, remove, archive, restore };
