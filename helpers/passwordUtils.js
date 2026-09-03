const bcrypt = require('bcrypt');
const env = require('../config/env');

async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, env.security.bcryptSaltRounds);
}

async function comparePassword(plainPassword, passwordHash) {
  return bcrypt.compare(plainPassword, passwordHash);
}

/**
 * Política mínima de contraseña fuerte, validada también en frontend
 * pero SIEMPRE reforzada aquí porque el backend nunca confía en el cliente.
 */
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,72}$/;

function isStrongPassword(password) {
  return typeof password === 'string' && PASSWORD_REGEX.test(password);
}

module.exports = { hashPassword, comparePassword, isStrongPassword, PASSWORD_REGEX };
