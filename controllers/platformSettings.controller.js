const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const platformSettingsService = require('../services/platformSettings.service');

const get = asyncHandler(async (req, res) => {
  const data = await platformSettingsService.get();
  return ApiResponse.ok(res, data, 'Configuración de plataforma obtenida correctamente.');
});

const update = asyncHandler(async (req, res) => {
  const data = await platformSettingsService.updateTimezone(req.body.timezone, req.user.id);
  return ApiResponse.ok(res, data, 'Configuración de plataforma actualizada correctamente.');
});

module.exports = { get, update };
