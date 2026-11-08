const router = require('express').Router();
const controller = require('../controllers/memberForms.controller');
const validation = require('../validations/memberForms.validation');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { requireFunction } = require('../middlewares/permission.middleware');
const { FUNCTIONS } = require('../config/constants');

// Montado bajo /members/forms — authMiddleware/clubContextMiddleware ya aplicados por el router
// padre (members.routes.js). Mismos permisos que los campos (memberFields.routes.js): una ficha
// es parte de la definición del formulario. Asignarlas a miembros es editar miembros.

const FORM_READERS = [
  FUNCTIONS.VIEW_MEMBER_FIELDS,
  FUNCTIONS.VIEW_MEMBERS,
  FUNCTIONS.VIEW_MEMBERS_SCOPED,
  FUNCTIONS.CREATE_MEMBERS,
  FUNCTIONS.EDIT_MEMBERS,
  // Al crear/editar una invitación se eligen las fichas que pide.
  FUNCTIONS.CREATE_INVITATIONS,
  FUNCTIONS.EDIT_INVITATIONS,
];
router.get('/', requireFunction(...FORM_READERS), controller.list);

router.post('/', requireFunction(FUNCTIONS.VIEW_MEMBER_FIELDS), requireFunction(FUNCTIONS.CREATE_MEMBER_FIELDS), sanitizeBody, validation.createForm, handleValidation, controller.create);
router.put('/:id', requireFunction(FUNCTIONS.VIEW_MEMBER_FIELDS), requireFunction(FUNCTIONS.EDIT_MEMBER_FIELDS), sanitizeBody, validation.updateForm, handleValidation, controller.update);
router.put('/:id/fields', requireFunction(FUNCTIONS.VIEW_MEMBER_FIELDS), requireFunction(FUNCTIONS.EDIT_MEMBER_FIELDS), sanitizeBody, validation.setFields, handleValidation, controller.setFields);
router.delete('/:id', requireFunction(FUNCTIONS.VIEW_MEMBER_FIELDS), requireFunction(FUNCTIONS.DELETE_MEMBER_FIELDS), validation.formId, handleValidation, controller.remove);

// A quiénes se les pide: VIEW_MEMBERS (lista completa del club) y EDIT_MEMBERS para cambiarlo.
router.get('/:id/members', requireFunction(FUNCTIONS.VIEW_MEMBERS), validation.formId, handleValidation, controller.members);
router.post('/:id/assign', requireFunction(FUNCTIONS.VIEW_MEMBERS), requireFunction(FUNCTIONS.EDIT_MEMBERS), sanitizeBody, validation.assign, handleValidation, controller.assign);
router.post('/:id/unassign', requireFunction(FUNCTIONS.VIEW_MEMBERS), requireFunction(FUNCTIONS.EDIT_MEMBERS), sanitizeBody, validation.unassign, handleValidation, controller.unassign);

module.exports = router;
