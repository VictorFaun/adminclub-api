const { body, param } = require('express-validator');

const HEX_COLOR = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

const trainingId = [param('id').isInt({ min: 1 }).withMessage('Identificador de entrenamiento inválido.')];

// Sin monto (mirror de charges.validation.js#targetFields, sin `amount`).
const targetFields = [
  body('targetGroups').optional().isArray(),
  body('targetGroups.*').isInt({ min: 1 }).withMessage('Grupo inválido.'),
  body('targetMembers').optional().isArray(),
  body('targetMembers.*').isInt({ min: 1 }).withMessage('Miembro inválido.'),
  body('exclusionMemberIds').optional().isArray(),
  body('exclusionMemberIds.*').optional().isInt({ min: 1 }),
  // Entrenadores (varios, cada uno opcionalmente vinculado a un grupo) — ver
  // trainings.repository.js#resolveResponsibles. `groupId: null` = "todos los grupos".
  body('responsibles').optional().isArray(),
  body('responsibles.*.memberId').isInt({ min: 1 }).withMessage('Entrenador inválido.'),
  body('responsibles.*.groupId').optional({ nullable: true }).isInt({ min: 1 }).withMessage('Grupo inválido.'),
];

const scheduleFields = [
  body('schedules').isArray({ min: 1 }).withMessage('Agrega al menos un día y horario de entrenamiento.'),
  body('schedules.*.dayOfWeek').isInt({ min: 1, max: 7 }).withMessage('Día de la semana inválido.'),
  body('schedules.*.startTime')
    .matches(/^\d{2}:\d{2}(:\d{2})?$/)
    .withMessage('Hora de inicio inválida.'),
  body('schedules.*.endTime')
    .optional({ nullable: true })
    .matches(/^\d{2}:\d{2}(:\d{2})?$/)
    .withMessage('Hora de término inválida.'),
];

const createTraining = [
  body('name').trim().notEmpty().withMessage('El nombre del entrenamiento es obligatorio.').isLength({ max: 150 }),
  body('description').optional({ nullable: true }).trim().isLength({ max: 500 }),
  body('color').optional().matches(HEX_COLOR).withMessage('Color inválido.'),
  body('startDate').isISO8601().withMessage('Fecha de inicio inválida.'),
  body('endDate').optional({ nullable: true }).isISO8601().withMessage('Fecha de término inválida.'),
  body('status').optional().isIn(['active', 'inactive']),
  ...scheduleFields,
  ...targetFields,
];

const updateTraining = [
  ...trainingId,
  body('name').optional().trim().isLength({ min: 1, max: 150 }),
  body('description').optional({ nullable: true }).trim().isLength({ max: 500 }),
  body('color').optional().matches(HEX_COLOR).withMessage('Color inválido.'),
  body('startDate').optional().isISO8601(),
  body('endDate').optional({ nullable: true }).isISO8601(),
  body('status').optional().isIn(['active', 'inactive']),
  body('schedules').optional().isArray({ min: 1 }).withMessage('Agrega al menos un día y horario de entrenamiento.'),
  body('schedules.*.dayOfWeek').if(body('schedules').exists()).isInt({ min: 1, max: 7 }).withMessage('Día de la semana inválido.'),
  body('schedules.*.startTime')
    .if(body('schedules').exists())
    .matches(/^\d{2}:\d{2}(:\d{2})?$/)
    .withMessage('Hora de inicio inválida.'),
  body('schedules.*.endTime')
    .optional({ nullable: true })
    .matches(/^\d{2}:\d{2}(:\d{2})?$/)
    .withMessage('Hora de término inválida.'),
  ...targetFields,
];

module.exports = { trainingId, createTraining, updateTraining };
