const { body, param } = require('express-validator');

const STATUS_CODES = ['pending', 'partial', 'paid', 'exempt', 'overdue', 'not_applicable'];
const HEX_COLOR = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

const updateStatusColors = [
  body('colors').isObject().withMessage('colors debe ser un objeto.'),
  ...STATUS_CODES.map((code) =>
    body(`colors.${code}`).optional({ nullable: true }).matches(HEX_COLOR).withMessage(`Color inválido para el estado "${code}".`)
  ),
];

const accountId = [param('id').isInt({ min: 1 }).withMessage('Identificador de cuenta inválido.')];

const accountBody = [
  body('name').trim().notEmpty().withMessage('El nombre de la cuenta es obligatorio.').isLength({ max: 100 }),
  body('bankName').optional({ nullable: true }).isString().isLength({ max: 100 }),
  body('accountType').optional({ nullable: true }).isString().isLength({ max: 60 }),
  body('accountNumber').optional({ nullable: true }).isString().isLength({ max: 60 }),
  body('holderName').optional({ nullable: true }).isString().isLength({ max: 150 }),
  body('holderRut').optional({ nullable: true }).isString().isLength({ max: 12 }),
  body('email').optional({ nullable: true, checkFalsy: true }).isEmail().withMessage('Correo inválido.'),
  body('notes').optional({ nullable: true }).isString().isLength({ max: 500 }),
];

const deleteAccount = [...accountId, body('transferToAccountId').optional({ nullable: true }).isInt({ min: 1 }).withMessage('Cuenta de destino inválida.')];

const createTransfer = [
  body('fromAccountId').optional({ nullable: true }).isInt({ min: 1 }).withMessage('Cuenta de origen inválida.'),
  body('toAccountId').isInt({ min: 1 }).withMessage('Elige la cuenta de destino.'),
  body('amount').isFloat({ gt: 0 }).withMessage('El monto debe ser mayor a cero.'),
  body('transferredAt').optional({ nullable: true }).isISO8601().withMessage('Fecha inválida.'),
  body('note').optional({ nullable: true }).isString().isLength({ max: 255 }),
];

module.exports = { updateStatusColors, accountId, createAccount: accountBody, updateAccount: [...accountId, ...accountBody], deleteAccount, createTransfer };
