const { body, param, query } = require('express-validator');

const invitationId = [param('id').isInt({ min: 1 }).withMessage('Identificador de invitación inválido.')];

const createInvitation = [
  // 0 = usos ilimitados (se guarda como NULL, ver invitations.service.js).
  body('maxUses').optional({ nullable: true, checkFalsy: true }).isInt({ min: 0 }).withMessage('Los usos máximos deben ser un número entero (0 = ilimitado).').toInt(),
  body('expiresAt').optional({ nullable: true }).isISO8601().withMessage('expiresAt debe ser una fecha válida.'),
  body('defaultRoleId').optional({ nullable: true }).isInt({ min: 1 }),
  body('note').optional({ nullable: true }).trim().isLength({ max: 255 }),
  body('requiresMemberProfile').optional().isBoolean().withMessage('requiresMemberProfile debe ser booleano.'),
  // Opciones independientes (ver invitations.service.js): exigir cuenta y/o pedir fichas.
  body('requiresAccount').optional().isBoolean().withMessage('requiresAccount debe ser booleano.').toBoolean(),
  body('formIds').optional().isArray({ max: 50 }).withMessage('formIds debe ser un arreglo.'),
  body('formIds.*').isInt({ min: 1 }).withMessage('Ficha inválida.').toInt(),
];

const updateInvitation = [...invitationId, ...createInvitation];

const listInvitations = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('status').optional().isIn(['active', 'revoked', 'expired', 'exhausted']),
];

module.exports = { invitationId, createInvitation, updateInvitation, listInvitations };
