const asyncHandler = require('../helpers/asyncHandler');
const ApiResponse = require('../helpers/ApiResponse');
const clubSetupService = require('../services/clubSetup.service');
const dashboardService = require('../services/dashboard.service');
const dashboardWidgetsService = require('../services/dashboardWidgets.service');
const auditRepository = require('../repositories/audit.repository');

/** Datos de un widget del dashboard personalizable (cada tipo valida su propio permiso). */
const widget = asyncHandler(async (req, res) => {
  const data = await dashboardWidgetsService.get(req.params.type, req.club.id, req.authContext, req.user.id, req.query);
  return ApiResponse.ok(res, data, 'Widget obtenido correctamente.');
});

/** Diseño predeterminado que el club dejó para alguno de los roles del usuario. */
const defaultLayout = asyncHandler(async (req, res) => {
  const data = await dashboardWidgetsService.defaultLayoutFor(req.club.id, req.user.id);
  return ApiResponse.ok(res, data, 'Diseño predeterminado obtenido.');
});

const layoutDefaults = asyncHandler(async (req, res) => {
  const roleIds = await dashboardWidgetsService.defaultsSummary(req.club.id);
  return ApiResponse.ok(res, { roleIds }, 'Diseños predeterminados obtenidos.');
});

/** Deja (o quita, con `layout: null`) un diseño como predeterminado de uno o más roles. */
const setLayoutDefaults = asyncHandler(async (req, res) => {
  const roleIds = (Array.isArray(req.body?.roleIds) ? req.body.roleIds : []).map(Number).filter(Boolean);
  const result = await dashboardWidgetsService.setDefaultLayout(req.club.id, roleIds, req.body?.layout ?? null);
  await auditRepository.logAction({
    userId: req.user.id,
    clubId: req.club.id,
    action: 'DASHBOARD_DEFAULT_UPDATED',
    entityType: 'club',
    entityId: req.club.id,
    changes: { roles: roleIds, cleared: !req.body?.layout },
  });
  return ApiResponse.ok(res, { roleIds: result }, 'Diseño predeterminado guardado.');
});

const setupChecklist = asyncHandler(async (req, res) => {
  const data = await clubSetupService.checklist(req.club.id);
  return ApiResponse.ok(res, data, 'Primeros pasos obtenidos correctamente.');
});

const dismissSetup = asyncHandler(async (req, res) => {
  const data = await clubSetupService.setDismissed(req.club.id, req.body?.dismissed !== false);
  return ApiResponse.ok(res, data, 'Preferencia guardada.');
});

const overview = asyncHandler(async (req, res) => {
  const data = await dashboardService.getOverview(req.club.id, req.authContext);
  return ApiResponse.ok(res, data, 'Resumen del dashboard obtenido correctamente.');
});

const auditLogs = asyncHandler(async (req, res) => {
  const { items, meta } = await dashboardService.getAuditLogs(req.club.id, req.query, req.authContext.isSuperAdmin);
  return ApiResponse.paginated(res, items, meta, 'Registro de auditoría obtenido correctamente.');
});

const auditLogFilters = asyncHandler(async (req, res) => {
  const data = await dashboardService.getAuditLogFilters(req.club.id);
  return ApiResponse.ok(res, data, 'Filtros de auditoría obtenidos correctamente.');
});

module.exports = {
  setupChecklist,
  dismissSetup, overview, auditLogs, auditLogFilters, widget, defaultLayout, layoutDefaults, setLayoutDefaults };
