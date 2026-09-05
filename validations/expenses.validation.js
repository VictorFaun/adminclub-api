const { body, param } = require('express-validator');

const HEX_COLOR = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

const expenseId = [param('id').isInt({ min: 1 }).withMessage('Identificador de gasto inválido.')];

const createExpense = [
  body('name').trim().notEmpty().withMessage('El nombre del gasto es obligatorio.').isLength({ max: 150 }),
  body('description').optional({ nullable: true }).trim().isLength({ max: 500 }),
  body('color').optional().matches(HEX_COLOR).withMessage('Color inválido.'),
  body('categoryId').optional({ nullable: true }).isInt({ min: 1 }).withMessage('Categoría inválida.'),
  body('amount').isFloat({ min: 0.01 }).withMessage('El monto debe ser mayor a cero.'),
  body('payee').optional({ nullable: true }).trim().isLength({ max: 150 }),
  body('recurrence').isIn(['once', 'monthly', 'yearly']).withMessage('Recurrencia inválida.'),
  body('startDate').isISO8601().withMessage('Fecha de inicio inválida.'),
  body('dueDay').optional({ nullable: true }).isInt({ min: 1, max: 31 }),
  body('dueMonth').optional({ nullable: true }).isInt({ min: 1, max: 12 }),
  body('endDate').optional({ nullable: true }).isISO8601().withMessage('Fecha de término inválida.'),
  body('status').optional().isIn(['active', 'inactive']),
];

const updateExpense = [
  ...expenseId,
  body('name').optional().trim().isLength({ min: 1, max: 150 }),
  body('description').optional({ nullable: true }).trim().isLength({ max: 500 }),
  body('color').optional().matches(HEX_COLOR).withMessage('Color inválido.'),
  body('categoryId').optional({ nullable: true }).isInt({ min: 1 }).withMessage('Categoría inválida.'),
  body('amount').optional().isFloat({ min: 0.01 }).withMessage('El monto debe ser mayor a cero.'),
  body('payee').optional({ nullable: true }).trim().isLength({ max: 150 }),
  body('recurrence').optional().isIn(['once', 'monthly', 'yearly']),
  body('startDate').optional().isISO8601(),
  body('dueDay').optional({ nullable: true }).isInt({ min: 1, max: 31 }),
  body('dueMonth').optional({ nullable: true }).isInt({ min: 1, max: 12 }),
  body('endDate').optional({ nullable: true }).isISO8601(),
  body('status').optional().isIn(['active', 'inactive']),
];

module.exports = { expenseId, createExpense, updateExpense };
