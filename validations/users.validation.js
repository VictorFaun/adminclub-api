const { body, param, query } = require('express-validator');
const { NORMALIZE_EMAIL_OPTIONS } = require('../helpers/emailUtils');

const listUsers = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('search').optional().isString().trim().isLength({ max: 100 }),
  // GET /users siempre filtra por el estado de la MEMBRESÍA al club (`user_clubs.status`),
  // no por `users.status` (la cuenta global) — su ENUM real es solo
  // active/suspended/pending (sql/001_schema.sql), 'blocked' no existe ahí. Con 'blocked'
  // en el allowlist, un filtro `?status=blocked` pasaba la validación pero nunca podía
  // matchear ninguna fila, devolviendo siempre 0 resultados en silencio (falsa impresión de
  // "no hay usuarios bloqueados en este club" en vez de un 422 explicando que ese filtro no
  // aplica acá).
  query('status').optional().isIn(['active', 'suspended', 'pending', 'withdrawn']),
];

const userId = [param('id').isInt({ min: 1 }).withMessage('Identificador de usuario inválido.')];

const removeUser = [
  ...userId,
  body('memberAction')
    .optional()
    .isIn(['keep', 'deactivate', 'delete'])
    .withMessage("memberAction debe ser 'keep', 'deactivate' o 'delete'."),
];

const updateStatus = [
  ...userId,
  body('status').isIn(['active', 'suspended']).withMessage('Estado inválido.'),
];

const updateRoles = [
  ...userId,
  body('roleIds').isArray({ min: 0 }).withMessage('roleIds debe ser un arreglo.'),
  body('roleIds.*').isInt({ min: 1 }),
];

const updateMe = [
  body('username').optional().trim().isLength({ min: 1, max: 160 }),
  body('phone').optional({ nullable: true }).trim().isLength({ max: 30 }),
];

const lookupByEmail = [
  query('email').trim().notEmpty().withMessage('El correo es obligatorio.').isEmail().withMessage('Correo electrónico inválido.').normalizeEmail(NORMALIZE_EMAIL_OPTIONS),
];

const listAllUsers = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('search').optional().isString().trim().isLength({ max: 100 }),
  // A diferencia de listUsers (club-scoped, filtra por user_clubs.status), acá se filtra
  // por users.status directo, cuyo ENUM sí incluye 'blocked' (sql/001_schema.sql).
  query('status').optional().isIn(['active', 'suspended', 'pending', 'blocked']),
];

const updateGlobalUser = [
  ...userId,
  body('username').optional().trim().isLength({ min: 1, max: 160 }),
  body('phone').optional({ nullable: true }).trim().isLength({ max: 30 }),
  body('email')
    .optional()
    .trim()
    .isEmail()
    .withMessage('Correo electrónico inválido.')
    .normalizeEmail(NORMALIZE_EMAIL_OPTIONS)
    .isLength({ max: 160 }),
];

const updateGlobalStatus = [
  ...userId,
  body('status').isIn(['active', 'suspended']).withMessage('Estado inválido.'),
];

// Invitación a una persona con cuenta (ver clubUserInvitations.service.js): mensaje opcional y
// los roles que tendrá al aceptar.
const inviteUser = [
  ...userId,
  body('message').optional({ nullable: true }).isString().trim().isLength({ max: 500 }).withMessage('El mensaje admite hasta 500 caracteres.'),
  body('roleIds').optional().isArray().withMessage('roleIds debe ser un arreglo.'),
  body('roleIds.*').isInt({ min: 1 }),
];

const invitationId = [param('invitationId').isInt({ min: 1 }).withMessage('Identificador de invitación inválido.')];

module.exports = {
  removeUser,
  listUsers,
  userId,
  updateStatus,
  updateRoles,
  updateMe,
  lookupByEmail,
  inviteUser,
  invitationId,
  listAllUsers,
  updateGlobalUser,
  updateGlobalStatus,
};
