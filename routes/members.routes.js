const router = require('express').Router();
const multer = require('multer');
const AppError = require('../helpers/AppError');
const { body } = require('express-validator');
const controller = require('../controllers/members.controller');
const applicationsController = require('../controllers/memberApplications.controller');
const validation = require('../validations/members.validation');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { clubContextMiddleware } = require('../middlewares/club.middleware');
const { requireFunction, requireClubMember } = require('../middlewares/permission.middleware');
const { FUNCTIONS } = require('../config/constants');
const { uploadFor } = require('../middlewares/upload.middleware');
const { uploadPrivate } = require('../middlewares/privateUpload.middleware');
const { TEMP_SUBDIR, parseMultipartFields } = require('../helpers/memberUploads');

router.use(authMiddleware, clubContextMiddleware);

// Rutas fijas ANTES de "/:id" — de lo contrario "options"/"dashboard"/"fields" caerían en el
// parámetro :id (y fallarían la validación de que sea numérico).
// Además de EDIT_ROLE (scope picker de roles) y VIEW_MEMBERS/_SCOPED, lo usa charge-form
// (CREATE/EDIT_CHARGES) y training-form (CREATE/EDIT_TRAININGS) para poblar el picker de miembros sin exigirle el permiso
// completo del módulo Miembros — mismo criterio que memberGroups.routes.js.
router.get(
  '/options',
  requireFunction(FUNCTIONS.EDIT_ROLE, FUNCTIONS.VIEW_MEMBERS, FUNCTIONS.VIEW_MEMBERS_SCOPED, FUNCTIONS.CREATE_CHARGES, FUNCTIONS.EDIT_CHARGES, FUNCTIONS.CREATE_TRAININGS, FUNCTIONS.EDIT_TRAININGS),
  controller.options
);
router.get('/dashboard', requireFunction(FUNCTIONS.VIEW_MEMBERS_DASHBOARD), controller.dashboard);
// Qué datos de la ficha puede editar el actor (todo, o fichas/campos específicos, sql/080).
router.get('/edit-scope', requireFunction(FUNCTIONS.EDIT_MEMBERS, FUNCTIONS.EDIT_MEMBER_FORMS_SCOPED, FUNCTIONS.EDIT_MEMBER_FIELD_VALUES_SCOPED), controller.editScope);
router.get('/birthdays', requireFunction(FUNCTIONS.VIEW_MEMBERS, FUNCTIONS.VIEW_MEMBERS_SCOPED), controller.birthdays);
// Preferencias PROPIAS de la notificación de cumpleaños (por usuario y club) y envío de prueba.
// Sin requireFunction: también las usa quien no ve Miembros pero tiene la notificación asignada
// (birthdays.service.js decide qué puede cambiar cada uno).
router.get('/birthdays/settings', requireClubMember(), controller.birthdaySettings);
router.put('/birthdays/settings', requireClubMember(), sanitizeBody, validation.birthdaySettings, handleValidation, controller.updateBirthdaySettings);
router.post('/birthdays/send-me', requireClubMember(), sanitizeBody, controller.sendBirthdaysToMe);
// Notificación de cumpleaños de OTROS usuarios del club (asignarla y configurarla).
router.get('/birthdays/assignments', requireFunction(FUNCTIONS.MANAGE_BIRTHDAY_NOTIFICATIONS), controller.birthdayAssignments);
router.put(
  '/birthdays/assignments/:userId',
  requireFunction(FUNCTIONS.MANAGE_BIRTHDAY_NOTIFICATIONS),
  sanitizeBody,
  validation.birthdayAssignment,
  handleValidation,
  controller.updateBirthdayAssignment
);
// Plantilla general (por club y formato) usada para generar la imagen de cada socio — ver
// solo (VIEW_MEMBERS/_SCOPED, la usa cualquiera que pueda generar la imagen de un socio),
// editar (MANAGE_BIRTHDAY_TEMPLATE, solo quien administra el diseño).
router.get('/birthdays/template', requireFunction(FUNCTIONS.VIEW_MEMBERS, FUNCTIONS.VIEW_MEMBERS_SCOPED), controller.getBirthdayTemplate);
router.put('/birthdays/template', requireFunction(FUNCTIONS.MANAGE_BIRTHDAY_TEMPLATE), sanitizeBody, controller.saveBirthdayTemplate);
router.post(
  '/birthdays/template/images',
  requireFunction(FUNCTIONS.MANAGE_BIRTHDAY_TEMPLATE),
  uploadFor('birthday-template').single('image'),
  controller.uploadBirthdayTemplateImage
);
router.use('/fields', require('./memberFields.routes'));
// Fichas: selecciones de campos que se piden a cada tipo de miembro (ver memberForms.service.js).
router.use('/forms', require('./memberForms.routes'));

