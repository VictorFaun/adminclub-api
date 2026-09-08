const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const authService = require('../services/auth.service');
const usersRepository = require('../repositories/users.repository');
const env = require('../config/env');

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.cookies.secure,
  sameSite: env.cookies.secure ? 'none' : 'lax',
  domain: env.cookies.domain,
  path: `${env.apiPrefix}/auth`,
};

function setRefreshCookie(res, token) {
  res.cookie(env.cookies.refreshCookieName, token, REFRESH_COOKIE_OPTIONS);
}

function clearRefreshCookie(res) {
  res.clearCookie(env.cookies.refreshCookieName, REFRESH_COOKIE_OPTIONS);
}

function getRefreshTokenFromRequest(req) {
  return req.cookies?.[env.cookies.refreshCookieName] || req.body?.refreshToken || null;
}

const register = asyncHandler(async (req, res) => {
  const user = await authService.register(req.body);
  return ApiResponse.created(res, user, 'Registro exitoso. Revisa tu correo para verificar tu cuenta.');
});

const login = asyncHandler(async (req, res) => {
  const result = await authService.login({
    ...req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  setRefreshCookie(res, result.refreshToken);
  return ApiResponse.ok(res, result, 'Sesión iniciada correctamente.');
});

const loginWithGoogle = asyncHandler(async (req, res) => {
  const result = await authService.loginWithGoogle({
    idToken: req.body.idToken,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  setRefreshCookie(res, result.refreshToken);
  return ApiResponse.ok(res, result, 'Sesión iniciada correctamente.');
});

const refresh = asyncHandler(async (req, res) => {
  const refreshToken = getRefreshTokenFromRequest(req);
  const result = await authService.refresh({
    refreshToken,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  setRefreshCookie(res, result.refreshToken);
  return ApiResponse.ok(res, result, 'Token renovado correctamente.');
});

const logout = asyncHandler(async (req, res) => {
  const refreshToken = getRefreshTokenFromRequest(req);
  await authService.logout({ refreshToken });
  clearRefreshCookie(res);
  return ApiResponse.ok(res, null, 'Sesión cerrada correctamente.');
});

const logoutAll = asyncHandler(async (req, res) => {
  await authService.logoutAll(req.user.id);
  clearRefreshCookie(res);
  return ApiResponse.ok(res, null, 'Todas las sesiones fueron cerradas.');
});

const forgotPassword = asyncHandler(async (req, res) => {
  await authService.forgotPassword(req.body.email);
  return ApiResponse.ok(res, null, 'Si el correo existe, recibirás instrucciones para restablecer tu contraseña.');
});

const resetPassword = asyncHandler(async (req, res) => {
  await authService.resetPassword(req.body);
  return ApiResponse.ok(res, null, 'Contraseña restablecida correctamente. Ya puedes iniciar sesión.');
});

const verifyEmail = asyncHandler(async (req, res) => {
  await authService.verifyEmail(req.body.token);
  return ApiResponse.ok(res, null, 'Correo verificado correctamente.');
});

const resendVerification = asyncHandler(async (req, res) => {
  const user = await usersRepository.findById(req.user.id);
  await authService.requestEmailVerification(user);
  return ApiResponse.ok(res, null, 'Correo de verificación reenviado.');
});

const me = asyncHandler(async (req, res) => {
  const clubId = Number(req.headers['x-club-id']) || null;
  const context = await authService.getContext(req.user.id, clubId);
  return ApiResponse.ok(res, context, 'Contexto de usuario obtenido correctamente.');
});

const changePassword = asyncHandler(async (req, res) => {
  await authService.changePassword({
    userId: req.user.id,
    currentPassword: req.body.currentPassword,
    newPassword: req.body.newPassword,
  });
  return ApiResponse.ok(res, null, 'Contraseña actualizada correctamente.');
});

const setDefaultClub = asyncHandler(async (req, res) => {
  await authService.setDefaultClub(req.user.id, req.body.clubId);
  return ApiResponse.ok(res, null, 'Club predeterminado actualizado.');
});

module.exports = {
  register,
  login,
  loginWithGoogle,
  refresh,
  logout,
  logoutAll,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
  me,
  changePassword,
  setDefaultClub,
};
