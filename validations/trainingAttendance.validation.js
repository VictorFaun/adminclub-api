const { body, param, query } = require('express-validator');

const memberIdParam = [param('memberId').isInt({ min: 1 }).withMessage('Identificador de miembro inválido.')];
const trainingIdParam = [param('trainingId').isInt({ min: 1 }).withMessage('Identificador de entrenamiento inválido.')];

const trainingMatrix = [
  ...trainingIdParam,
  query('offset').optional().isInt({ min: -100, max: 100 }).withMessage('Página inválida.'),
  query('columns').optional().isInt({ min: 1, max: 5 }).withMessage('Cantidad de columnas inválida.'),
];

const markAttendance = [
  ...trainingIdParam,
  param('memberId').isInt({ min: 1 }).withMessage('Identificador de miembro inválido.'),
  body('sessionDate').isISO8601().withMessage('Fecha de sesión inválida.'),
  body('status').isIn(['pending', 'attended', 'absent', 'exempt']).withMessage('Estado de asistencia inválido.'),
  body('exemptType').optional({ nullable: true }).isIn(['frozen', 'not_applicable']).withMessage('Tipo de exención inválido.'),
  body('exemptReason').optional({ nullable: true }).trim().isLength({ max: 255 }),
];

const sessionDateParam = param('date').isISO8601({ strict: true }).withMessage('Fecha inválida.');
const sessionFields = [
  body('startTime').optional({ nullable: true, checkFalsy: true }).matches(/^\d{2}:\d{2}(:\d{2})?$/).withMessage('Hora de inicio inválida.'),
  body('endTime').optional({ nullable: true, checkFalsy: true }).matches(/^\d{2}:\d{2}(:\d{2})?$/).withMessage('Hora de término inválida.'),
  body('note').optional({ nullable: true }).trim().isLength({ max: 255 }),
];
const addSession = [...trainingIdParam, body('sessionDate').isISO8601().withMessage('Fecha inválida.'), ...sessionFields];
const updateSession = [...trainingIdParam, sessionDateParam, ...sessionFields];
const sessionDate = [...trainingIdParam, sessionDateParam, body('note').optional({ nullable: true }).trim().isLength({ max: 255 })];

const markSession = [
  ...trainingIdParam,
  param('date').isISO8601({ strict: true }).withMessage('Fecha inválida.'),
  body('marks').isArray({ min: 1, max: 300 }).withMessage('Indica al menos una marca.'),
  body('marks.*.memberId').isInt({ min: 1 }),
  body('marks.*.status').isIn(['pending', 'attended', 'absent', 'exempt']),
  body('marks.*.exemptType').optional({ nullable: true }).isIn(['frozen', 'not_applicable']),
];

module.exports = { memberIdParam, trainingIdParam, trainingMatrix, markAttendance, markSession, addSession, updateSession, sessionDate };
