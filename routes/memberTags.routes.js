const router = require('express').Router();
const controller = require('../controllers/memberTags.controller');
const validation = require('../validations/memberTags.validation');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { clubContextMiddleware } = require('../middlewares/club.middleware');
const { requireFunction } = require('../middlewares/permission.middleware');
const { FUNCTIONS } = require('../config/constants');

router.use(authMiddleware, clubContextMiddleware);

// Además de VIEW_MEMBER_TAGS, lo usan los pickers de charge-form (CREATE/EDIT_CHARGES) y
// member-form (EDIT_MEMBERS) para poblar el selector de etiquetas sin exigirles el permiso
// completo del módulo Etiquetas — mismo criterio que memberGroups.routes.js con EDIT_ROLE.
router.get(
  '/options',
  requireFunction(FUNCTIONS.VIEW_MEMBER_TAGS, FUNCTIONS.EDIT_MEMBERS, FUNCTIONS.CREATE_CHARGES, FUNCTIONS.EDIT_CHARGES),
  controller.options
);

router.get('/', requireFunction(FUNCTIONS.VIEW_MEMBER_TAGS), controller.list);

router.get('/:id', requireFunction(FUNCTIONS.VIEW_MEMBER_TAGS), validation.tagId, handleValidation, controller.getById);

router.post('/', requireFunction(FUNCTIONS.MANAGE_MEMBER_TAGS), sanitizeBody, validation.createTag, handleValidation, controller.create);

router.put('/:id', requireFunction(FUNCTIONS.MANAGE_MEMBER_TAGS), sanitizeBody, validation.updateTag, handleValidation, controller.update);

router.delete('/:id', requireFunction(FUNCTIONS.MANAGE_MEMBER_TAGS), validation.tagId, handleValidation, controller.remove);

router.get('/:id/members', requireFunction(FUNCTIONS.VIEW_MEMBER_TAGS), validation.tagId, handleValidation, controller.listMembers);

router.post(
  '/:id/members',
  requireFunction(FUNCTIONS.MANAGE_MEMBER_TAGS),
  sanitizeBody,
  validation.addMembers,
  handleValidation,
  controller.addMembers
);

router.delete(
  '/:id/members/:memberId',
  requireFunction(FUNCTIONS.MANAGE_MEMBER_TAGS),
  validation.removeMember,
  handleValidation,
  controller.removeMember
);

module.exports = router;
