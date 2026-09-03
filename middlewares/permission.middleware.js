const asyncHandler = require('../helpers/asyncHandler');
const AppError = require('../helpers/AppError');
const permissionService = require('../services/permission.service');

/**
 * Middleware factory: exige que el usuario autenticado (y club activo, si aplica)
 * tenga al menos una de las funcionalidades indicadas. Debe ir después de
 * authMiddleware (y clubContextMiddleware si la ruta depende de un club).
 * @param {...string} functionCodes
 */
function requireFunction(...functionCodes) {
  return asyncHandler(async (req, res, next) => {
    if (!req.user) throw AppError.unauthorized('No autenticado.');

    const clubId = req.club ? req.club.id : null;
    const authContext = await permissionService.buildAuthorizationContext(req.user.id, clubId);
    req.authContext = authContext;

    const allowed = permissionService.hasAnyFunction(authContext, functionCodes);
    if (!allowed) {
      throw AppError.forbidden('No tienes permiso para realizar esta acción.');
    }

    next();
  });
}

/** Exige que el usuario tenga alguno de los roles globales indicados (Super Admin, Developer, Support). */
function requireGlobalRole(...roleNames) {
  return asyncHandler(async (req, res, next) => {
    if (!req.user) throw AppError.unauthorized('No autenticado.');
    const globalRoleCodes = await permissionService.getGlobalRoleCodes(req.user.id);
    const allowed = roleNames.some((role) => globalRoleCodes.includes(role));
    if (!allowed) throw AppError.forbidden('Esta acción requiere un rol de plataforma autorizado.');
    req.globalRoles = globalRoleCodes;
    next();
  });
}

module.exports = { requireFunction, requireGlobalRole };
