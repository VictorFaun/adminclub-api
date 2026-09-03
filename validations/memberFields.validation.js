const { body, param } = require('express-validator');

const fieldId = [param('id').isInt({ min: 1 }).withMessage('Identificador de campo inválido.')];

const createField = [
  body('code').optional({ nullable: true }).trim().isLength({ max: 60 }),
  body('label').trim().notEmpty().withMessage('El nombre del campo es obligatorio.').isLength({ max: 120 }),
  body('fieldType').isIn(['text', 'number', 'date', 'boolean', 'select']).withMessage('Tipo de campo inválido.'),
  body('options').optional().isArray(),
  body('isRequired').optional().isBoolean().toBoolean(),
  body('sortOrder').optional().isInt(),
];

const updateField = [
  ...fieldId,
  body('label').optional().trim().isLength({ min: 1, max: 120 }),
  body('fieldType').optional().isIn(['text', 'number', 'date', 'boolean', 'select']),
  body('options').optional().isArray(),
  body('isRequired').optional().isBoolean().toBoolean(),
  body('sortOrder').optional().isInt(),
];

module.exports = { fieldId, createField, updateField };
