const { body, param } = require('express-validator');

const HEX_COLOR = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

const categoryId = [param('id').isInt({ min: 1 }).withMessage('Identificador de categoría inválido.')];

const createCategory = [
  body('name').trim().notEmpty().withMessage('El nombre de la categoría es obligatorio.').isLength({ max: 100 }),
  body('description').optional({ nullable: true }).trim().isLength({ max: 255 }),
  body('color').optional().matches(HEX_COLOR).withMessage('Color inválido.'),
];

const updateCategory = [
  ...categoryId,
  body('name').optional().trim().isLength({ min: 1, max: 100 }),
  body('description').optional({ nullable: true }).trim().isLength({ max: 255 }),
  body('color').optional().matches(HEX_COLOR).withMessage('Color inválido.'),
];

module.exports = { categoryId, createCategory, updateCategory };
