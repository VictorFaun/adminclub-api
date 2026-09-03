const router = require('express').Router();
const controller = require('../controllers/platformSettings.controller');
const validation = require('../validations/platformSettings.validation');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { requireFunction } = require('../middlewares/permission.middleware');
const { FUNCTIONS } = require('../config/constants');

/**
 * Configuración global de la plataforma (fila única, sin club activo) — hoy solo la zona
 * horaria en la que se muestran fechas/horas en toda la app. Mismo patrón que
 * GET /functions/all (VIEW_ALL_FUNCTIONS): requiere autenticación pero no club activo.
 */
router.use(authMiddleware);

router.get('/', requireFunction(FUNCTIONS.VIEW_PLATFORM_SETTINGS), controller.get);
router.put(
  '/',
  requireFunction(FUNCTIONS.EDIT_PLATFORM_SETTINGS),
  sanitizeBody,
  validation.update,
  handleValidation,
  controller.update
);

module.exports = router;
