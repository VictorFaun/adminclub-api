const { body } = require('express-validator');

const STATUS_CODES = ['pending', 'partial', 'paid', 'exempt', 'overdue', 'not_applicable'];
const HEX_COLOR = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

const updateStatusColors = [
  body('colors').isObject().withMessage('colors debe ser un objeto.'),
  ...STATUS_CODES.map((code) =>
    body(`colors.${code}`).optional({ nullable: true }).matches(HEX_COLOR).withMessage(`Color inválido para el estado "${code}".`)
  ),
];

module.exports = { updateStatusColors };
