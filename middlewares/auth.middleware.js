const asyncHandler = require('../helpers/asyncHandler');
const AppError = require('../helpers/AppError');
const { verifyAccessToken } = require('../helpers/tokenUtils');
const usersRepository = require('../repositories/users.repository');
const { USER_STATUS } = require('../config/constants');

function extractBearerToken(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme === 'Bearer' && token) return token;
  return null;
}

/**
 * Verifica el Access Token y adjunta `req.user` con el estado ACTUAL del usuario
 * (se relee de BD en cada request, así una suspensión aplica de inmediato,
 * sin esperar a que expire el token).
 */
const authMiddleware = asyncHandler(async (req, res, next) => {
  const token = extractBearerToken(req);
  if (!token) throw AppError.unauthorized('Token de acceso no proporcionado.');

  const payload = verifyAccessToken(token); // lanza TokenExpiredError / JsonWebTokenError -> error.middleware

  const user = await usersRepository.findById(payload.sub);
  if (!user || user.deleted_at) throw AppError.unauthorized('Usuario no encontrado.');
  if (user.status === USER_STATUS.SUSPENDED) throw AppError.forbidden('Tu cuenta ha sido suspendida.');
  if (user.status === USER_STATUS.BLOCKED) throw AppError.forbidden('Tu cuenta ha sido bloqueada.');

  req.user = {
    id: user.id,
    uuid: user.uuid,
    email: user.email,
    username: user.username,
    status: user.status,
    emailVerifiedAt: user.email_verified_at,
    defaultClubId: user.default_club_id,
  };
  req.tokenPayload = payload;
  next();
});

/** Variante que no lanza si no hay token: útil para endpoints públicos con comportamiento opcionalmente autenticado. */
const optionalAuthMiddleware = asyncHandler(async (req, res, next) => {
  const token = extractBearerToken(req);
  if (!token) return next();
  try {
    const payload = verifyAccessToken(token);
    const user = await usersRepository.findById(payload.sub);
    if (user && user.status === USER_STATUS.ACTIVE) {
      req.user = {
        id: user.id,
        uuid: user.uuid,
        email: user.email,
        username: user.username,
        status: user.status,
      };
    }
  } catch {
    // token opcional inválido -> continuar como anónimo
  }
  next();
});

module.exports = { authMiddleware, optionalAuthMiddleware, extractBearerToken };
