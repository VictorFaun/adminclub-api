const router = require('express').Router();
const controller = require('../controllers/dashboard.controller');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { clubContextMiddleware } = require('../middlewares/club.middleware');
const { requireFunction } = require('../middlewares/permission.middleware');
const { FUNCTIONS } = require('../config/constants');

router.use(authMiddleware, clubContextMiddleware);

router.get('/', requireFunction(FUNCTIONS.VIEW_DASHBOARD), controller.overview);
router.get('/audit-logs', requireFunction(FUNCTIONS.VIEW_AUDIT_LOGS), controller.auditLogs);

module.exports = router;
