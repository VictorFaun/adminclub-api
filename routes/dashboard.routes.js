const router = require('express').Router();
const controller = require('../controllers/dashboard.controller');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { clubContextMiddleware } = require('../middlewares/club.middleware');
const { requireFunction } = require('../middlewares/permission.middleware');
const { FUNCTIONS } = require('../config/constants');

router.use(authMiddleware, clubContextMiddleware);

router.get('/', requireFunction(FUNCTIONS.VIEW_DASHBOARD), controller.overview);
// Primeros pasos del club (checklist de configuración) — para quien administra el club.
router.get('/setup', requireFunction(FUNCTIONS.EDIT_CLUB, FUNCTIONS.MANAGE_SETTINGS), controller.setupChecklist);
router.put('/setup', requireFunction(FUNCTIONS.EDIT_CLUB, FUNCTIONS.MANAGE_SETTINGS), controller.dismissSetup);
router.get('/audit-logs', requireFunction(FUNCTIONS.VIEW_AUDIT_LOGS), controller.auditLogs);
// Dashboard personalizable: datos por widget (cada tipo exige su propio permiso en el servicio)
// y diseño predeterminado por rol (lo define quien administra el club).
router.get(
  '/widgets/:type',
  requireFunction(FUNCTIONS.VIEW_DASHBOARD, FUNCTIONS.VIEW_MEMBERS_DASHBOARD, FUNCTIONS.VIEW_TREASURY_DASHBOARD, FUNCTIONS.VIEW_ATTENDANCE, FUNCTIONS.VIEW_ATTENDANCE_SCOPED, FUNCTIONS.VIEW_TRAININGS),
  controller.widget
);
router.get(
  '/layout/default',
  requireFunction(FUNCTIONS.VIEW_DASHBOARD, FUNCTIONS.VIEW_MEMBERS_DASHBOARD, FUNCTIONS.VIEW_TREASURY_DASHBOARD, FUNCTIONS.VIEW_ATTENDANCE, FUNCTIONS.VIEW_ATTENDANCE_SCOPED, FUNCTIONS.VIEW_TRAININGS),
  controller.defaultLayout
);
router.get('/layout/defaults', requireFunction(FUNCTIONS.EDIT_CLUB, FUNCTIONS.MANAGE_SETTINGS), controller.layoutDefaults);
router.put('/layout/defaults', requireFunction(FUNCTIONS.EDIT_CLUB, FUNCTIONS.MANAGE_SETTINGS), controller.setLayoutDefaults);
router.get('/audit-logs/filters', requireFunction(FUNCTIONS.VIEW_AUDIT_LOGS), controller.auditLogFilters);

module.exports = router;
