const { body } = require('express-validator');
const { isValidTimezone } = require('../helpers/timezones');

const update = [
  body('timezone')
    .trim()
    .notEmpty()
    .withMessage('La zona horaria es obligatoria.')
    .custom(isValidTimezone)
    .withMessage('Zona horaria inválida.'),
];

module.exports = { update };
