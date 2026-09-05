const router = require('express').Router();
const controller = require('../controllers/treasurySettings.controller');
const validation = require('../validations/treasurySettings.validation');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { clubContextMiddleware } = require('../middlewares/club.middleware');
const { requireFunction } = require('../middlewares/permission.middleware');
const { FUNCTIONS } = require('../config/constants');

router.use(authMiddleware, clubContextMiddleware);

// Lectura abierta a cualquiera de las funcionalidades de Tesorería (no solo
// VIEW_TREASURY_SETTINGS): la matriz de estado, el dashboard y la ficha de pagos de un miembro
// necesitan estos colores para pintarse aunque el actor no tenga acceso a la vista de
// configuración en sí — esa se gatea aparte, a nivel de ruta, en el frontend.
router.get(
  '/status-colors',
  requireFunction(
    FUNCTIONS.VIEW_TREASURY_SETTINGS,
    FUNCTIONS.VIEW_TREASURY_DASHBOARD,
    FUNCTIONS.VIEW_CHARGES,
    FUNCTIONS.VIEW_PAYMENTS,
    FUNCTIONS.VIEW_PAYMENTS_SCOPED
  ),
  controller.getStatusColors
);

router.put(
  '/status-colors',
  requireFunction(FUNCTIONS.EDIT_TREASURY_SETTINGS),
  sanitizeBody,
  validation.updateStatusColors,
  handleValidation,
  controller.updateStatusColors
);

module.exports = router;
