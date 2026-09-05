const router = require('express').Router();
const controller = require('../controllers/payments.controller');
const validation = require('../validations/payments.validation');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { clubContextMiddleware } = require('../middlewares/club.middleware');
const { requireFunction, requireFunctionOrResponsibleCharge } = require('../middlewares/permission.middleware');
const { FUNCTIONS } = require('../config/constants');

router.use(authMiddleware, clubContextMiddleware);

router.get('/dashboard', requireFunction(FUNCTIONS.VIEW_TREASURY_DASHBOARD), controller.dashboard);

router.get(
  '/members/:memberId',
  requireFunction(FUNCTIONS.VIEW_PAYMENTS, FUNCTIONS.VIEW_PAYMENTS_SCOPED),
  validation.memberIdParam,
  handleValidation,
  controller.listForMember
);

// Matriz miembro×período de UN cobro — mismo par de funcionalidades que listForMember (es la
// misma información, "quién debe qué", solo agrupada por cobro en vez de por miembro). Además,
// deja pasar a quien es responsable de ESTE cobro puntual (ver
// payments.service.js#_resolveChargeParticipants, que hace el chequeo fino por cobro — acá solo
// se exige tener ALGÚN cobro a cargo, ver requireFunctionOrResponsibleCharge).
router.get(
  '/charges/:chargeId/matrix',
  requireFunctionOrResponsibleCharge(FUNCTIONS.VIEW_PAYMENTS, FUNCTIONS.VIEW_PAYMENTS_SCOPED),
  validation.chargeMatrix,
  handleValidation,
  controller.chargeMatrix
);

// Crea (si no existe) la instancia de un período puntual — disparado al interactuar con una
// celda vacía de la matriz "Pagos" (antes de poder pagarla o eximirla hace falta que exista).
// Cualquiera de las dos funcionalidades de acción sobre pagos habilita esto, además de ser
// responsable del cobro (ver nota de la matriz arriba).
router.post(
  '/charges/:chargeId/members/:memberId/instances',
  requireFunctionOrResponsibleCharge(FUNCTIONS.CREATE_PAYMENTS, FUNCTIONS.EXEMPT_PAYMENTS),
  sanitizeBody,
  validation.ensureInstance,
  handleValidation,
  controller.ensureInstance
);

// Todos los pagos que tocan UN período (puede haber varios abonos) — mismo par de
// funcionalidades que listForMember/chargeMatrix, es la misma información de lectura (+
// responsable del cobro, ver nota de la matriz arriba).
router.get(
  '/instances/:instanceId/payments',
  requireFunctionOrResponsibleCharge(FUNCTIONS.VIEW_PAYMENTS, FUNCTIONS.VIEW_PAYMENTS_SCOPED),
  validation.instanceIdParam,
  handleValidation,
  controller.listForInstance
);

// PAYMENT_CREATED se registra en payments.service.js#create (con el id real), no acá. Además de
// CREATE_PAYMENTS, deja pasar a quien es responsable del cobro al que pertenece el período que
// está pagando (chequeo fino en payments.service.js#create, vía assertChargeMemberPaymentAccessible).
router.post('/', requireFunctionOrResponsibleCharge(FUNCTIONS.CREATE_PAYMENTS), sanitizeBody, validation.createPayment, handleValidation, controller.create);

router.put('/:id', requireFunction(FUNCTIONS.EDIT_PAYMENTS), sanitizeBody, validation.updatePayment, handleValidation, controller.update);

router.delete('/:id', requireFunction(FUNCTIONS.DELETE_PAYMENTS), validation.paymentId, handleValidation, controller.remove);

router.put(
  '/instances/:instanceId/exempt',
  requireFunction(FUNCTIONS.EXEMPT_PAYMENTS),
  sanitizeBody,
  validation.exemptInstance,
  handleValidation,
  controller.exemptInstance
);

router.put(
  '/instances/:instanceId/unexempt',
  requireFunction(FUNCTIONS.EXEMPT_PAYMENTS),
  validation.instanceIdParam,
  handleValidation,
  controller.unexemptInstance
);

// Transferencias del responsable de un cobro a Tesorería ("Total a pagar" en la matriz) — mismas
// funcionalidades que los pagos normales, ver payments.service.js#_computeSettlements. El
// responsable del cobro además puede registrar/ver SU PROPIA transferencia sin tener ninguna de
// las dos (es literalmente la persona a la que se refiere el settlement, ver
// payments.service.js#listSettlements/createSettlement).
router.get(
  '/charges/:chargeId/settlements/:periodKey',
  requireFunctionOrResponsibleCharge(FUNCTIONS.VIEW_PAYMENTS, FUNCTIONS.VIEW_PAYMENTS_SCOPED),
  validation.listSettlements,
  handleValidation,
  controller.listSettlements
);

router.post(
  '/charges/:chargeId/settlements',
  requireFunctionOrResponsibleCharge(FUNCTIONS.CREATE_PAYMENTS),
  sanitizeBody,
  validation.createSettlement,
  handleValidation,
  controller.createSettlement
);

router.put(
  '/settlements/:id',
  requireFunction(FUNCTIONS.EDIT_PAYMENTS),
  sanitizeBody,
  validation.updateSettlement,
  handleValidation,
  controller.updateSettlement
);

router.delete(
  '/settlements/:id',
  requireFunction(FUNCTIONS.DELETE_PAYMENTS),
  validation.settlementId,
  handleValidation,
  controller.removeSettlement
);

module.exports = router;
