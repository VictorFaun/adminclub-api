const router = require('express').Router();
const controller = require('../controllers/expenses.controller');
const paymentsController = require('../controllers/expensePayments.controller');
const validation = require('../validations/expenses.validation');
const paymentsValidation = require('../validations/expensePayments.validation');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { clubContextMiddleware } = require('../middlewares/club.middleware');
const { requireFunction } = require('../middlewares/permission.middleware');
const { FUNCTIONS } = require('../config/constants');

router.use(authMiddleware, clubContextMiddleware);

router.get('/', requireFunction(FUNCTIONS.VIEW_EXPENSES), controller.list);

// ANTES de '/:id' — mismo motivo que charges.routes.js#/archived (Express tomaría 'archived' como
// el parámetro si no).
router.get('/archived', requireFunction(FUNCTIONS.VIEW_EXPENSES), controller.listArchived);

router.get('/:id', requireFunction(FUNCTIONS.VIEW_EXPENSES), validation.expenseId, handleValidation, controller.getById);

router.post('/', requireFunction(FUNCTIONS.CREATE_EXPENSES), sanitizeBody, validation.createExpense, handleValidation, controller.create);

router.put('/:id', requireFunction(FUNCTIONS.EDIT_EXPENSES), sanitizeBody, validation.updateExpense, handleValidation, controller.update);

router.delete('/:id', requireFunction(FUNCTIONS.DELETE_EXPENSES), validation.expenseId, handleValidation, controller.remove);

router.put('/:id/archive', requireFunction(FUNCTIONS.EDIT_EXPENSES), validation.expenseId, handleValidation, controller.archive);

router.put('/:id/restore', requireFunction(FUNCTIONS.EDIT_EXPENSES), validation.expenseId, handleValidation, controller.restore);

// --- Períodos y pagos de un gasto (mirror simplificado, sin dimensión de miembro, de las rutas
// anidadas bajo /payments/charges/:chargeId/... en payments.routes.js) ---

router.get(
  '/:expenseId/periods',
  requireFunction(FUNCTIONS.VIEW_EXPENSES),
  paymentsValidation.periods,
  handleValidation,
  paymentsController.periods
);

router.post(
  '/:expenseId/instances',
  requireFunction(FUNCTIONS.EDIT_EXPENSES),
  sanitizeBody,
  paymentsValidation.ensureInstance,
  handleValidation,
  paymentsController.ensureInstance
);

router.get(
  '/instances/:instanceId/payments',
  requireFunction(FUNCTIONS.VIEW_EXPENSES),
  paymentsValidation.instanceIdParam,
  handleValidation,
  paymentsController.listForInstance
);

// EXPENSE_PAYMENT_CREATED se registra en expensePayments.service.js#create (con el id real).
router.post(
  '/payments',
  requireFunction(FUNCTIONS.EDIT_EXPENSES),
  sanitizeBody,
  paymentsValidation.createPayment,
  handleValidation,
  paymentsController.create
);

router.put(
  '/payments/:id',
  requireFunction(FUNCTIONS.EDIT_EXPENSES),
  sanitizeBody,
  paymentsValidation.updatePayment,
  handleValidation,
  paymentsController.update
);

router.delete(
  '/payments/:id',
  requireFunction(FUNCTIONS.EDIT_EXPENSES),
  paymentsValidation.paymentId,
  handleValidation,
  paymentsController.remove
);

module.exports = router;