// Columnas que muestra el listado (tarjetas y tabla): las elige quien configura la ficha.
router.get('/list-settings', requireFunction(FUNCTIONS.VIEW_MEMBERS, FUNCTIONS.VIEW_MEMBERS_SCOPED, FUNCTIONS.VIEW_MEMBER_FIELDS), controller.listSettings);
router.put('/list-settings', requireFunction(FUNCTIONS.EDIT_MEMBER_FIELDS), sanitizeBody, [body('columns').isArray({ max: 12 }), body('columns.*').isString()], handleValidation, controller.updateListSettings);

// Excel: exportar la lista (con los mismos filtros del listado) e importar miembros desde una planilla.
const xlsxUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) =>
    /spreadsheetml|excel|octet-stream/.test(file.mimetype) || /\.xlsx$/i.test(file.originalname) ? cb(null, true) : cb(AppError.badRequest('Sube la planilla en formato .xlsx.')),
});
router.get('/export', requireFunction(FUNCTIONS.VIEW_MEMBERS, FUNCTIONS.VIEW_MEMBERS_SCOPED), controller.exportMembers);
router.get('/import/template', requireFunction(FUNCTIONS.CREATE_MEMBERS), controller.importTemplate);
router.post('/import', requireFunction(FUNCTIONS.CREATE_MEMBERS), xlsxUpload.single('file'), controller.importMembers);

// Formulario de la ficha exigida por la invitación — mismo criterio que POST /me: sin
// requireFunction, el service valida que la membresía tenga la ficha pendiente. No depende de
// que el formulario público de inscripción esté activo.
router.get('/me/form', applicationsController.invitationForm);

// Autoservicio de ficha (ver memberApplications.service.js#submitForAccount) — deliberadamente SIN
// requireFunction: es la única acción permitida mientras la membresía tenga
// `requires_profile_completion` (permission.middleware.js#assertProfileNotPending bloquea todo
// lo demás). El propio service valida que el actor realmente tenga una ficha pendiente.
// Multipart: `fields` (JSON) + las imágenes/archivos de la ficha como `file_<id del campo>`.
router.post(
  '/me',
  uploadPrivate(TEMP_SUBDIR, { maxFiles: 20, errorMessage: 'Formato no permitido. Usa PDF, imagen (PNG/JPG/WEBP) o Word.' }).any(),
  parseMultipartFields,
  sanitizeBody,
  validation.createMemberSelf,
  handleValidation,
  controller.createSelf
);

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
// "En el club" (estado y fecha de ingreso) tiene su propio permiso (sql/081); PUT /:id ya no los cambia sin él.
router.put('/:id/membership', requireFunction(FUNCTIONS.EDIT_MEMBER_MEMBERSHIP), sanitizeBody, validation.membership, handleValidation, controller.updateMembership);

// Campos de tipo "imagen" (públicas, ej. la foto que usan las plantillas de cumpleaños) y de tipo
// "archivos" (privados, se suben a un campo con `fieldId`).
router.post('/:id/fields/:fieldId/image', requireFunction(FUNCTIONS.EDIT_MEMBERS), validation.memberId, handleValidation, uploadFor('member-photos').single('image'), controller.setImage);
router.delete('/:id/fields/:fieldId/image', requireFunction(FUNCTIONS.EDIT_MEMBERS), validation.memberId, handleValidation, controller.removeImage);
router.get('/:id/documents', requireFunction(FUNCTIONS.VIEW_MEMBERS, FUNCTIONS.VIEW_MEMBERS_SCOPED), validation.memberId, handleValidation, controller.listDocuments);
router.post(
  '/:id/documents',
  requireFunction(FUNCTIONS.EDIT_MEMBERS),
  validation.memberId,
  handleValidation,
  uploadPrivate('member-documents', { errorMessage: 'Formato no permitido. Usa PDF, imagen (PNG/JPG/WEBP) o Word.' }).single('document'),
  controller.addDocument
);
router.get('/:id/documents/:documentId/download', requireFunction(FUNCTIONS.VIEW_MEMBERS, FUNCTIONS.VIEW_MEMBERS_SCOPED), validation.memberId, handleValidation, controller.downloadDocument);
router.delete('/:id/documents/:documentId', requireFunction(FUNCTIONS.EDIT_MEMBERS), validation.memberId, handleValidation, controller.removeDocument);

