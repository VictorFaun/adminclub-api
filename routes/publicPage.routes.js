const router = require('express').Router();
const { body } = require('express-validator');
const controller = require('../controllers/publicPage.controller');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { clubContextMiddleware } = require('../middlewares/club.middleware');
const { requireFunction } = require('../middlewares/permission.middleware');
const { FUNCTIONS } = require('../config/constants');

// Configuración de la página pública del club (Configuración → Página pública). La ven y la cambian
// quienes administran el club o la configuración de Tesorería; elegir fichas además se revalida en
// el service (publicPage.service.js#updateSettings).
router.use(authMiddleware, clubContextMiddleware);
router.get('/settings', requireFunction(FUNCTIONS.EDIT_CLUB, FUNCTIONS.VIEW_TREASURY_SETTINGS), controller.getSettings);
router.put(
  '/settings',
  requireFunction(FUNCTIONS.EDIT_CLUB, FUNCTIONS.EDIT_TREASURY_SETTINGS),
  sanitizeBody,
  [
    body('enabled').optional().isBoolean().toBoolean(),
    body('treasury').optional().isBoolean().toBoolean(),
    body('attendance').optional().isBoolean().toBoolean(),
    body('formIds').optional().isArray({ max: 10 }),
    body('formIds.*').isInt({ min: 1 }).toInt(),
  ],
  handleValidation,
  controller.updateSettings
);

module.exports = router;
