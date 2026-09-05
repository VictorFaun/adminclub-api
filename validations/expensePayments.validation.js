const { body, param, query } = require('express-validator');

const expenseIdParam = [param('expenseId').isInt({ min: 1 }).withMessage('Identificador de gasto inválido.')];
const instanceIdParam = [param('instanceId').isInt({ min: 1 }).withMessage('Identificador de período inválido.')];
const paymentId = [param('id').isInt({ min: 1 }).withMessage('Identificador de pago inválido.')];

const periods = [
  ...expenseIdParam,
  query('anchor')
    .optional()
    .matches(/^(\d{4}-\d{2}|\d{4})$/)
    .withMessage('Período inválido.'),
  query('columns').optional().isInt({ min: 1, max: 18 }).withMessage('Cantidad de columnas inválida.'),
];

const ensureInstance = [
  ...expenseIdParam,
  body('periodKey')
    .trim()
    .matches(/^(\d{4}-\d{2}|\d{4}|unico)$/)
    .withMessage('Período inválido.'),
];

const createPayment = [
  body('expenseInstanceId').isInt({ min: 1 }).withMessage('Debes indicar el período a pagar.'),
  body('amount').isFloat({ min: 0.01 }).withMessage('El monto debe ser mayor a cero.'),
  body('paidAt').optional().isISO8601().withMessage('Fecha de pago inválida.'),
  body('note').optional({ nullable: true }).trim().isLength({ max: 255 }),
];

const updatePayment = [
  ...paymentId,
  body('amount').optional().isFloat({ min: 0.01 }).withMessage('El monto debe ser mayor a cero.'),
  body('paidAt').optional().isISO8601().withMessage('Fecha de pago inválida.'),
  body('note').optional({ nullable: true }).trim().isLength({ max: 255 }),
];

module.exports = { expenseIdParam, instanceIdParam, paymentId, periods, ensureInstance, createPayment, updatePayment };
