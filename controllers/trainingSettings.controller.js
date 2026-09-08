const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const trainingSettingsService = require('../services/trainingSettings.service');

const getStatusColors = asyncHandler(async (req, res) => {
  const colors = await trainingSettingsService.getStatusColors(req.club.id);
  return ApiResponse.ok(res, colors, 'Colores de estado obtenidos correctamente.');
});

const updateStatusColors = asyncHandler(async (req, res) => {
  const colors = await trainingSettingsService.updateStatusColors(req.club.id, req.body.colors, req.user.id);
  return ApiResponse.ok(res, colors, 'Colores de estado actualizados correctamente.');
});

module.exports = { getStatusColors, updateStatusColors };
