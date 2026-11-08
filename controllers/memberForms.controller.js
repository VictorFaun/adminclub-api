const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const memberFormsService = require('../services/memberForms.service');

const id = (req) => Number(req.params.id);

const list = asyncHandler(async (req, res) => ApiResponse.ok(res, await memberFormsService.list(req.club.id), 'Fichas obtenidas correctamente.'));

const create = asyncHandler(async (req, res) => {
  const form = await memberFormsService.create(req.club.id, req.body, req.user.id);
  return ApiResponse.created(res, form, 'Ficha creada correctamente.');
});

const update = asyncHandler(async (req, res) => {
  const form = await memberFormsService.update(req.club.id, id(req), req.body, req.user.id);
  return ApiResponse.ok(res, form, 'Ficha actualizada correctamente.');
});

const remove = asyncHandler(async (req, res) => {
  await memberFormsService.remove(req.club.id, id(req), req.user.id);
  return ApiResponse.ok(res, null, 'Ficha eliminada correctamente.');
});

const setFields = asyncHandler(async (req, res) => {
  const form = await memberFormsService.setFields(req.club.id, id(req), req.body.fieldIds, req.user.id);
  return ApiResponse.ok(res, form, 'Campos de la ficha actualizados correctamente.');
});

const members = asyncHandler(async (req, res) => ApiResponse.ok(res, await memberFormsService.members(req.club.id, id(req)), 'Miembros obtenidos correctamente.'));

const assign = asyncHandler(async (req, res) => {
  const data = await memberFormsService.assign(req.club.id, id(req), req.body, req.user.id);
  return ApiResponse.ok(res, data, data.added ? `Ficha asignada a ${data.added} miembro(s).` : 'Esos miembros ya tenían la ficha.');
});

const unassign = asyncHandler(async (req, res) => {
  const data = await memberFormsService.unassign(req.club.id, id(req), req.body, req.user.id);
  return ApiResponse.ok(res, data, 'Ficha quitada correctamente.');
});

module.exports = { list, create, update, remove, setFields, members, assign, unassign };
