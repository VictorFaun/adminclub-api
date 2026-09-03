/**
 * Error de aplicación con statusCode HTTP semántico.
 * Todo error de negocio lanzado desde services/repositories debe ser una AppError
 * para que error.middleware.js lo traduzca a una respuesta consistente.
 */
class AppError extends Error {
  constructor(message, statusCode = 400, details = null) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = 'Solicitud inválida.', details = null) {
    return new AppError(message, 400, details);
  }

  static unauthorized(message = 'No autenticado.') {
    return new AppError(message, 401);
  }

  static forbidden(message = 'No autorizado.') {
    return new AppError(message, 403);
  }

  static notFound(message = 'Recurso no encontrado.') {
    return new AppError(message, 404);
  }

  static conflict(message = 'Conflicto con el estado actual del recurso.') {
    return new AppError(message, 409);
  }

  static unprocessable(message = 'No se pudo procesar la solicitud.', details = null) {
    return new AppError(message, 422, details);
  }

  static tooManyRequests(message = 'Demasiadas solicitudes. Intenta más tarde.') {
    return new AppError(message, 429);
  }

  static internal(message = 'Error interno del servidor.') {
    return new AppError(message, 500);
  }
}

module.exports = AppError;
