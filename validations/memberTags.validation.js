const { body, param } = require('express-validator');

const HEX_COLOR = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

const tagId = [param('id').isInt({ min: 1 }).withMessage('Identificador de etiqueta inválido.')];

const createTag = [
  body('name').trim().notEmpty().withMessage('El nombre de la etiqueta es obligatorio.').isLength({ max: 100 }),
  body('description').optional({ nullable: true }).trim().isLength({ max: 255 }),
  body('color').optional().matches(HEX_COLOR).withMessage('Color inválido.'),
];

const updateTag = [
  ...tagId,
  body('name').optional().trim().isLength({ min: 1, max: 100 }),
  body('description').optional({ nullable: true }).trim().isLength({ max: 255 }),
  body('color').optional().matches(HEX_COLOR).withMessage('Color inválido.'),
];

const addMembers = [
  ...tagId,
  body('memberIds').isArray({ min: 1 }).withMessage('Debes indicar al menos un miembro.'),
  body('memberIds.*').isInt({ min: 1 }),
];

const removeMember = [...tagId, param('memberId').isInt({ min: 1 }).withMessage('Identificador de miembro inválido.')];

module.exports = { tagId, createTag, updateTag, addMembers, removeMember };
