const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const permissionService = require('../services/permission.service');

/** Devuelve el contexto de autorización (roles + funcionalidades) del usuario autenticado. */
const me = asyncHandler(async (req, res) => {
  const clubId = Number(req.headers['x-club-id']) || null;
  const authorization = await permissionService.buildAuthorizationContext(req.user.id, clubId);
  return ApiResponse.ok(res, authorization, 'Permisos obtenidos correctamente.');
});

module.exports = { me };
