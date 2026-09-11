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

module.exports = { memberIdParam, trainingIdParam, trainingMatrix, markAttendance };
