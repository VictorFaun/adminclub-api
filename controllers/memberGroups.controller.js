const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const memberGroupsService = require('../services/memberGroups.service');

const list = asyncHandler(async (req, res) => {
  const items = await memberGroupsService.listForClub(req.club.id);
  return ApiResponse.ok(res, items, 'Grupos obtenidos correctamente.');
});

const options = asyncHandler(async (req, res) => {
  const items = await memberGroupsService.findOptions(req.club.id);
  return ApiResponse.ok(res, items, 'Grupos obtenidos correctamente.');
});

const getById = asyncHandler(async (req, res) => {
  const group = await memberGroupsService.getById(req.club.id, Number(req.params.id));
  return ApiResponse.ok(res, group, 'Grupo obtenido correctamente.');
});

const create = asyncHandler(async (req, res) => {
  const group = await memberGroupsService.create(req.club.id, req.body, req.user.id);
  return ApiResponse.created(res, group, 'Grupo creado correctamente.');
});

const update = asyncHandler(async (req, res) => {
  const group = await memberGroupsService.update(req.club.id, Number(req.params.id), req.body, req.user.id);
  return ApiResponse.ok(res, group, 'Grupo actualizado correctamente.');
});

const remove = asyncHandler(async (req, res) => {
  await memberGroupsService.remove(req.club.id, Number(req.params.id), req.user.id);
  return ApiResponse.ok(res, null, 'Grupo eliminado correctamente.');
});

const listMembers = asyncHandler(async (req, res) => {
  const { items, meta } = await memberGroupsService.listMembers(req.club.id, Number(req.params.id), req.query);
  return ApiResponse.paginated(res, items, meta, 'Miembros del grupo obtenidos correctamente.');
});

const addMembers = asyncHandler(async (req, res) => {
  await memberGroupsService.addMembers(req.club.id, Number(req.params.id), req.body.memberIds, req.user.id);
  return ApiResponse.ok(res, null, 'Miembros agregados al grupo correctamente.');
});

const removeMember = asyncHandler(async (req, res) => {
  await memberGroupsService.removeMember(req.club.id, Number(req.params.id), Number(req.params.memberId), req.user.id);
  return ApiResponse.ok(res, null, 'Miembro quitado del grupo correctamente.');
});

module.exports = { list, options, getById, create, update, remove, listMembers, addMembers, removeMember };
