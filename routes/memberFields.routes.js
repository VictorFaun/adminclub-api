const router = require('express').Router();
const controller = require('../controllers/memberFields.controller');
const validation = require('../validations/memberFields.validation');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { requireFunction } = require('../middlewares/permission.middleware');
const { FUNCTIONS } = require('../config/constants');

// Montado bajo /members/fields — authMiddleware/clubContextMiddleware ya aplicados por el
// router padre (members.routes.js).

router.get('/', requireFunction(FUNCTIONS.VIEW_MEMBER_FIELDS), controller.list);

// VIEW_MEMBER_FIELDS es prerrequisito de TODA operación, no solo del listado: `requireFunction`
// es OR entre los codes que recibe en una sola llamada, así que para exigir "VIEW Y ADEMÁS
// CREATE/EDIT/DELETE" (AND) se encadenan dos llamadas separadas. Sin esto, un rol con
// DELETE_MEMBER_FIELDS pero sin VIEW_MEMBER_FIELDS podría eliminar un campo que ni siquiera
// puede listar (conociendo su id), aunque en la UI no vea ningún botón para hacerlo — el
// ocultamiento del frontend nunca es la barrera real.
router.post(
  '/',
  requireFunction(FUNCTIONS.VIEW_MEMBER_FIELDS),
  requireFunction(FUNCTIONS.CREATE_MEMBER_FIELDS),
  sanitizeBody,
  validation.createField,
  handleValidation,
  controller.create
);

router.put(
  '/:id',
  requireFunction(FUNCTIONS.VIEW_MEMBER_FIELDS),
  requireFunction(FUNCTIONS.EDIT_MEMBER_FIELDS),
  sanitizeBody,
  validation.updateField,
  handleValidation,
  controller.update
);

router.delete(
  '/:id',
  requireFunction(FUNCTIONS.VIEW_MEMBER_FIELDS),
  requireFunction(FUNCTIONS.DELETE_MEMBER_FIELDS),
  validation.fieldId,
  handleValidation,
  controller.remove
);

module.exports = router;
