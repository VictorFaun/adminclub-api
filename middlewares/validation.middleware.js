const { validationResult } = require('express-validator');
const AppError = require('../helpers/AppError');
const { sanitizeValue } = require('../utils/sanitize');

/** Sanitiza recursivamente `req.body` contra XSS antes de cualquier validación/lógica. */
function sanitizeBody(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeValue(req.body);
  }
  next();
}

/**
 * Ejecuta los resultados de express-validator y corta la request con 422
 * si hay errores, devolviendo el detalle campo a campo.
 */
function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const details = errors.array().map((e) => ({ field: e.path, message: e.msg }));
    return next(AppError.unprocessable('Los datos enviados no son válidos.', details));
  }
  next();
}

module.exports = { sanitizeBody, handleValidation };
