const router = require('express').Router();

router.use('/auth', require('./auth.routes'));
router.use('/users', require('./users.routes'));
router.use('/clubs', require('./clubs.routes'));
router.use('/roles', require('./roles.routes'));
router.use('/functions', require('./functions.routes'));
router.use('/permissions', require('./permissions.routes'));
router.use('/invitations', require('./invitations.routes'));
router.use('/settings', require('./settings.routes'));
router.use('/notifications', require('./notifications.routes'));
router.use('/dashboard', require('./dashboard.routes'));
router.use('/platform-settings', require('./platformSettings.routes'));

router.get('/health', (req, res) => {
  res.json({ success: true, message: 'API operativa.', data: { uptime: process.uptime() } });
});

module.exports = router;
