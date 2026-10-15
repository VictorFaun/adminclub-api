const { body } = require('express-validator');

// Formato de PushSubscription.toJSON() del navegador. push.service.js#_assertSubscription vuelve
// a validar (https, largos) antes de guardar.
const subscribe = [
  body('endpoint').isString().isLength({ min: 10, max: 2000 }).withMessage('Suscripción push inválida.'),
  body('keys.p256dh').isString().isLength({ min: 10, max: 255 }).withMessage('Suscripción push inválida.'),
  body('keys.auth').isString().isLength({ min: 4, max: 255 }).withMessage('Suscripción push inválida.'),
];

const unsubscribe = [body('endpoint').isString().isLength({ min: 10, max: 2000 }).withMessage('Suscripción push inválida.')];

module.exports = { subscribe, unsubscribe };
