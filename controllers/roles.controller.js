const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const rolesService = require('../services/roles.service');

const list = asyncHandler(async (req, res) => {
  const roles = await rolesService.listForClub(req.club.id);
  return ApiResponse.ok(res, roles, 'Roles obtenidos correctamente.');
});

const getById = asyncHandler(async (req, res) => {
  const role = await rolesService.getById(Number(req.params.id), req.club.id);
  return ApiResponse.ok(res, role, 'Rol obtenido correctamente.');
});

const create = asyncHandler(async (req, res) => {
  const role = await rolesService.create(req.club.id, req.body, req.user.id);
  return ApiResponse.created(res, role, 'Rol creado correctamente.');
});

const addSuggested = asyncHandler(async (req, res) => {
  const data = await rolesService.addSuggested(req.club.id, req.user.id);
  return ApiResponse.ok(res, data, data.added.length ? `Se agregaron: ${data.added.join(', ')}.` : 'El club ya tiene todos los roles sugeridos.');
});

const update = asyncHandler(async (req, res) => {
  const role = await rolesService.update(Number(req.params.id), req.club.id, req.body, req.user.id);
  return ApiResponse.ok(res, role, 'Rol actualizado correctamente.');
});

const remove = asyncHandler(async (req, res) => {
  await rolesService.remove(Number(req.params.id), req.club.id, req.user.id);
  return ApiResponse.ok(res, null, 'Rol eliminado correctamente.');
});

const duplicate = asyncHandler(async (req, res) => {
  const role = await rolesService.duplicate(Number(req.params.id), req.club.id, req.user.id);
  return ApiResponse.created(res, role, 'Rol duplicado correctamente.');
});

module.exports = { list, getById, create, update, remove, duplicate, addSuggested };
