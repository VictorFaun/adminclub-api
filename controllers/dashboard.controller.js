const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const dashboardService = require('../services/dashboard.service');

const overview = asyncHandler(async (req, res) => {
  const data = await dashboardService.getOverview(req.club.id);
  return ApiResponse.ok(res, data, 'Resumen del dashboard obtenido correctamente.');
});

const auditLogs = asyncHandler(async (req, res) => {
  const { items, meta } = await dashboardService.getAuditLogs(req.club.id, req.query, req.authContext.isSuperAdmin);
  return ApiResponse.paginated(res, items, meta, 'Registro de auditoría obtenido correctamente.');
});

module.exports = { overview, auditLogs };
