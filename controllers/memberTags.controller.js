const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const memberTagsService = require('../services/memberTags.service');

const list = asyncHandler(async (req, res) => {
  const items = await memberTagsService.listForClub(req.club.id);
  return ApiResponse.ok(res, items, 'Etiquetas obtenidas correctamente.');
});

const options = asyncHandler(async (req, res) => {
  const items = await memberTagsService.findOptions(req.club.id);
  return ApiResponse.ok(res, items, 'Etiquetas obtenidas correctamente.');
});

const getById = asyncHandler(async (req, res) => {
  const tag = await memberTagsService.getById(req.club.id, Number(req.params.id));
  return ApiResponse.ok(res, tag, 'Etiqueta obtenida correctamente.');
});

const create = asyncHandler(async (req, res) => {
  const tag = await memberTagsService.create(req.club.id, req.body, req.user.id);
  return ApiResponse.created(res, tag, 'Etiqueta creada correctamente.');
});

const update = asyncHandler(async (req, res) => {
  const tag = await memberTagsService.update(req.club.id, Number(req.params.id), req.body, req.user.id);
  return ApiResponse.ok(res, tag, 'Etiqueta actualizada correctamente.');
});

const remove = asyncHandler(async (req, res) => {
  await memberTagsService.remove(req.club.id, Number(req.params.id), req.user.id);
  return ApiResponse.ok(res, null, 'Etiqueta eliminada correctamente.');
});

const listMembers = asyncHandler(async (req, res) => {
  const { items, meta } = await memberTagsService.listMembers(req.club.id, Number(req.params.id), req.query);
  return ApiResponse.paginated(res, items, meta, 'Miembros de la etiqueta obtenidos correctamente.');
});

const addMembers = asyncHandler(async (req, res) => {
  await memberTagsService.addMembers(req.club.id, Number(req.params.id), req.body.memberIds, req.user.id);
  return ApiResponse.ok(res, null, 'Miembros agregados a la etiqueta correctamente.');
});

const removeMember = asyncHandler(async (req, res) => {
  await memberTagsService.removeMember(req.club.id, Number(req.params.id), Number(req.params.memberId), req.user.id);
  return ApiResponse.ok(res, null, 'Miembro quitado de la etiqueta correctamente.');
});

module.exports = { list, options, getById, create, update, remove, listMembers, addMembers, removeMember };
