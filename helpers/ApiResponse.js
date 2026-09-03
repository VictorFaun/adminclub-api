/**
 * Envoltorio estándar de respuesta exitosa para toda la API.
 * { success, message, data, meta? }
 */
class ApiResponse {
  static send(res, { statusCode = 200, message = 'Operación realizada correctamente.', data = null, meta = null }) {
    const body = { success: true, message, data };
    if (meta) body.meta = meta;
    return res.status(statusCode).json(body);
  }

  static ok(res, data, message) {
    return ApiResponse.send(res, { statusCode: 200, message, data });
  }

  static created(res, data, message = 'Recurso creado correctamente.') {
    return ApiResponse.send(res, { statusCode: 201, message, data });
  }

  static noContent(res, message = 'Operación realizada correctamente.') {
    return ApiResponse.send(res, { statusCode: 200, message, data: null });
  }

  static paginated(res, items, pagination, message) {
    return ApiResponse.send(res, { statusCode: 200, message, data: items, meta: { pagination } });
  }
}

module.exports = ApiResponse;
