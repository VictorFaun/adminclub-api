const router = require('express').Router();
const { body } = require('express-validator');
const controller = require('../controllers/clubs.controller');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { clubContextMiddleware } = require('../middlewares/club.middleware');
const { requireFunction } = require('../middlewares/permission.middleware');
const { FUNCTIONS } = require('../config/constants');

/**
 * Configuración general (clave/valor) del club activo (header X-Club-Id).
 * Complementa a clubs.routes.js, que gestiona los datos "core" del club
 * (nombre, colores, logo, banner, tema).
 */
router.use(authMiddleware, clubContextMiddleware);

router.get('/', requireFunction(FUNCTIONS.MANAGE_SETTINGS), controller.getSettings);
router.put(
  '/',
  requireFunction(FUNCTIONS.MANAGE_SETTINGS),
  sanitizeBody,
  body('settings').isObject().withMessage('settings debe ser un objeto.'),
  handleValidation,
  controller.updateSettings
);

// "Mi club": qué ven los socios de sí mismos (el socio lee los interruptores por GET /me/club).
const meController = require('../controllers/me.controller');
const meValidation = require('../validations/me.validation');
router.get('/self-service', requireFunction(FUNCTIONS.MANAGE_SETTINGS), meController.getSettings);
router.put('/self-service', requireFunction(FUNCTIONS.MANAGE_SETTINGS), sanitizeBody, meValidation.updateSettings, handleValidation, meController.updateSettings);

module.exports = router;
