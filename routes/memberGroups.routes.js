const router = require('express').Router();
const controller = require('../controllers/memberGroups.controller');
const validation = require('../validations/memberGroups.validation');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { clubContextMiddleware } = require('../middlewares/club.middleware');
const { requireFunction } = require('../middlewares/permission.middleware');
const { FUNCTIONS } = require('../config/constants');

router.use(authMiddleware, clubContextMiddleware);

router.get(
  '/options',
  requireFunction(FUNCTIONS.EDIT_ROLE, FUNCTIONS.VIEW_MEMBER_GROUPS),
  controller.options
);

router.get('/', requireFunction(FUNCTIONS.VIEW_MEMBER_GROUPS), controller.list);

router.get('/:id', requireFunction(FUNCTIONS.VIEW_MEMBER_GROUPS), validation.groupId, handleValidation, controller.getById);

router.post('/', requireFunction(FUNCTIONS.MANAGE_MEMBER_GROUPS), sanitizeBody, validation.createGroup, handleValidation, controller.create);

router.put(
  '/:id',
  requireFunction(FUNCTIONS.MANAGE_MEMBER_GROUPS),
  sanitizeBody,
  validation.updateGroup,
  handleValidation,
  controller.update
);

router.delete('/:id', requireFunction(FUNCTIONS.MANAGE_MEMBER_GROUPS), validation.groupId, handleValidation, controller.remove);

router.get(
  '/:id/members',
  requireFunction(FUNCTIONS.VIEW_MEMBER_GROUPS),
  validation.groupId,
  handleValidation,
  controller.listMembers
);

router.post(
  '/:id/members',
  requireFunction(FUNCTIONS.MANAGE_MEMBER_GROUPS),
  sanitizeBody,
  validation.addMembers,
  handleValidation,
  controller.addMembers
);

router.delete(
  '/:id/members/:memberId',
  requireFunction(FUNCTIONS.MANAGE_MEMBER_GROUPS),
  validation.removeMember,
  handleValidation,
  controller.removeMember
);

module.exports = router;
