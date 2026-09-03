const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const clubsService = require('../services/clubs.service');
const clubsRepository = require('../repositories/clubs.repository');
const { toAbsoluteMediaUrl, deleteUploadedFile } = require('../helpers/mediaUrl');

const listPublic = asyncHandler(async (req, res) => {
  const { items, meta } = await clubsService.listPublic(req.query);
  return ApiResponse.paginated(res, items, meta, 'Clubes públicos obtenidos correctamente.');
});

const listAll = asyncHandler(async (req, res) => {
  const { items, meta } = await clubsService.listAll(req.query);
  return ApiResponse.paginated(res, items, meta, 'Clubes obtenidos correctamente.');
});

const create = asyncHandler(async (req, res) => {
  const club = await clubsService.create(req.body, req.user.id);
  return ApiResponse.created(res, club, 'Club creado correctamente.');
});

const getById = asyncHandler(async (req, res) => {
  return ApiResponse.ok(res, clubsService.toDto(req.club), 'Club obtenido correctamente.');
});

const update = asyncHandler(async (req, res) => {
  const club = await clubsService.update(req.club.id, req.body, req.user.id);
  return ApiResponse.ok(res, club, 'Club actualizado correctamente.');
});

const remove = asyncHandler(async (req, res) => {
  await clubsService.remove(req.club.id, req.user.id);
  return ApiResponse.ok(res, null, 'Club eliminado correctamente.');
});

const uploadLogo = asyncHandler(async (req, res) => {
  if (!req.file) return ApiResponse.ok(res, null, 'No se recibió ningún archivo.');
  // Se guarda la ruta relativa en la BD (portable entre entornos) y se responde
  // con la URL absoluta (el frontend puede correr en un puerto distinto al de la API).
  const logoUrl = `/uploads/logos/${req.file.filename}`;
  await clubsRepository.updateById(req.club.id, { logo_url: logoUrl });
  deleteUploadedFile(req.club.logo_url);
  return ApiResponse.ok(res, { logoUrl: toAbsoluteMediaUrl(logoUrl) }, 'Logo actualizado correctamente.');
});

const uploadBanner = asyncHandler(async (req, res) => {
  if (!req.file) return ApiResponse.ok(res, null, 'No se recibió ningún archivo.');
  const bannerUrl = `/uploads/banners/${req.file.filename}`;
  await clubsRepository.updateById(req.club.id, { banner_url: bannerUrl });
  deleteUploadedFile(req.club.banner_url);
  return ApiResponse.ok(res, { bannerUrl: toAbsoluteMediaUrl(bannerUrl) }, 'Banner actualizado correctamente.');
});

const regenerateInviteCode = asyncHandler(async (req, res) => {
  const inviteCode = await clubsService.regenerateInviteCode(req.club.id, req.user.id);
  return ApiResponse.ok(res, { inviteCode }, 'Código de invitación regenerado correctamente.');
});

const stats = asyncHandler(async (req, res) => {
  const data = await clubsService.getStats(req.club.id);
  return ApiResponse.ok(res, data, 'Estadísticas del club obtenidas correctamente.');
});

const joinByCode = asyncHandler(async (req, res) => {
  const club = await clubsService.joinByCode(req.body.code, req.user.id);
  return ApiResponse.ok(res, club, 'Te has unido al club correctamente.');
});

const requestAccess = asyncHandler(async (req, res) => {
  const result = await clubsService.requestAccess(req.club.id, req.user.id, req.body.message);
  return ApiResponse.created(res, result, 'Solicitud de acceso enviada correctamente.');
});

const listJoinRequests = asyncHandler(async (req, res) => {
  const { items, meta } = await clubsService.listJoinRequests(req.club.id, req.query);
  return ApiResponse.paginated(res, items, meta, 'Solicitudes de acceso obtenidas correctamente.');
});

const resolveJoinRequest = asyncHandler(async (req, res) => {
  await clubsService.resolveJoinRequest(req.club.id, Number(req.params.requestId), req.body.status, req.user.id);
  return ApiResponse.ok(res, null, 'Solicitud resuelta correctamente.');
});

const getSettings = asyncHandler(async (req, res) => {
  const settings = await clubsService.getSettings(req.club.id);
  return ApiResponse.ok(res, settings, 'Configuración obtenida correctamente.');
});

const updateSettings = asyncHandler(async (req, res) => {
  const settings = await clubsService.updateSettings(req.club.id, req.body.settings, req.user.id);
  return ApiResponse.ok(res, settings, 'Configuración actualizada correctamente.');
});

module.exports = {
  listPublic,
  listAll,
  create,
  getById,
  update,
  remove,
  uploadLogo,
  uploadBanner,
  regenerateInviteCode,
  stats,
  joinByCode,
  requestAccess,
  listJoinRequests,
  resolveJoinRequest,
  getSettings,
  updateSettings,
};
