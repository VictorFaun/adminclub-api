const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const env = require('../config/env');

/**
 * Firma un Access Token de vida corta con el payload mínimo necesario.
 * Nunca incluir contraseñas ni datos sensibles en el payload (es solo Base64, no cifrado).
 */
function signAccessToken(payload) {
  return jwt.sign(payload, env.jwt.accessSecret, {
    expiresIn: env.jwt.accessExpiresIn,
    issuer: env.jwt.issuer,
  });
}

function signRefreshToken(payload) {
  return jwt.sign(payload, env.jwt.refreshSecret, {
    expiresIn: env.jwt.refreshExpiresIn,
    issuer: env.jwt.issuer,
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.accessSecret, { issuer: env.jwt.issuer });
}

function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwt.refreshSecret, { issuer: env.jwt.issuer });
}

/** Genera un token aleatorio criptográficamente seguro (verificación email, reset password, invitaciones). */
function generateRandomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/** Hash de un token de un solo uso antes de persistirlo (así la BD nunca guarda el valor en texto plano). */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Código corto legible para invitaciones / código público de club. */
function generateShortCode(length = 8) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin caracteres ambiguos
  let code = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i += 1) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  generateRandomToken,
  hashToken,
  generateShortCode,
};
