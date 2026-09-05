const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const expenseCategoriesService = require('../services/expenseCategories.service');

const list = asyncHandler(async (req, res) => {
  const items = await expenseCategoriesService.listForClub(req.club.id);
  return ApiResponse.ok(res, items, 'Categorías de gastos obtenidas correctamente.');
});

const create = asyncHandler(async (req, res) => {
  const category = await expenseCategoriesService.create(req.club.id, req.body, req.user.id);
  return ApiResponse.created(res, category, 'Categoría creada correctamente.');
});

const update = asyncHandler(async (req, res) => {
  const category = await expenseCategoriesService.update(req.club.id, Number(req.params.id), req.body, req.user.id);
  return ApiResponse.ok(res, category, 'Categoría actualizada correctamente.');
});

const remove = asyncHandler(async (req, res) => {
  await expenseCategoriesService.remove(req.club.id, Number(req.params.id), req.user.id);
  return ApiResponse.ok(res, null, 'Categoría eliminada correctamente.');
});

module.exports = { list, create, update, remove };
