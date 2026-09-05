const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const membersService = require('../services/members.service');
const paymentsService = require('../services/payments.service');
const permissionService = require('../services/permission.service');
const { FUNCTIONS } = require('../config/constants');

/** Agrega `canViewPayments` a uno o varios miembros ya resueltos por membersService — vive acá
 * (no en members.service.js) para evitar un ciclo de imports: payments.service.js ya depende de
 * members.service.js (para revalidar visibilidad de perfil), así que members.service.js no
 * puede depender de vuelta de payments.service.js. Sin VIEW_PAYMENTS/VIEW_PAYMENTS_SCOPED, el
 * flag es `false` para todos sin ninguna query extra. */
async function attachCanViewPayments(members, clubId, actorId, authContext) {
  const hasAny = permissionService.hasAnyFunction(authContext, [FUNCTIONS.VIEW_PAYMENTS, FUNCTIONS.VIEW_PAYMENTS_SCOPED]);
  if (!hasAny) return members.map((m) => ({ ...m, canViewPayments: false }));

  const access = await paymentsService.resolveAccessForController(authContext, actorId, clubId);
  return members.map((m) => ({ ...m, canViewPayments: access.full || access.memberIds.includes(m.id) }));
}

const list = asyncHandler(async (req, res) => {
  const { items, meta } = await membersService.listForClub(req.club.id, req.query, req.authContext, req.user.id);
  const withPayments = await attachCanViewPayments(items, req.club.id, req.user.id, req.authContext);
  return ApiResponse.paginated(res, withPayments, meta, 'Miembros obtenidos correctamente.');
});

const options = asyncHandler(async (req, res) => {
  const items = await membersService.findOptions(req.club.id);
  return ApiResponse.ok(res, items, 'Miembros obtenidos correctamente.');
});

const dashboard = asyncHandler(async (req, res) => {
  const data = await membersService.getDashboard(req.club.id, req.authContext, req.user.id);
  return ApiResponse.ok(res, data, 'Resumen de miembros obtenido correctamente.');
});

const getById = asyncHandler(async (req, res) => {
  const member = await membersService.getById(req.club.id, Number(req.params.id), req.authContext, req.user.id);
  const [withPayments] = await attachCanViewPayments([member], req.club.id, req.user.id, req.authContext);
  return ApiResponse.ok(res, withPayments, 'Miembro obtenido correctamente.');
});

// MEMBER_CREATED se registra en members.service.js#create (con el id real), no acá.
const create = asyncHandler(async (req, res) => {
  const member = await membersService.create(req.club.id, req.body, req.user.id);
  return ApiResponse.created(res, member, 'Miembro creado correctamente.');
});

const update = asyncHandler(async (req, res) => {
  const member = await membersService.update(req.club.id, Number(req.params.id), req.body, req.user.id, req.authContext);
  return ApiResponse.ok(res, member, 'Miembro actualizado correctamente.');
});

const remove = asyncHandler(async (req, res) => {
  await membersService.remove(req.club.id, Number(req.params.id), req.user.id, req.authContext);
  return ApiResponse.ok(res, null, 'Miembro eliminado correctamente.');
});

const linkUser = asyncHandler(async (req, res) => {
  const member = await membersService.linkUser(req.club.id, Number(req.params.id), req.body.userId || null, req.user.id, req.authContext);
  return ApiResponse.ok(res, member, req.body.userId ? 'Cuenta vinculada correctamente.' : 'Cuenta desvinculada correctamente.');
});

module.exports = { list, options, dashboard, getById, create, update, remove, linkUser };
