const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const publicPageService = require('../services/publicPage.service');

const getSettings = asyncHandler(async (req, res) => {
  return ApiResponse.ok(res, await publicPageService.getSettingsForAdmin(req.club.id), 'Configuración obtenida correctamente.');
});

const updateSettings = asyncHandler(async (req, res) => {
  const { enabled, treasury, attendance, formIds } = req.body;
  const data = await publicPageService.updateSettings(req.club.id, { enabled, treasury, attendance, formIds }, req.user.id, req.authContext);
  return ApiResponse.ok(res, data, 'Página pública actualizada.');
});

module.exports = { getSettings, updateSettings };
