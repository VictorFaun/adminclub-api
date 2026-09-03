const router = require('express').Router();
const controller = require('../controllers/permissions.controller');
const { authMiddleware } = require('../middlewares/auth.middleware');

router.get('/me', authMiddleware, controller.me);

module.exports = router;
