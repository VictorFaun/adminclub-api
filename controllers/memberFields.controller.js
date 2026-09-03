const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const memberFieldsService = require('../services/memberFields.service');

const list = asyncHandler(async (req, res) => {
  const items = await memberFieldsService.listForClub(req.club.id);
  return ApiResponse.ok(res, items, 'Campos personalizados obtenidos correctamente.');
});

const create = asyncHandler(async (req, res) => {
  const field = await memberFieldsService.create(req.club.id, req.body, req.user.id);
  return ApiResponse.created(res, field, 'Campo personalizado creado correctamente.');
});

const update = asyncHandler(async (req, res) => {
  const field = await memberFieldsService.update(req.club.id, Number(req.params.id), req.body, req.user.id);
  return ApiResponse.ok(res, field, 'Campo personalizado actualizado correctamente.');
});

const remove = asyncHandler(async (req, res) => {
  await memberFieldsService.remove(req.club.id, Number(req.params.id), req.user.id);
  return ApiResponse.ok(res, null, 'Campo personalizado eliminado correctamente.');
});

module.exports = { list, create, update, remove };
