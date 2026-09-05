const asyncHandler = require('../helpers/asyncHandler');
const AppError = require('../helpers/AppError');
const permissionService = require('../services/permission.service');
const chargesService = require('../services/charges.service');

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

/**
 * Como `requireFunction`, pero además deja pasar a quien NO tiene ninguna de las funcionalidades
 * pedidas si está vinculado a un miembro (`members.user_id`) que es responsable de al menos un
 * cobro en este club — el típico caso de un entrenador sin ningún rol administrativo, solo
 * dueño de la ficha que junta la plata de su categoría. Es un chequeo GRUESO a propósito (solo
 * "¿tiene ALGÚN cobro a su cargo?", no "¿puede ver ESTE cobro puntual?"): la barrera fina, por
 * cobro específico, la resuelve el service correspondiente (ver
 * payments.service.js#_resolveChargeParticipants/assertChargeMemberPaymentAccessible), igual que
 * ya pasa con el scope de pagos por rol. Nunca reemplaza las funcionalidades reales — un
 * responsable así solo puede VER y REGISTRAR PAGOS de SU cobro, nunca editar/eliminar/archivar
 * (esas rutas siguen usando `requireFunction` normal, sin este bypass).
 */
function requireFunctionOrResponsibleCharge(...functionCodes) {
  return asyncHandler(async (req, res, next) => {
    if (!req.user) throw AppError.unauthorized('No autenticado.');

    const clubId = req.club ? req.club.id : null;
    const authContext = await permissionService.buildAuthorizationContext(req.user.id, clubId);
    req.authContext = authContext;

    if (permissionService.hasAnyFunction(authContext, functionCodes)) return next();

    const isResponsible = clubId ? await chargesService.actorHasAnyResponsibleCharge(clubId, req.user.id) : false;
    if (!isResponsible) throw AppError.forbidden('No tienes permiso para realizar esta acción.');

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

module.exports = { requireFunction, requireFunctionOrResponsibleCharge, requireGlobalRole };
