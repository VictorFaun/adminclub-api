const router = require('express').Router();
const controller = require('../controllers/trainingAttendance.controller');
const validation = require('../validations/trainingAttendance.validation');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { clubContextMiddleware } = require('../middlewares/club.middleware');
const { requireFunction, requireFunctionOrResponsibleTraining } = require('../middlewares/permission.middleware');
const { FUNCTIONS } = require('../config/constants');

router.use(authMiddleware, clubContextMiddleware);

router.get(
  '/members/:memberId',
  requireFunction(FUNCTIONS.VIEW_ATTENDANCE, FUNCTIONS.VIEW_ATTENDANCE_SCOPED),
  validation.memberIdParam,
  handleValidation,
  controller.listForMember
);

// Matriz miembro×fecha de UN entrenamiento — deja pasar además a quien es responsable
// (entrenador) de ESE entrenamiento puntual (chequeo fino en
// trainingAttendance.service.js#_resolveTrainingParticipants), mismo patrón que
// payments.routes.js#chargeMatrix.
router.get(
  '/trainings/:trainingId/matrix',
  requireFunctionOrResponsibleTraining(FUNCTIONS.VIEW_ATTENDANCE, FUNCTIONS.VIEW_ATTENDANCE_SCOPED),
  validation.trainingMatrix,
  handleValidation,
  controller.trainingMatrix
);

// Marcar asistió/no asistió/congelado/no aplica — deja pasar además al entrenador responsable de
// ESE miembro puntual (chequeo fino en trainingAttendance.service.js#assertTrainingMemberAccessible).
router.put(
  '/trainings/:trainingId/members/:memberId',
  requireFunctionOrResponsibleTraining(FUNCTIONS.MARK_ATTENDANCE),
  sanitizeBody,
  validation.markAttendance,
  handleValidation,
  controller.markAttendance
);

module.exports = router;
