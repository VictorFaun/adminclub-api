const router = require('express').Router();
const controller = require('../controllers/push.controller');
const validation = require('../validations/push.validation');
const { handleValidation } = require('../middlewares/validation.middleware');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { pushTestRateLimit } = require('../middlewares/rateLimit.middleware');

// Notificaciones push por dispositivo (ver push.service.js). Sin club: son de la cuenta.
// Sin sanitizeBody a propósito: el body es una PushSubscription (URL + claves base64url) que
// nunca se muestra en pantalla, y el filtro XSS podría alterar el endpoint; se valida estricto.
router.get('/config', controller.config);
router.post('/subscriptions', authMiddleware, validation.subscribe, handleValidation, controller.subscribe);
router.delete('/subscriptions', authMiddleware, validation.unsubscribe, handleValidation, controller.unsubscribe);
router.post('/test', authMiddleware, pushTestRateLimit, controller.test);

module.exports = router;
