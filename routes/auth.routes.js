const router = require('express').Router();
const controller = require('../controllers/auth.controller');
const validation = require('../validations/auth.validation');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { authRateLimit, strictAuthRateLimit } = require('../middlewares/rateLimit.middleware');

router.post('/register', strictAuthRateLimit, sanitizeBody, validation.register, handleValidation, controller.register);
router.post('/login', authRateLimit, sanitizeBody, validation.login, handleValidation, controller.login);
router.post('/refresh', authRateLimit, controller.refresh);
router.post('/logout', controller.logout);
router.post('/logout-all', authMiddleware, controller.logoutAll);

router.post(
  '/forgot-password',
  strictAuthRateLimit,
  sanitizeBody,
  validation.forgotPassword,
  handleValidation,
  controller.forgotPassword
);
router.post(
  '/reset-password',
  authRateLimit,
  sanitizeBody,
  validation.resetPassword,
  handleValidation,
  controller.resetPassword
);
router.post('/verify-email', sanitizeBody, validation.verifyEmail, handleValidation, controller.verifyEmail);
router.post('/verify-email/resend', authMiddleware, strictAuthRateLimit, controller.resendVerification);

router.get('/me', authMiddleware, controller.me);
router.put(
  '/change-password',
  authMiddleware,
  sanitizeBody,
  validation.changePassword,
  handleValidation,
  controller.changePassword
);
router.put(
  '/default-club',
  authMiddleware,
  sanitizeBody,
  validation.defaultClub,
  handleValidation,
  controller.setDefaultClub
);

module.exports = router;
