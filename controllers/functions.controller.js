const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const functionsService = require('../services/functions.service');

const list = asyncHandler(async (req, res) => {
  const data = await functionsService.listGrouped();
  return ApiResponse.ok(res, data, 'Funcionalidades obtenidas correctamente.');
});

const listAll = asyncHandler(async (req, res) => {
  const data = await functionsService.listAllGrouped();
  return ApiResponse.ok(res, data, 'Catálogo completo de funcionalidades obtenido correctamente.');
});

module.exports = { list, listAll };
