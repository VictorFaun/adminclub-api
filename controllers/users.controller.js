const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const usersService = require('../services/users.service');
const usersRepository = require('../repositories/users.repository');
const { toAbsoluteMediaUrl, deleteUploadedFile } = require('../helpers/mediaUrl');

const list = asyncHandler(async (req, res) => {
  const { items, meta } = await usersService.listForClub(req.club.id, req.query);
  return ApiResponse.paginated(res, items, meta, 'Usuarios obtenidos correctamente.');
});

const create = asyncHandler(async (req, res) => {
  const user = await usersService.createInClub(req.club.id, req.body, req.user.id);
  return ApiResponse.created(res, user, 'Usuario creado correctamente.');
});

const lookupByEmail = asyncHandler(async (req, res) => {
  const result = await usersService.lookupByEmail(req.club.id, req.query.email, req.user.id);
  return ApiResponse.ok(res, result, 'Búsqueda completada.');
});

const addExisting = asyncHandler(async (req, res) => {
  const user = await usersService.addExistingUserToClub(req.club.id, Number(req.params.id), req.body.roleIds, req.user.id);
  return ApiResponse.created(res, user, 'Usuario agregado al club correctamente.');
});

const getById = asyncHandler(async (req, res) => {
  const user = await usersService.getDetail(Number(req.params.id), req.club.id);
  return ApiResponse.ok(res, user, 'Usuario obtenido correctamente.');
});

const update = asyncHandler(async (req, res) => {
  const user = await usersService.update(Number(req.params.id), req.club.id, req.body, req.user.id);
  return ApiResponse.ok(res, user, 'Usuario actualizado correctamente.');
});

const updateStatus = asyncHandler(async (req, res) => {
  const user = await usersService.updateStatusInClub(Number(req.params.id), req.club.id, req.body.status, req.user.id);
  return ApiResponse.ok(res, user, 'Estado del usuario actualizado correctamente.');
});

const remove = asyncHandler(async (req, res) => {
  await usersService.removeFromClub(Number(req.params.id), req.club.id, req.user.id);
  return ApiResponse.ok(res, null, 'Usuario eliminado del club correctamente.');
});

const updateRoles = asyncHandler(async (req, res) => {
  const user = await usersService.updateRolesInClub(Number(req.params.id), req.club.id, req.body.roleIds, req.user.id);
  return ApiResponse.ok(res, user, 'Roles del usuario actualizados correctamente.');
});

const activity = asyncHandler(async (req, res) => {
  const rows = await usersService.getActivity(Number(req.params.id), req.club.id);
  return ApiResponse.ok(res, rows, 'Actividad del usuario obtenida correctamente.');
});

const listAllPlatform = asyncHandler(async (req, res) => {
  const { items, meta } = await usersService.listAllPlatform(req.query);
  return ApiResponse.paginated(res, items, meta, 'Usuarios obtenidos correctamente.');
});

const updateGlobal = asyncHandler(async (req, res) => {
  const user = await usersService.updateGlobal(Number(req.params.id), req.body, req.user.id);
  return ApiResponse.ok(res, user, 'Usuario actualizado correctamente.');
});

const updateStatusGlobal = asyncHandler(async (req, res) => {
  const user = await usersService.updateStatusGlobal(Number(req.params.id), req.body.status, req.user.id);
  return ApiResponse.ok(res, user, 'Estado del usuario actualizado correctamente.');
});

const me = asyncHandler(async (req, res) => {
  const clubId = Number(req.headers['x-club-id']) || null;
  const user = await usersService.getDetail(req.user.id, clubId);
  return ApiResponse.ok(res, user, 'Perfil obtenido correctamente.');
});

const updateMe = asyncHandler(async (req, res) => {
  const clubId = Number(req.headers['x-club-id']) || null;
  const updates = {};
  if (req.body.username !== undefined) updates.username = req.body.username;
  if (req.body.phone !== undefined) updates.phone = req.body.phone;
  if (Object.keys(updates).length) await usersRepository.updateById(req.user.id, updates);
  const user = await usersService.getDetail(req.user.id, clubId);
  return ApiResponse.ok(res, user, 'Perfil actualizado correctamente.');
});

const updateMyAvatar = asyncHandler(async (req, res) => {
  if (!req.file) return ApiResponse.ok(res, null, 'No se recibió ningún archivo.');
  const previousUser = await usersRepository.findById(req.user.id);
  const avatarUrl = `/uploads/avatars/${req.file.filename}`;
  await usersRepository.updateById(req.user.id, { avatar_url: avatarUrl });
  deleteUploadedFile(previousUser?.avatar_url);
  return ApiResponse.ok(res, { avatarUrl: toAbsoluteMediaUrl(avatarUrl) }, 'Foto de perfil actualizada correctamente.');
});

module.exports = {
  list,
  create,
  lookupByEmail,
  addExisting,
  getById,
  update,
  updateStatus,
  remove,
  updateRoles,
  activity,
  me,
  updateMe,
  updateMyAvatar,
  listAllPlatform,
  updateGlobal,
  updateStatusGlobal,
};
