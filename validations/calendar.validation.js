const { body, param, query } = require('express-validator');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const HEX_COLOR = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
/** Minutos antes del inicio que se ofrecen para el recordatorio (0 = a la hora del evento). */
const REMINDER_MINUTES = [0, 10, 30, 60, 120, 1440, 2880, 10080];

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
  body('reminderMinutes').optional({ nullable: true }).isIn(REMINDER_MINUTES).withMessage('Recordatorio inválido.').toInt(),
  body('remindAt').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('Recordatorio inválido.'),
  body('participantIds').optional().isArray({ max: 200 }).withMessage('participantIds debe ser un arreglo.'),
  body('participantIds.*').isInt({ min: 1 }),
];

module.exports = { feed, eventId, saveEvent };
