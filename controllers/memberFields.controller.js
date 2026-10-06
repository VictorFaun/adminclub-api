const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const memberFieldsService = require('../services/memberFields.service');

const list = asyncHandler(async (req, res) => {
  const items = await memberFieldsService.listForClub(req.club.id);
  return ApiResponse.ok(res, items, 'Campos de la ficha obtenidos correctamente.');
});

const catalog = asyncHandler(async (req, res) => ApiResponse.ok(res, memberFieldsService.catalog(), 'Catálogo obtenido correctamente.'));

const create = asyncHandler(async (req, res) => {
  const field = await memberFieldsService.create(req.club.id, req.body, req.user.id);
  return ApiResponse.created(res, field, 'Campo creado correctamente.');
});

const update = asyncHandler(async (req, res) => {
  const field = await memberFieldsService.update(req.club.id, Number(req.params.id), req.body, req.user.id);
  return ApiResponse.ok(res, field, 'Campo actualizado correctamente.');
});

const reorder = asyncHandler(async (req, res) => {
  const items = await memberFieldsService.reorder(req.club.id, req.body.ids, req.user.id);
  return ApiResponse.ok(res, items, 'Orden actualizado correctamente.');
});

const addSuggested = asyncHandler(async (req, res) => {
  const data = await memberFieldsService.addSuggested(req.club.id, req.user.id);
  return ApiResponse.ok(res, data, data.added ? `Se agregaron ${data.added} campos sugeridos.` : 'La ficha ya tiene todos los campos sugeridos.');
});

const remove = asyncHandler(async (req, res) => {
  await memberFieldsService.remove(req.club.id, Number(req.params.id), req.user.id);
  return ApiResponse.ok(res, null, 'Campo eliminado correctamente.');
});

module.exports = { list, catalog, create, update, reorder, addSuggested, remove };
