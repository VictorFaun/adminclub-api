const router = require('express').Router();
const controller = require('../controllers/trainingSettings.controller');
const validation = require('../validations/trainingSettings.validation');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { clubContextMiddleware } = require('../middlewares/club.middleware');
const { requireFunction } = require('../middlewares/permission.middleware');
const { FUNCTIONS } = require('../config/constants');

router.use(authMiddleware, clubContextMiddleware);

// Lectura abierta a cualquiera de las funcionalidades de Entrenamientos (no solo
// VIEW_TRAINING_SETTINGS) — mismo criterio que treasurySettings.routes.js: la matriz y la ficha
// de un miembro necesitan estos colores aunque el actor no tenga acceso a la configuración en sí.
router.get(
  '/status-colors',
  requireFunction(
    FUNCTIONS.VIEW_TRAINING_SETTINGS,
    FUNCTIONS.VIEW_TRAININGS,
    FUNCTIONS.VIEW_ATTENDANCE,
    FUNCTIONS.VIEW_ATTENDANCE_SCOPED
  ),
  controller.getStatusColors
);

router.put(
  '/status-colors',
  requireFunction(FUNCTIONS.EDIT_TRAINING_SETTINGS),
  sanitizeBody,
  validation.updateStatusColors,
  handleValidation,
  controller.updateStatusColors
);

module.exports = router;
