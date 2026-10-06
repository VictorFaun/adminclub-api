const { body, param, query } = require('express-validator');
const memberId = [param('id').isInt({ min: 1 }).withMessage('Identificador de miembro inválido.')];

// La ficha es 100% configurable: todos los datos llegan en `fields` ({ código: valor }) y se
// validan por tipo contra los campos del club en members.service.js#_prepareFieldValues.
const fieldsRule = body('fields').optional().isObject().withMessage('fields debe ser un objeto.');

const adminFields = [
  body('status').optional().isIn(['active', 'inactive']),
  // Fecha del cambio de estado (retiro / reincorporación), o corrección de la vigente. Ver members.service.js#applyStatus.
  body('statusDate').optional({ nullable: true }).isISO8601().withMessage('Fecha inválida.'),
  // Fecha de ingreso al club: los cobros y la asistencia cuentan desde ahí (null = desde siempre).
  body('joinedOn').optional({ nullable: true }).isISO8601().withMessage('Fecha de ingreso inválida.'),
  body('userId').optional({ nullable: true }).isInt({ min: 1 }),
  body('groupIds').optional().isArray(),
  body('groupIds.*').optional().isInt({ min: 1 }),
];

const createMember = [fieldsRule, ...adminFields];

// Autoservicio (POST /members/me, ver members.service.js#createSelf): solo los datos de la ficha,
// nunca los administrativos (estado, usuario, grupos).
const createMemberSelf = [fieldsRule];

const updateMember = [...memberId, fieldsRule, ...adminFields];

const linkUser = [...memberId, body('userId').optional({ nullable: true }).isInt({ min: 1 })];

const listMembers = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('search').optional().isString().trim().isLength({ max: 100 }),
  query('status').optional().isIn(['active', 'inactive']),
  query('groupId').optional().isInt({ min: 1 }),
  query('linked').optional().isIn(['yes', 'no']),
];

module.exports = { memberId, createMember, createMemberSelf, updateMember, linkUser, listMembers };
