const { body } = require('express-validator');
const { PASSWORD_REGEX } = require('../helpers/passwordUtils');
const { NORMALIZE_EMAIL_OPTIONS } = require('../helpers/emailUtils');

const passwordRule = body('password')
  .matches(PASSWORD_REGEX)
  .withMessage('La contraseña debe tener mínimo 8 caracteres, una mayúscula, una minúscula y un número.');

const register = [
  body('username').trim().notEmpty().withMessage('El nombre de usuario es obligatorio.').isLength({ max: 160 }),
  body('email').trim().isEmail().withMessage('Correo electrónico inválido.').normalizeEmail(NORMALIZE_EMAIL_OPTIONS).isLength({ max: 160 }),
  passwordRule,
];

const login = [
  body('email').trim().isEmail().withMessage('Correo electrónico inválido.').normalizeEmail(NORMALIZE_EMAIL_OPTIONS),
  body('password').notEmpty().withMessage('La contraseña es obligatoria.'),
  body('rememberMe').optional().isBoolean().toBoolean(),
];

const forgotPassword = [body('email').trim().isEmail().withMessage('Correo electrónico inválido.').normalizeEmail(NORMALIZE_EMAIL_OPTIONS)];

const resetPassword = [
  body('token').trim().notEmpty().withMessage('Token inválido.'),
  passwordRule,
];

const verifyEmail = [body('token').trim().notEmpty().withMessage('Token inválido.')];

const changePassword = [
  body('currentPassword').notEmpty().withMessage('Debes ingresar tu contraseña actual.'),
  body('newPassword')
    .matches(PASSWORD_REGEX)
    .withMessage('La nueva contraseña debe tener mínimo 8 caracteres, una mayúscula, una minúscula y un número.'),
];

const defaultClub = [body('clubId').isInt({ min: 1 }).withMessage('clubId inválido.')];

module.exports = { register, login, forgotPassword, resetPassword, verifyEmail, changePassword, defaultClub };
