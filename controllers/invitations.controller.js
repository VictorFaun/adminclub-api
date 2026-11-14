const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const invitationsService = require('../services/invitations.service');
const invitationFormSettingsService = require('../services/invitationFormSettings.service');

const list = asyncHandler(async (req, res) => {
  const { items, meta } = await invitationsService.listForClub(req.club.id, req.query);
  return ApiResponse.paginated(res, items, meta, 'Invitaciones obtenidas correctamente.');
});

const create = asyncHandler(async (req, res) => {
  const invitation = await invitationsService.create(req.club.id, req.body, req.user.id);
  return ApiResponse.created(res, invitation, 'Invitación creada correctamente.');
});

const update = asyncHandler(async (req, res) => {
  const invitation = await invitationsService.update(req.club.id, Number(req.params.id), req.body, req.user.id);
  return ApiResponse.ok(res, invitation, 'Invitación actualizada correctamente.');
});

const revoke = asyncHandler(async (req, res) => {
  await invitationsService.revoke(req.club.id, Number(req.params.id), req.user.id);
  return ApiResponse.ok(res, null, 'Invitación revocada correctamente.');
});

const reactivate = asyncHandler(async (req, res) => {
  await invitationsService.reactivate(req.club.id, Number(req.params.id), req.user.id);
  return ApiResponse.ok(res, null, 'Invitación reactivada correctamente.');
});

const remove = asyncHandler(async (req, res) => {
  await invitationsService.remove(req.club.id, Number(req.params.id), req.user.id);
  return ApiResponse.ok(res, null, 'Invitación eliminada correctamente.');
});

/** Categorías y consentimientos para elegir en el modal de la invitación. */
const getById = asyncHandler(async (req, res) => {
  const data = await invitationsService.getById(req.club.id, Number(req.params.id));
  return ApiResponse.ok(res, data, 'Invitación obtenida correctamente.');
});

const formOptions = asyncHandler(async (req, res) => {
  return ApiResponse.ok(res, await invitationFormSettingsService.options(req.club.id), 'Opciones obtenidas correctamente.');
});

module.exports = { getById, formOptions, list, create, update, revoke, reactivate, remove };
