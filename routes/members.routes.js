const router = require('express').Router();
const controller = require('../controllers/members.controller');
const validation = require('../validations/members.validation');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { clubContextMiddleware } = require('../middlewares/club.middleware');
const { requireFunction } = require('../middlewares/permission.middleware');
const { FUNCTIONS } = require('../config/constants');

router.use(authMiddleware, clubContextMiddleware);

// Rutas fijas ANTES de "/:id" — de lo contrario "options"/"dashboard"/"fields" caerían en el
// parámetro :id (y fallarían la validación de que sea numérico).
// Además de EDIT_ROLE (scope picker de roles) y VIEW_MEMBERS/_SCOPED, lo usa charge-form
// (CREATE/EDIT_CHARGES) para poblar el picker de miembros específicos sin exigirle el permiso
// completo del módulo Miembros — mismo criterio que memberGroups.routes.js/memberTags.routes.js.
router.get(
  '/options',
  requireFunction(FUNCTIONS.EDIT_ROLE, FUNCTIONS.VIEW_MEMBERS, FUNCTIONS.VIEW_MEMBERS_SCOPED, FUNCTIONS.CREATE_CHARGES, FUNCTIONS.EDIT_CHARGES),
  controller.options
);
router.get('/dashboard', requireFunction(FUNCTIONS.VIEW_MEMBERS_DASHBOARD), controller.dashboard);
router.use('/fields', require('./memberFields.routes'));

router.get(
  '/',
  requireFunction(FUNCTIONS.VIEW_MEMBERS, FUNCTIONS.VIEW_MEMBERS_SCOPED),
  validation.listMembers,
  handleValidation,
  controller.list
);

router.get(
  '/:id',
  requireFunction(FUNCTIONS.VIEW_MEMBERS, FUNCTIONS.VIEW_MEMBERS_SCOPED),
  validation.memberId,
  handleValidation,
  controller.getById
);

// MEMBER_CREATED se registra en members.service.js#create (con el id real), no acá.
router.post('/', requireFunction(FUNCTIONS.CREATE_MEMBERS), sanitizeBody, validation.createMember, handleValidation, controller.create);

router.put(
  '/:id',
  requireFunction(FUNCTIONS.EDIT_MEMBERS),
  sanitizeBody,
  validation.updateMember,
  handleValidation,
  controller.update
);

router.delete('/:id', requireFunction(FUNCTIONS.DELETE_MEMBERS), validation.memberId, handleValidation, controller.remove);

router.put(
  '/:id/link-user',
  requireFunction(FUNCTIONS.LINK_MEMBER_USER),
  sanitizeBody,
  validation.linkUser,
  handleValidation,
  controller.linkUser
);

module.exports = router;
