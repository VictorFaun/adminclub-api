const router = require('express').Router();
const controller = require('../controllers/paymentProofs.controller');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { param, query, body } = require('express-validator');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { clubContextMiddleware } = require('../middlewares/club.middleware');
const { requireFunction } = require('../middlewares/permission.middleware');
const { FUNCTIONS } = require('../config/constants');

router.use(authMiddleware, clubContextMiddleware);

const proofId = [param('id').isInt({ min: 1 }).withMessage('Identificador de comprobante inválido.')];
const VIEW = [FUNCTIONS.VIEW_PAYMENTS, FUNCTIONS.VIEW_PAYMENTS_SCOPED];

router.get(
  '/',
  requireFunction(...VIEW),
  [
    query('status').optional().isIn(['pending', 'approved', 'rejected']),
    query('groupId').optional().isInt({ min: 1 }),
    query('chargeId').optional().isInt({ min: 1 }),
    query('search').optional().isString().isLength({ max: 100 }),
    query('from').optional().isISO8601({ strict: true }).withMessage('Fecha "desde" inválida.'),
    query('to').optional().isISO8601({ strict: true }).withMessage('Fecha "hasta" inválida.'),
  ],
  handleValidation,
  controller.list
);
router.get('/filter-options', requireFunction(...VIEW), controller.filterOptions);
router.get('/pending-count', requireFunction(...VIEW), controller.pendingCount);
router.get('/:id/file', requireFunction(...VIEW), proofId, handleValidation, controller.file);

router.post(
  '/:id/approve',
  requireFunction(FUNCTIONS.CREATE_PAYMENTS),
  sanitizeBody,
  [...proofId, body('amount').optional({ nullable: true }).isFloat({ gt: 0 })],
  handleValidation,
  controller.approve
);
router.post(
  '/:id/reject',
  requireFunction(FUNCTIONS.CREATE_PAYMENTS),
  sanitizeBody,
  [...proofId, body('reason').optional({ nullable: true }).trim().isLength({ max: 255 })],
  handleValidation,
  controller.reject
);

// Página pública de pagos del club: activar/desactivar (lo que se ve es `/pay/<código-del-club>`).
router.get('/settings', requireFunction(FUNCTIONS.VIEW_TREASURY_SETTINGS), controller.publicPaymentsSetting);
router.put(
  '/settings',
  requireFunction(FUNCTIONS.EDIT_TREASURY_SETTINGS),
  sanitizeBody,
  [body('enabled').isBoolean().toBoolean()],
  handleValidation,
  controller.updatePublicPaymentsSetting
);

module.exports = router;
