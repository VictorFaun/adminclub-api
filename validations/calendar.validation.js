const { body, param, query } = require('express-validator');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const HEX_COLOR = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
/** Recordatorio: cualquier cantidad de minutos antes del inicio, hasta un año (0 = al comenzar). */
const MAX_REMINDER_MINUTES = 525600;

const feed = [
  query('from').matches(DATE).withMessage('Fecha inicial inválida.'),
  query('to').matches(DATE).withMessage('Fecha final inválida.'),
];

const eventId = [param('id').isInt({ min: 1 }).withMessage('Identificador de evento inválido.')];

const saveEvent = [
  body('title').trim().notEmpty().withMessage('El nombre del evento es obligatorio.').isLength({ max: 150 }),
  body('description').optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
  body('color').optional({ nullable: true, checkFalsy: true }).matches(HEX_COLOR).withMessage('Color inválido.'),
  body('allDay').isBoolean().withMessage('Indica si el evento dura todo el día.').toBoolean(),
  body('startDate').matches(DATE).withMessage('Fecha de inicio inválida.'),
  body('endDate').optional({ nullable: true, checkFalsy: true }).matches(DATE).withMessage('Fecha de término inválida.'),
  body('startTime').optional({ nullable: true, checkFalsy: true }).matches(TIME).withMessage('Hora de inicio inválida.'),
  body('endTime').optional({ nullable: true, checkFalsy: true }).matches(TIME).withMessage('Hora de término inválida.'),
  body('reminderMinutes').optional({ nullable: true }).isInt({ min: 0, max: MAX_REMINDER_MINUTES }).withMessage('El recordatorio debe ser entre 0 minutos y 1 año antes.').toInt(),
  body('groupId').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }).withMessage('Grupo inválido.'),
  body('remindAt').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('Recordatorio inválido.'),
  body('participantIds').optional().isArray({ max: 200 }).withMessage('participantIds debe ser un arreglo.'),
  body('participantIds.*').isInt({ min: 1 }),
];

const groupId = [param('groupId').isInt({ min: 1 }).withMessage('Identificador de grupo inválido.')];
const saveGroup = [
  body('name').trim().notEmpty().withMessage('El nombre del grupo es obligatorio.').isLength({ max: 60 }).withMessage('El nombre admite hasta 60 caracteres.'),
  body('color').matches(HEX_COLOR).withMessage('Color inválido.'),
];

module.exports = { feed, eventId, saveEvent, groupId, saveGroup };
