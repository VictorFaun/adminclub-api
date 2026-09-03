const asyncHandler = require('../helpers/asyncHandler');
const AppError = require('../helpers/AppError');
const clubsRepository = require('../repositories/clubs.repository');
const usersRepository = require('../repositories/users.repository');
const functionsRepository = require('../repositories/functions.repository');
const permissionService = require('../services/permission.service');
const { CLUB_STATUS, USER_CLUB_STATUS } = require('../config/constants');

/**
 * Resuelve el club activo de la request (header `X-Club-Id` o :clubId de ruta),
 * valida que el club exista/esté activo y que el usuario autenticado sea miembro
 * activo de él — o, si no lo es, que tenga VIEW_ALL_CLUBS (o sea Super Admin), en
 * cuyo caso entra igual pero en modo de solo lectura: `permissionService.buildAuthorizationContext`
 * recorta sus funciones a VIEW_* para este club específico, sin importar el acceso
 * implícito total que Super Admin tendría normalmente.
 * Debe ejecutarse SIEMPRE después de `authMiddleware`.
 */
const clubContextMiddleware = asyncHandler(async (req, res, next) => {
  const clubId = Number(req.params.clubId || req.headers['x-club-id']);
  if (!clubId) throw AppError.badRequest('Debes especificar un club (header X-Club-Id).');

  const club = await clubsRepository.findActiveById(clubId);
  if (!club) throw AppError.notFound('Club no encontrado.');
  if (club.status !== CLUB_STATUS.ACTIVE) throw AppError.forbidden('Este club no está activo.');

  const membership = await usersRepository.findMembership(req.user.id, clubId);
  const isActiveMember = !!membership && membership.status === USER_CLUB_STATUS.ACTIVE;

  if (isActiveMember) {
    req.membership = membership;
  } else {
    const globalRoleCodes = await permissionService.getGlobalRoleCodes(req.user.id);
    const isSuperAdmin = permissionService.isSuperAdmin(globalRoleCodes);
    const globalFunctionCodes = await functionsRepository.findGlobalPermissionCodes(req.user.id);
    const canBrowseReadOnly = isSuperAdmin || globalFunctionCodes.includes('VIEW_ALL_CLUBS');
    if (!canBrowseReadOnly) {
      throw AppError.forbidden('No perteneces a este club o tu acceso no está activo.');
    }
  }

  req.club = club;
  next();
});

/**
 * Carga el club de :clubId en req.club SIN exigir membresía activa.
 * Uso: acciones públicas sobre un club (solicitar acceso, ver ficha pública).
 */
const loadClubMiddleware = asyncHandler(async (req, res, next) => {
  const clubId = Number(req.params.clubId);
  if (!clubId) throw AppError.badRequest('Club inválido.');

  const club = await clubsRepository.findActiveById(clubId);
  if (!club) throw AppError.notFound('Club no encontrado.');

  req.club = club;
  next();
});

module.exports = { clubContextMiddleware, loadClubMiddleware };
