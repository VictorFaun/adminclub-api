const asyncHandler = require('../helpers/asyncHandler');
const AppError = require('../helpers/AppError');
const permissionService = require('../services/permission.service');
const chargesService = require('../services/charges.service');
const trainingsService = require('../services/trainings.service');

/**
 * Bloquea CUALQUIER acción real en el club mientras la membresía tenga
 * `requires_profile_completion` (invitación configurada para exigir completar la ficha de
 * miembro antes de operar — ver clubs.service.js#joinByCode e invitations.service.js). Vive acá
 * (no en clubContextMiddleware) porque TODO endpoint protegido pasa por `requireFunction`/
 * `requireFunctionOrResponsibleCharge` (checklist de módulo nuevo en api/CLAUDE.md), así que un
 * solo chequeo acá cubre todos los módulos presentes y futuros sin tocar el resto de la cadena
 * de autorización. La única excepción real es `POST /members/me` (autoservicio de ficha), que
 * deliberadamente NO usa ninguna de estas dos funciones. `req.membership` solo existe para un
 * miembro activo real (no aplica al modo "solo lectura" de VIEW_ALL_CLUBS/Super Admin).
 */
function assertProfileNotPending(req) {
  if (req.membership?.requires_profile_completion) {
    throw AppError.forbidden('Debes completar tu ficha de miembro antes de continuar.', { code: 'PROFILE_REQUIRED' });
  }
}

/**
 * Middleware factory: exige que el usuario autenticado (y club activo, si aplica)
 * tenga al menos una de las funcionalidades indicadas. Debe ir después de
 * authMiddleware (y clubContextMiddleware si la ruta depende de un club).
 * @param {...string} functionCodes
 */
function requireFunction(...functionCodes) {
  return asyncHandler(async (req, res, next) => {
    if (!req.user) throw AppError.unauthorized('No autenticado.');
    assertProfileNotPending(req);

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
    assertProfileNotPending(req);

    const clubId = req.club ? req.club.id : null;
    const authContext = await permissionService.buildAuthorizationContext(req.user.id, clubId);
    req.authContext = authContext;

    if (permissionService.hasAnyFunction(authContext, functionCodes)) return next();

    const isResponsible = clubId ? await chargesService.actorHasAnyResponsibleCharge(clubId, req.user.id) : false;
    if (!isResponsible) throw AppError.forbidden('No tienes permiso para realizar esta acción.');

    next();
  });
}

/** Mismo patrón EXACTO que `requireFunctionOrResponsibleCharge`, para "Entrenamientos" — deja
 * pasar a quien está vinculado a un miembro responsable (entrenador) de al menos un
 * entrenamiento en este club. Igual chequeo grueso a propósito: la barrera fina por
 * entrenamiento/miembro puntual vive en trainingAttendance.service.js. */
function requireFunctionOrResponsibleTraining(...functionCodes) {
  return asyncHandler(async (req, res, next) => {
    if (!req.user) throw AppError.unauthorized('No autenticado.');
    assertProfileNotPending(req);

    const clubId = req.club ? req.club.id : null;
    const authContext = await permissionService.buildAuthorizationContext(req.user.id, clubId);
    req.authContext = authContext;

    if (permissionService.hasAnyFunction(authContext, functionCodes)) return next();

    const isResponsible = clubId ? await trainingsService.actorHasAnyResponsibleTraining(clubId, req.user.id) : false;
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

module.exports = { requireFunction, requireFunctionOrResponsibleCharge, requireFunctionOrResponsibleTraining, requireGlobalRole };
