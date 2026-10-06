const router = require('express').Router();
const multer = require('multer');
const AppError = require('../helpers/AppError');
const { body } = require('express-validator');
const controller = require('../controllers/members.controller');
const validation = require('../validations/members.validation');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { clubContextMiddleware } = require('../middlewares/club.middleware');
const { requireFunction } = require('../middlewares/permission.middleware');
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
router.get('/birthdays', requireFunction(FUNCTIONS.VIEW_MEMBERS, FUNCTIONS.VIEW_MEMBERS_SCOPED), controller.birthdays);
// Preferencias PROPIAS del correo de cumpleaños (por usuario y club) y envío de prueba.
router.get('/birthdays/settings', requireFunction(FUNCTIONS.VIEW_MEMBERS, FUNCTIONS.VIEW_MEMBERS_SCOPED), controller.birthdaySettings);
router.put('/birthdays/settings', requireFunction(FUNCTIONS.VIEW_MEMBERS, FUNCTIONS.VIEW_MEMBERS_SCOPED), sanitizeBody, controller.updateBirthdaySettings);
router.post('/birthdays/send-me', requireFunction(FUNCTIONS.VIEW_MEMBERS, FUNCTIONS.VIEW_MEMBERS_SCOPED), sanitizeBody, controller.sendBirthdaysToMe);
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

// Autoservicio de ficha (ver members.service.js#createSelf) — deliberadamente SIN
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
