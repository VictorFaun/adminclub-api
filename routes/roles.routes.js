const router = require('express').Router();
const controller = require('../controllers/roles.controller');
const validation = require('../validations/roles.validation');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { clubContextMiddleware } = require('../middlewares/club.middleware');
const { requireFunction } = require('../middlewares/permission.middleware');
const { FUNCTIONS } = require('../config/constants');

router.use(authMiddleware, clubContextMiddleware);

router.get('/', requireFunction(FUNCTIONS.VIEW_ROLES), controller.list);
router.get('/:id', requireFunction(FUNCTIONS.VIEW_ROLES), validation.roleId, handleValidation, controller.getById);

// ROLE_CREATED se registra en roles.service.js#create (con el id real y functionCodes), no acá.
router.post(
  '/',
  requireFunction(FUNCTIONS.CREATE_ROLE),
  sanitizeBody,
  validation.createRole,
  handleValidation,
  controller.create
);

router.put(
  '/:id',
  requireFunction(FUNCTIONS.EDIT_ROLE),
  sanitizeBody,
  validation.updateRole,
  handleValidation,
  controller.update
);

router.post(
  '/:id/duplicate',
  requireFunction(FUNCTIONS.CREATE_ROLE),
  validation.roleId,
  handleValidation,
  controller.duplicate
);

router.delete(
  '/:id',
  requireFunction(FUNCTIONS.DELETE_ROLE),
  validation.roleId,
  handleValidation,
  controller.remove
);

module.exports = router;
