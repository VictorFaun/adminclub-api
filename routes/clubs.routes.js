const router = require('express').Router();
const controller = require('../controllers/clubs.controller');
const validation = require('../validations/clubs.validation');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { clubContextMiddleware, loadClubMiddleware } = require('../middlewares/club.middleware');
const { requireFunction } = require('../middlewares/permission.middleware');
const { uploadFor } = require('../middlewares/upload.middleware');
const { FUNCTIONS } = require('../config/constants');

router.use(authMiddleware);

// --- descubrimiento público / onboarding ---
router.get('/public', validation.listPublic, handleValidation, controller.listPublic);
router.post('/join-by-code', sanitizeBody, validation.joinByCode, handleValidation, controller.joinByCode);
router.post(
  '/:clubId/request-access',
  loadClubMiddleware,
  sanitizeBody,
  validation.requestAccess,
  handleValidation,
  controller.requestAccess
);

// --- creación de club (cualquier usuario autenticado puede fundar un club) ---
router.post('/', sanitizeBody, validation.createClub, handleValidation, controller.create);

// --- administración global de plataforma ---
router.get('/', requireFunction(FUNCTIONS.VIEW_ALL_CLUBS), controller.listAll);

// --- gestión del club activo ---
router.use('/:clubId', clubContextMiddleware);

router.get('/:clubId', requireFunction(FUNCTIONS.VIEW_CLUB), validation.clubId, handleValidation, controller.getById);
// CLUB_UPDATED se registra en clubs.service.js#update (con diff de qué cambió), no acá.
router.put(
  '/:clubId',
  requireFunction(FUNCTIONS.EDIT_CLUB),
  sanitizeBody,
  validation.updateClub,
  handleValidation,
  controller.update
);
router.delete('/:clubId', requireFunction(FUNCTIONS.DELETE_CLUB), validation.clubId, handleValidation, controller.remove);

router.post('/:clubId/logo', requireFunction(FUNCTIONS.EDIT_CLUB), uploadFor('logos').single('logo'), controller.uploadLogo);
router.post('/:clubId/banner', requireFunction(FUNCTIONS.EDIT_CLUB), uploadFor('banners').single('banner'), controller.uploadBanner);
router.delete('/:clubId/logo', requireFunction(FUNCTIONS.EDIT_CLUB), controller.removeLogo);
router.delete('/:clubId/banner', requireFunction(FUNCTIONS.EDIT_CLUB), controller.removeBanner);

router.get('/:clubId/stats', requireFunction(FUNCTIONS.VIEW_DASHBOARD), controller.stats);

router.get(
  '/:clubId/join-requests',
  requireFunction(FUNCTIONS.MANAGE_JOIN_REQUESTS),
  controller.listJoinRequests
);
router.put(
  '/:clubId/join-requests/:requestId',
  requireFunction(FUNCTIONS.MANAGE_JOIN_REQUESTS),
  sanitizeBody,
  validation.resolveJoinRequest,
  handleValidation,
  controller.resolveJoinRequest
);

module.exports = router;
