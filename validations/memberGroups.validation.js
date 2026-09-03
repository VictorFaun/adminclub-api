const { body, param } = require('express-validator');

const HEX_COLOR = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

const groupId = [param('id').isInt({ min: 1 }).withMessage('Identificador de grupo inválido.')];

const createGroup = [
  body('name').trim().notEmpty().withMessage('El nombre del grupo es obligatorio.').isLength({ max: 100 }),
  body('description').optional({ nullable: true }).trim().isLength({ max: 255 }),
  body('color').optional().matches(HEX_COLOR).withMessage('Color inválido.'),
];

const updateGroup = [
  ...groupId,
  body('name').optional().trim().isLength({ min: 1, max: 100 }),
  body('description').optional({ nullable: true }).trim().isLength({ max: 255 }),
  body('color').optional().matches(HEX_COLOR).withMessage('Color inválido.'),
];

const addMembers = [
  ...groupId,
  body('memberIds').isArray({ min: 1 }).withMessage('Debes indicar al menos un miembro.'),
  body('memberIds.*').isInt({ min: 1 }),
];

const removeMember = [
  ...groupId,
  param('memberId').isInt({ min: 1 }).withMessage('Identificador de miembro inválido.'),
];

module.exports = { groupId, createGroup, updateGroup, addMembers, removeMember };
