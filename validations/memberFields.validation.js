const { body, param } = require('express-validator');
const { FIELD_TYPES, ROLES } = require('../helpers/memberFieldTypes');

const fieldId = [param('id').isInt({ min: 1 }).withMessage('Identificador de campo inválido.')];

const common = [
  body('role').optional({ nullable: true }).isIn(Object.keys(ROLES)).withMessage('Uso especial inválido.'),
  body('options').optional({ nullable: true }).isArray(),
  body('settings').optional({ nullable: true }).isObject(),
  body('options.*').optional().isString().isLength({ max: 120 }),
  body('helpText').optional({ nullable: true }).isString().isLength({ max: 255 }),
  body('isRequired').optional().isBoolean().toBoolean(),
  body('inPublicForm').optional().isBoolean().toBoolean(),
  body('sortOrder').optional().isInt(),
];

const createField = [
  body('code').optional({ nullable: true }).trim().isLength({ max: 60 }),
  body('label').trim().notEmpty().withMessage('El nombre del campo es obligatorio.').isLength({ max: 120 }),
  body('fieldType').isIn(FIELD_TYPES).withMessage('Tipo de campo inválido.'),
  ...common,
];

const updateField = [
  ...fieldId,
  body('label').optional().trim().isLength({ min: 1, max: 120 }),
  body('fieldType').optional().isIn(FIELD_TYPES).withMessage('Tipo de campo inválido.'),
  ...common,
];

const reorder = [body('ids').isArray({ min: 1 }).withMessage('Debes indicar el orden.'), body('ids.*').isInt({ min: 1 })];

module.exports = { fieldId, createField, updateField, reorder };
