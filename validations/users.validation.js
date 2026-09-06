const { body, param, query } = require('express-validator');
const { PASSWORD_REGEX } = require('../helpers/passwordUtils');
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
  query('status').optional().isIn(['active', 'suspended', 'pending']),
];

const userId = [param('id').isInt({ min: 1 }).withMessage('Identificador de usuario inválido.')];

const updateUser = [
  ...userId,
  body('username').optional().trim().isLength({ min: 1, max: 160 }),
  body('phone').optional({ nullable: true }).trim().isLength({ max: 30 }),
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

const createUser = [
  body('username').trim().notEmpty().withMessage('El nombre de usuario es obligatorio.').isLength({ max: 160 }),
  body('email').trim().isEmail().withMessage('Correo electrónico inválido.').normalizeEmail(NORMALIZE_EMAIL_OPTIONS).isLength({ max: 160 }),
  body('password')
    .matches(PASSWORD_REGEX)
    .withMessage('La contraseña debe tener mínimo 8 caracteres, una mayúscula, una minúscula y un número.'),
  // El teléfono ya no se pide al crear la cuenta (ver users.service.js#createInClub) —
  // sigue siendo editable después, así que no hay regla acá.
  body('roleIds').optional().isArray().withMessage('roleIds debe ser un arreglo.'),
  body('roleIds.*').isInt({ min: 1 }),
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

const addExisting = [
  ...userId,
  body('roleIds').optional().isArray().withMessage('roleIds debe ser un arreglo.'),
  body('roleIds.*').isInt({ min: 1 }),
];

module.exports = {
  listUsers,
  userId,
  updateUser,
  updateStatus,
  updateRoles,
  updateMe,
  createUser,
  lookupByEmail,
  addExisting,
  listAllUsers,
  updateGlobalUser,
  updateGlobalStatus,
};
