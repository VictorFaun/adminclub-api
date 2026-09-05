const router = require('express').Router();
const controller = require('../controllers/charges.controller');
const validation = require('../validations/charges.validation');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { clubContextMiddleware } = require('../middlewares/club.middleware');
const { requireFunction, requireFunctionOrResponsibleCharge } = require('../middlewares/permission.middleware');
const { FUNCTIONS } = require('../config/constants');

router.use(authMiddleware, clubContextMiddleware);

// Además de VIEW_CHARGES, deja pasar a quien es responsable de algún cobro (ver
// charges.service.js#listForClub, que ahí le devuelve SOLO esos, no el catálogo completo) — es lo
// que arma los tabs de "Pagos" para alguien sin ningún rol administrativo.
router.get('/', requireFunctionOrResponsibleCharge(FUNCTIONS.VIEW_CHARGES), controller.list);

// ANTES de '/:id' — si no, Express la tomaría como el parámetro (mismo caso que 'roles/new' antes
// de 'roles/:id' en el frontend).
router.get('/archived', requireFunction(FUNCTIONS.VIEW_CHARGES), controller.listArchived);

router.get('/:id', requireFunction(FUNCTIONS.VIEW_CHARGES), validation.chargeId, handleValidation, controller.getById);

// CHARGE_CREATED se registra en charges.service.js#create (con el id real), no acá.
router.post('/', requireFunction(FUNCTIONS.CREATE_CHARGES), sanitizeBody, validation.createCharge, handleValidation, controller.create);

router.put(
  '/:id',
  requireFunction(FUNCTIONS.EDIT_CHARGES),
  sanitizeBody,
  validation.updateCharge,
  handleValidation,
  controller.update
);

router.delete('/:id', requireFunction(FUNCTIONS.DELETE_CHARGES), validation.chargeId, handleValidation, controller.remove);

router.put('/:id/archive', requireFunction(FUNCTIONS.EDIT_CHARGES), validation.chargeId, handleValidation, controller.archive);

router.put('/:id/restore', requireFunction(FUNCTIONS.EDIT_CHARGES), validation.chargeId, handleValidation, controller.restore);

module.exports = router;
