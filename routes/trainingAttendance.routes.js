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
  '/trainings/:trainingId/matrix/export',
  requireFunctionOrResponsibleTraining(FUNCTIONS.VIEW_ATTENDANCE, FUNCTIONS.VIEW_ATTENDANCE_SCOPED),
  controller.trainingMatrixExport
);
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

// Pasar lista: varias marcas en una sesión (mismos permisos que marcar de a una).
router.put(
  '/trainings/:trainingId/sessions/:date/attendance',
  requireFunctionOrResponsibleTraining(FUNCTIONS.MARK_ATTENDANCE),
  sanitizeBody,
  validation.markSession,
  handleValidation,
  controller.markSession
);
// % de asistencia y faltas seguidas de los últimos 60 días, por miembro.
router.get(
  '/trainings/:trainingId/stats',
  requireFunctionOrResponsibleTraining(FUNCTIONS.VIEW_ATTENDANCE, FUNCTIONS.VIEW_ATTENDANCE_SCOPED),
  validation.trainingIdParam,
  handleValidation,
  controller.trainingStats
);

// Días especiales (agregar/editar/cancelar/restaurar) — administradores con EDIT_TRAININGS o
// MARK_ATTENDANCE, o el entrenador responsable de ESE entrenamiento (el chequeo fino vive en
// trainingAttendance.service.js#_assertCanManageSessions).
const MANAGE_SESSIONS = [FUNCTIONS.EDIT_TRAININGS, FUNCTIONS.MARK_ATTENDANCE];

router.get(
  '/trainings/:trainingId/sessions/cancelled',
  requireFunctionOrResponsibleTraining(...MANAGE_SESSIONS),
  validation.trainingIdParam,
  handleValidation,
  controller.cancelledSessions
);
router.post(
  '/trainings/:trainingId/sessions',
  requireFunctionOrResponsibleTraining(...MANAGE_SESSIONS),
  sanitizeBody,
  validation.addSession,
  handleValidation,
  controller.addSession
);
router.put(
  '/trainings/:trainingId/sessions/:date',
  requireFunctionOrResponsibleTraining(...MANAGE_SESSIONS),
  sanitizeBody,
  validation.updateSession,
  handleValidation,
  controller.updateSession
);
router.post(
  '/trainings/:trainingId/sessions/:date/cancel',
  requireFunctionOrResponsibleTraining(...MANAGE_SESSIONS),
  sanitizeBody,
  validation.sessionDate,
  handleValidation,
  controller.cancelSession
);
router.post(
  '/trainings/:trainingId/sessions/:date/restore',
  requireFunctionOrResponsibleTraining(...MANAGE_SESSIONS),
  validation.sessionDate,
  handleValidation,
  controller.restoreSession
);

module.exports = router;
