const router = require('express').Router();
const controller = require('../controllers/notifications.controller');
const validation = require('../validations/notifications.validation');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { clubContextMiddleware } = require('../middlewares/club.middleware');
const { requireFunction } = require('../middlewares/permission.middleware');
const { FUNCTIONS } = require('../config/constants');

router.use(authMiddleware);

router.get('/', controller.list);
router.put('/:id/read', validation.markReadParams, handleValidation, controller.markRead);
router.put('/read-all', sanitizeBody, validation.markAllRead, handleValidation, controller.markAllRead);

router.post(
  '/broadcast',
  clubContextMiddleware,
  requireFunction(FUNCTIONS.MANAGE_NOTIFICATIONS),
  sanitizeBody,
  validation.broadcast,
  handleValidation,
  controller.broadcast
);

module.exports = router;
