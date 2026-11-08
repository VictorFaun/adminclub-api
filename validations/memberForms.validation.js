const { body, param } = require('express-validator');

const formId = [param('id').isInt({ min: 1 }).withMessage('Identificador de ficha inválido.')];

const common = [
  body('description').optional({ nullable: true }).isString().isLength({ max: 255 }),
  body('isDefault').optional().isBoolean().toBoolean(),
];

const createForm = [
  body('name').trim().notEmpty().withMessage('El nombre de la ficha es obligatorio.').isLength({ max: 100 }),
  body('fieldIds').optional().isArray({ max: 500 }),
  body('fieldIds.*').isInt({ min: 1 }),
  ...common,
];

const updateForm = [...formId, body('name').optional().trim().isLength({ min: 1, max: 100 }), ...common];

const setFields = [...formId, body('fieldIds').isArray({ max: 500 }).withMessage('Indica los campos de la ficha.'), body('fieldIds.*').isInt({ min: 1 })];

const assign = [
  ...formId,
  body('all').optional().isBoolean().toBoolean(),
  body('groupIds').optional().isArray({ max: 100 }),
  body('groupIds.*').isInt({ min: 1 }),
  body('memberIds').optional().isArray({ max: 2000 }),
  body('memberIds.*').isInt({ min: 1 }),
];

const unassign = [...formId, body('memberIds').isArray({ min: 1, max: 2000 }).withMessage('Indica los miembros.'), body('memberIds.*').isInt({ min: 1 })];

module.exports = { formId, createForm, updateForm, setFields, assign, unassign };
