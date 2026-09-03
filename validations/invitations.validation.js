const { body, param, query } = require('express-validator');

const invitationId = [param('id').isInt({ min: 1 }).withMessage('Identificador de invitación inválido.')];

const createInvitation = [
  body('maxUses').optional({ nullable: true }).isInt({ min: 1 }).withMessage('maxUses debe ser un número entero positivo.'),
  body('expiresAt').optional({ nullable: true }).isISO8601().withMessage('expiresAt debe ser una fecha válida.'),
  body('defaultRoleId').optional({ nullable: true }).isInt({ min: 1 }),
  body('note').optional({ nullable: true }).trim().isLength({ max: 255 }),
];

const listInvitations = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('status').optional().isIn(['active', 'revoked', 'expired', 'exhausted']),
];

module.exports = { invitationId, createInvitation, listInvitations };
