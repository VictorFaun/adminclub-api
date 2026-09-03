const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const invitationsService = require('../services/invitations.service');

const list = asyncHandler(async (req, res) => {
  const { items, meta } = await invitationsService.listForClub(req.club.id, req.query);
  return ApiResponse.paginated(res, items, meta, 'Invitaciones obtenidas correctamente.');
});

const create = asyncHandler(async (req, res) => {
  const invitation = await invitationsService.create(req.club.id, req.body, req.user.id);
  return ApiResponse.created(res, invitation, 'Invitación creada correctamente.');
});

const revoke = asyncHandler(async (req, res) => {
  await invitationsService.revoke(req.club.id, Number(req.params.id), req.user.id);
  return ApiResponse.ok(res, null, 'Invitación revocada correctamente.');
});

module.exports = { list, create, revoke };
