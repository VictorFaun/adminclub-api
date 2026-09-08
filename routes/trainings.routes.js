const router = require('express').Router();
const controller = require('../controllers/trainings.controller');
const validation = require('../validations/trainings.validation');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { clubContextMiddleware } = require('../middlewares/club.middleware');
const { requireFunction, requireFunctionOrResponsibleTraining } = require('../middlewares/permission.middleware');
const { FUNCTIONS } = require('../config/constants');

router.use(authMiddleware, clubContextMiddleware);

// Además de VIEW_TRAININGS, deja pasar a quien es responsable (entrenador) de algún
// entrenamiento — mismo patrón que charges.routes.js.
router.get('/', requireFunctionOrResponsibleTraining(FUNCTIONS.VIEW_TRAININGS), controller.list);

// ANTES de '/:id' — mismo motivo que charges.routes.js.
router.get('/archived', requireFunction(FUNCTIONS.VIEW_TRAININGS), controller.listArchived);

router.get('/:id', requireFunction(FUNCTIONS.VIEW_TRAININGS), validation.trainingId, handleValidation, controller.getById);

router.post('/', requireFunction(FUNCTIONS.CREATE_TRAININGS), sanitizeBody, validation.createTraining, handleValidation, controller.create);

router.put('/:id', requireFunction(FUNCTIONS.EDIT_TRAININGS), sanitizeBody, validation.updateTraining, handleValidation, controller.update);

router.delete('/:id', requireFunction(FUNCTIONS.DELETE_TRAININGS), validation.trainingId, handleValidation, controller.remove);

router.put('/:id/archive', requireFunction(FUNCTIONS.EDIT_TRAININGS), validation.trainingId, handleValidation, controller.archive);

router.put('/:id/restore', requireFunction(FUNCTIONS.EDIT_TRAININGS), validation.trainingId, handleValidation, controller.restore);

module.exports = router;
