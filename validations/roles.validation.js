const { body, param } = require('express-validator');

const HEX_COLOR = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

const roleId = [param('id').isInt({ min: 1 }).withMessage('Identificador de rol inválido.')];

const memberScopeRules = [
  body('memberScope').optional().isObject().withMessage('memberScope debe ser un objeto.'),
  body('memberScope.memberIds').optional().isArray(),
  body('memberScope.memberIds.*').optional().isInt({ min: 1 }),
  body('memberScope.groupIds').optional().isArray(),
  body('memberScope.groupIds.*').optional().isInt({ min: 1 }),
];

const paymentScopeRules = [
  body('paymentScope').optional().isObject().withMessage('paymentScope debe ser un objeto.'),
  body('paymentScope.memberIds').optional().isArray(),
  body('paymentScope.memberIds.*').optional().isInt({ min: 1 }),
  body('paymentScope.groupIds').optional().isArray(),
  body('paymentScope.groupIds.*').optional().isInt({ min: 1 }),
];

// Fichas / campos que puede editar (EDIT_MEMBER_FORMS_SCOPED / EDIT_MEMBER_FIELD_VALUES_SCOPED, sql/080).
const editScopeRules = [
  body('editScope').optional().isObject().withMessage('editScope debe ser un objeto.'),
  body('editScope.formIds').optional().isArray(),
  body('editScope.formIds.*').optional().isInt({ min: 1 }),
  body('editScope.fieldIds').optional().isArray(),
  body('editScope.fieldIds.*').optional().isInt({ min: 1 }),
  // Fichas que puede ver (VIEW_MEMBER_FORM_DATA_SCOPED, sql/081).
  body('editScope.viewFormIds').optional().isArray(),
  body('editScope.viewFormIds.*').optional().isInt({ min: 1 }),
];

const createRole = [
  body('name').trim().notEmpty().withMessage('El nombre del rol es obligatorio.').isLength({ max: 80 }),
  body('description').optional({ nullable: true }).trim().isLength({ max: 255 }),
  body('color').optional().matches(HEX_COLOR).withMessage('Color inválido.'),
  body('functionCodes').isArray().withMessage('functionCodes debe ser un arreglo.'),
  body('functionCodes.*').isString(),
  ...memberScopeRules,
  ...paymentScopeRules,
  ...editScopeRules,
];

const updateRole = [
  ...roleId,
  body('name').optional().trim().isLength({ min: 1, max: 80 }),
  body('description').optional({ nullable: true }).trim().isLength({ max: 255 }),
  body('color').optional().matches(HEX_COLOR).withMessage('Color inválido.'),
  body('functionCodes').optional().isArray(),
  body('functionCodes.*').optional().isString(),
  ...memberScopeRules,
  ...paymentScopeRules,
  ...editScopeRules,
];

module.exports = { roleId, createRole, updateRole };
