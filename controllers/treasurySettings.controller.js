const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const treasurySettingsService = require('../services/treasurySettings.service');

const getStatusColors = asyncHandler(async (req, res) => {
  const colors = await treasurySettingsService.getStatusColors(req.club.id);
  return ApiResponse.ok(res, colors, 'Colores de estado obtenidos correctamente.');
});

const updateStatusColors = asyncHandler(async (req, res) => {
  const colors = await treasurySettingsService.updateStatusColors(req.club.id, req.body.colors, req.user.id);
  return ApiResponse.ok(res, colors, 'Colores de estado actualizados correctamente.');
});

module.exports = { getStatusColors, updateStatusColors };