// Editar datos de la ficha con "Editar miembros" o con fichas/campos específicos (sql/080): solo
// `fields` (+ `newVersion`); el service revisa qué campos puede tocar el actor.
const FIELD_EDITORS = [FUNCTIONS.EDIT_MEMBERS, FUNCTIONS.EDIT_MEMBER_FORMS_SCOPED, FUNCTIONS.EDIT_MEMBER_FIELD_VALUES_SCOPED];
router.put('/:id/fields', requireFunction(...FIELD_EDITORS), sanitizeBody, [...validation.memberId, body('fields').isObject(), body('newVersion').optional().isBoolean()], handleValidation, controller.updateFields);

// Versiones de cada ficha (sql/078): verlas es ver al miembro; eliminarlas, un permiso aparte.
router.get('/:id/form-versions', requireFunction(FUNCTIONS.VIEW_MEMBERS, FUNCTIONS.VIEW_MEMBERS_SCOPED), validation.memberId, handleValidation, controller.listFormVersions);
// "Usar como principal": con Editar miembros o con la ficha en Editar fichas específicas (lo revisa el service).
router.post('/:id/form-versions/:versionId/activate', requireFunction(FUNCTIONS.EDIT_MEMBERS, FUNCTIONS.EDIT_MEMBER_FORMS_SCOPED), validation.formVersion, handleValidation, controller.activateFormVersion);
router.delete('/:id/form-versions/:versionId', requireFunction(FUNCTIONS.DELETE_MEMBER_FORM_VERSIONS), validation.formVersion, handleValidation, controller.removeFormVersion);

router.delete('/:id', requireFunction(FUNCTIONS.DELETE_MEMBERS), validation.memberId, handleValidation, controller.remove);

router.put(
  '/:id/link-user',
  requireFunction(FUNCTIONS.LINK_MEMBER_USER),
  sanitizeBody,
  validation.linkUser,
  handleValidation,
  controller.linkUser
);

// Apoderados de la ficha: otros MIEMBROS del club vinculados a este (con o sin cuenta; si tienen
// cuenta, la ven en "Mi club"; ver selfService.service.js). Ver y editar tienen su permiso (sql/081).
const guardians = require('../controllers/guardians.controller');
const meValidation = require('../validations/me.validation');
const GUARDIAN_EDITORS = [FUNCTIONS.EDIT_MEMBER_GUARDIANS];
const GUARDIAN_VIEWERS = [FUNCTIONS.VIEW_MEMBER_GUARDIANS, FUNCTIONS.EDIT_MEMBER_GUARDIANS];
router.get('/:id/guardians', requireFunction(...GUARDIAN_VIEWERS), meValidation.guardianParams, handleValidation, guardians.list);
router.get('/:id/wards', requireFunction(...GUARDIAN_VIEWERS), meValidation.guardianParams, handleValidation, guardians.wards);
router.post('/:id/guardians', requireFunction(...GUARDIAN_EDITORS), sanitizeBody, meValidation.addGuardian, handleValidation, guardians.add);
router.delete('/:id/guardians/:guardianId', requireFunction(...GUARDIAN_EDITORS), meValidation.removeGuardian, handleValidation, guardians.remove);

// Grupos de UNA ficha (pestaña Grupos del miembro): ver la ficha + administrar grupos.
const memberGroupsService = require('../services/memberGroups.service');
const membersService = require('../services/members.service');
const ApiResponse = require('../helpers/ApiResponse');
const asyncHandler = require('../helpers/asyncHandler');
router.put(
  '/:id/groups',
  requireFunction(FUNCTIONS.MANAGE_MEMBER_GROUPS),
  sanitizeBody,
  validation.setGroups,
  handleValidation,
  asyncHandler(async (req, res) => {
    const memberId = Number(req.params.id);
    await membersService.getById(req.club.id, memberId, req.authContext, req.user.id);
    const data = await memberGroupsService.setMemberGroups(req.club.id, memberId, req.body.groupIds, req.user.id);
    return ApiResponse.ok(res, data, 'Grupos actualizados.');
  })
);

module.exports = router;
