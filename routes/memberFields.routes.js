const router = require('express').Router();
const controller = require('../controllers/memberFields.controller');
const validation = require('../validations/memberFields.validation');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { requireFunction } = require('../middlewares/permission.middleware');
const { FUNCTIONS } = require('../config/constants');

// Montado bajo /members/fields — authMiddleware/clubContextMiddleware ya aplicados por el
// router padre (members.routes.js).

// La ficha es 100% configurable: quien ve, crea o edita miembros necesita leer sus campos para
// armar el formulario y mostrar la ficha (son solo la definición del formulario, no datos).
const FIELD_READERS = [
  FUNCTIONS.VIEW_MEMBER_FIELDS,
  FUNCTIONS.VIEW_MEMBERS,
  FUNCTIONS.VIEW_MEMBERS_SCOPED,
  FUNCTIONS.CREATE_MEMBERS,
  FUNCTIONS.EDIT_MEMBERS,
];
router.get('/', requireFunction(...FIELD_READERS), controller.list);
router.get('/catalog', requireFunction(...FIELD_READERS), controller.catalog);

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
  '/order',
  requireFunction(FUNCTIONS.VIEW_MEMBER_FIELDS),
  requireFunction(FUNCTIONS.EDIT_MEMBER_FIELDS),
  sanitizeBody,
  validation.reorder,
  handleValidation,
  controller.reorder
);

// Agrega a la ficha los campos sugeridos que falten (nombres, RUT, nacimiento, correo…).
router.post('/suggested', requireFunction(FUNCTIONS.VIEW_MEMBER_FIELDS), requireFunction(FUNCTIONS.CREATE_MEMBER_FIELDS), controller.addSuggested);

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
