const env = require('../config/env');
const logger = require('../helpers/logger');
const AppError = require('../helpers/AppError');

/** 404 para cualquier ruta no registrada. Debe ir después de todas las rutas. */
function notFoundMiddleware(req, res, next) {
  next(AppError.notFound(`Ruta no encontrada: ${req.method} ${req.originalUrl}`));
}

function mapKnownErrors(err) {
  if (err instanceof AppError) return err;

  // JWT
  if (err.name === 'TokenExpiredError') return AppError.unauthorized('La sesión ha expirado.');
  if (err.name === 'JsonWebTokenError') return AppError.unauthorized('Token inválido.');

  // MySQL
  if (err.code === 'ER_DUP_ENTRY') return AppError.conflict('El recurso ya existe (valor duplicado).');
  if (err.code === 'ER_NO_REFERENCED_ROW' || err.code === 'ER_NO_REFERENCED_ROW_2') {
    return AppError.badRequest('Referencia inválida: el recurso relacionado no existe.');
  }
  if (err.code === 'ER_ROW_IS_REFERENCED' || err.code === 'ER_ROW_IS_REFERENCED_2') {
    return AppError.conflict('No se puede eliminar: el recurso está siendo utilizado por otros registros.');
  }

  // Multer
  if (err.code === 'LIMIT_FILE_SIZE') return AppError.badRequest('El archivo excede el tamaño máximo permitido.');

  // CORS
  if (err.message === 'No permitido por la política de CORS') return AppError.forbidden('Origen no permitido.');

  return null;
}

/** Middleware de manejo de errores centralizado. Debe registrarse al final de la app. */
// eslint-disable-next-line no-unused-vars
function errorMiddleware(err, req, res, next) {
  const knownError = mapKnownErrors(err);
  const appError = knownError || err;

  const statusCode = appError.statusCode || 500;
  const isOperational = appError.isOperational === true;

  if (!isOperational || statusCode >= 500) {
    logger.error(err.message, { stack: err.stack, path: req.originalUrl, method: req.method });
  }

  const body = {
    success: false,
    message: isOperational ? appError.message : 'Error interno del servidor.',
  };

  if (appError.details) body.details = appError.details;
  if (!env.isProduction && !isOperational) body.stack = err.stack;

  res.status(statusCode).json(body);
}

module.exports = { notFoundMiddleware, errorMiddleware };
