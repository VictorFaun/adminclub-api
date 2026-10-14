const { body, param } = require('express-validator');

const memberId = [param('memberId').isInt({ min: 1 }).withMessage('Identificador de miembro inválido.')];
const paymentId = [param('paymentId').isInt({ min: 1 }).withMessage('Identificador de pago inválido.')];
const fieldId = [param('fieldId').isInt({ min: 1 }).withMessage('Identificador de campo inválido.')];

const updateProfile = [...memberId, body('fields').isObject().withMessage('fields debe ser un objeto.')];

const inviteGuardian = [
  ...memberId,
  body('email').trim().isEmail().withMessage('Correo inválido.').isLength({ max: 160 }),
  body('relation').optional({ nullable: true }).isString().trim().isLength({ max: 40 }),
];

const SETTINGS = ['enabled', 'payments', 'payProof', 'attendance', 'profileEdit', 'guardiansInvite'];
const updateSettings = SETTINGS.map((k) => body(k).optional().isBoolean().withMessage(`${k} debe ser verdadero o falso.`).toBoolean());

const guardianParams = [param('id').isInt({ min: 1 }).withMessage('Identificador de miembro inválido.')];
const addGuardian = [
  ...guardianParams,
  body('userId').isInt({ min: 1 }).withMessage('Indica la cuenta del apoderado.').toInt(),
  body('relation').optional({ nullable: true }).isString().trim().isLength({ max: 40 }),
];
const removeGuardian = [...guardianParams, param('userId').isInt({ min: 1 }).withMessage('Identificador de cuenta inválido.')];

module.exports = { memberId, paymentId, fieldId, updateProfile, inviteGuardian, updateSettings, guardianParams, addGuardian, removeGuardian };
