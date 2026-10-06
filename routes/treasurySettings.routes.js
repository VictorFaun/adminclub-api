const router = require('express').Router();
const { body } = require('express-validator');
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

// Cómo se cobra el mes de ingreso y de retiro de un miembro (cobros mensuales).
router.get('/month-policy', requireFunction(FUNCTIONS.VIEW_TREASURY_SETTINGS), controller.getMonthPolicy);
router.put(
  '/month-policy',
  requireFunction(FUNCTIONS.EDIT_TREASURY_SETTINGS),
  sanitizeBody,
  [body('join').isIn(['full', 'next', 'prorate']), body('leave').isIn(['full', 'none', 'prorate'])],
  handleValidation,
  controller.updateMonthPolicy
);

// Cuentas de Tesorería: lectura para quien crea/edita cobros o registra pagos (necesitan elegir o
// ver los datos de la cuenta); crear/editar/eliminar solo desde Configuración de Tesorería.
const ACCOUNT_READERS = [
  FUNCTIONS.VIEW_TREASURY_SETTINGS,
  FUNCTIONS.VIEW_TREASURY_DASHBOARD,
  FUNCTIONS.VIEW_CHARGES,
  FUNCTIONS.CREATE_CHARGES,
  FUNCTIONS.EDIT_CHARGES,
  FUNCTIONS.VIEW_PAYMENTS,
  FUNCTIONS.VIEW_PAYMENTS_SCOPED,
  FUNCTIONS.VIEW_EXPENSES,
  FUNCTIONS.CREATE_EXPENSES,
  FUNCTIONS.EDIT_EXPENSES,
];
router.get('/accounts', requireFunction(...ACCOUNT_READERS), controller.listAccounts);
// Saldos por cuenta y transferencias entre cuentas (Configuración de Tesorería / dashboard).
router.get('/accounts/balances', requireFunction(FUNCTIONS.VIEW_TREASURY_SETTINGS, FUNCTIONS.VIEW_TREASURY_DASHBOARD), controller.accountBalances);
router.get('/accounts/transfers', requireFunction(FUNCTIONS.VIEW_TREASURY_SETTINGS), controller.listTransfers);
router.post('/accounts/transfers', requireFunction(FUNCTIONS.EDIT_TREASURY_SETTINGS), sanitizeBody, validation.createTransfer, handleValidation, controller.createTransfer);
router.post('/accounts', requireFunction(FUNCTIONS.EDIT_TREASURY_SETTINGS), sanitizeBody, validation.createAccount, handleValidation, controller.createAccount);
router.put('/accounts/:id', requireFunction(FUNCTIONS.EDIT_TREASURY_SETTINGS), sanitizeBody, validation.updateAccount, handleValidation, controller.updateAccount);
router.get('/accounts/:id/usage', requireFunction(FUNCTIONS.EDIT_TREASURY_SETTINGS), validation.accountId, handleValidation, controller.accountUsage);
router.delete('/accounts/:id', requireFunction(FUNCTIONS.EDIT_TREASURY_SETTINGS), sanitizeBody, validation.deleteAccount, handleValidation, controller.deleteAccount);

router.put(
  '/status-colors',
  requireFunction(FUNCTIONS.EDIT_TREASURY_SETTINGS),
  sanitizeBody,
  validation.updateStatusColors,
  handleValidation,
  controller.updateStatusColors
);

module.exports = router;
