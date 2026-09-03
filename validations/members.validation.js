const { body, param, query } = require('express-validator');

const memberId = [param('id').isInt({ min: 1 }).withMessage('Identificador de miembro inválido.')];

const commonFields = [
  body('middleName').optional({ nullable: true }).trim().isLength({ max: 100 }),
  body('secondLastName').optional({ nullable: true }).trim().isLength({ max: 100 }),
  body('email').optional({ nullable: true }).trim().isEmail().withMessage('Correo inválido.').isLength({ max: 255 }),
  body('phone').optional({ nullable: true }).trim().isLength({ max: 30 }),
  body('rut').optional({ nullable: true }).trim().isLength({ max: 20 }),
  body('birthDate').optional({ nullable: true }).isISO8601().withMessage('Fecha de nacimiento inválida.'),
  body('status').optional().isIn(['active', 'inactive']),
  body('userId').optional({ nullable: true }).isInt({ min: 1 }),
  body('groupIds').optional().isArray(),
  body('groupIds.*').optional().isInt({ min: 1 }),
  body('customFields').optional().isObject().withMessage('customFields debe ser un objeto.'),
];

const createMember = [
  body('firstName').trim().notEmpty().withMessage('El primer nombre es obligatorio.').isLength({ max: 100 }),
  body('lastName').trim().notEmpty().withMessage('El primer apellido es obligatorio.').isLength({ max: 100 }),
  ...commonFields,
];

const updateMember = [
  ...memberId,
  body('firstName').optional().trim().isLength({ min: 1, max: 100 }),
  body('lastName').optional().trim().isLength({ min: 1, max: 100 }),
  ...commonFields,
];

const linkUser = [...memberId, body('userId').optional({ nullable: true }).isInt({ min: 1 })];

const listMembers = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('search').optional().isString().trim().isLength({ max: 100 }),
  query('status').optional().isIn(['active', 'inactive']),
  query('groupId').optional().isInt({ min: 1 }),
  query('linked').optional().isIn(['yes', 'no']),
];

module.exports = { memberId, createMember, updateMember, linkUser, listMembers };
