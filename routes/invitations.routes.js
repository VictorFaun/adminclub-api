const router = require('express').Router();
const controller = require('../controllers/invitations.controller');
const validation = require('../validations/invitations.validation');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { clubContextMiddleware } = require('../middlewares/club.middleware');
const { requireFunction } = require('../middlewares/permission.middleware');
const { FUNCTIONS } = require('../config/constants');

router.use(authMiddleware, clubContextMiddleware);

router.get('/', requireFunction(FUNCTIONS.VIEW_INVITATIONS), validation.listInvitations, handleValidation, controller.list);

// INVITATION_CREATED se registra en invitations.service.js#create (con el id real), no acá.
router.post(
  '/',
  requireFunction(FUNCTIONS.CREATE_INVITATIONS),
  sanitizeBody,
  validation.createInvitation,
  handleValidation,
  controller.create
);

router.put(
  '/:id/revoke',
  requireFunction(FUNCTIONS.REVOKE_INVITATIONS),
  validation.invitationId,
  handleValidation,
  controller.revoke
);

router.put(
  '/:id/reactivate',
  requireFunction(FUNCTIONS.REVOKE_INVITATIONS),
  validation.invitationId,
  handleValidation,
  controller.reactivate
);

router.delete(
  '/:id',
  requireFunction(FUNCTIONS.DELETE_INVITATIONS),
  validation.invitationId,
  handleValidation,
  controller.remove
);

module.exports = router;
