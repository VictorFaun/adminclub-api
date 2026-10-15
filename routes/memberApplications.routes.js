const router = require('express').Router();
const { param, query, body } = require('express-validator');
const controller = require('../controllers/memberApplications.controller');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { clubContextMiddleware } = require('../middlewares/club.middleware');
const { requireFunction } = require('../middlewares/permission.middleware');
const { FUNCTIONS } = require('../config/constants');
const consentsController = require('../controllers/publicFormConsents.controller');
const { uploadPrivate } = require('../middlewares/privateUpload.middleware');
const { CONSENT_FILES_SUBDIR } = require('../services/publicFormConsents.service');

router.use(authMiddleware, clubContextMiddleware);

const applicationId = [param('id').isInt({ min: 1 }).withMessage('Identificador de solicitud inválido.')];

// Formulario público de inscripción: activar/desactivar (Configuración → Ficha).
router.get('/settings', requireFunction(FUNCTIONS.VIEW_MEMBER_FIELDS), controller.getSetting);
router.put('/settings', requireFunction(FUNCTIONS.EDIT_MEMBER_FIELDS), sanitizeBody, [body('enabled').optional().isBoolean().toBoolean(), body('askMessage').optional().isBoolean().toBoolean(), body('groups').optional().isObject(), body('groups.mode').optional().isIn(['off', 'optional', 'required']), body('groups.groupIds').optional().isArray()], handleValidation, controller.updateSetting);

// Consentimientos y documentos del formulario (uso de imagen, términos, reglamento... con PDFs).
const consentId = [param('consentId').isInt({ min: 1 }).withMessage('Consentimiento inválido.')];
const consentBody = [
  body('title').optional().isString().isLength({ max: 150 }),
  body('body').optional({ nullable: true }).isString().isLength({ max: 20000 }),
  body('checkboxLabel').optional().isString().isLength({ max: 300 }),
  body('isRequired').optional().isBoolean().toBoolean(),
  body('isActive').optional().isBoolean().toBoolean(),
];
router.get('/consents', requireFunction(FUNCTIONS.VIEW_MEMBER_FIELDS), consentsController.list);
router.post('/consents', requireFunction(FUNCTIONS.EDIT_MEMBER_FIELDS), sanitizeBody, consentBody, handleValidation, consentsController.create);
router.put('/consents/order', requireFunction(FUNCTIONS.EDIT_MEMBER_FIELDS), [body('ids').isArray()], handleValidation, consentsController.reorder);
router.put('/consents/:consentId', requireFunction(FUNCTIONS.EDIT_MEMBER_FIELDS), sanitizeBody, [...consentId, ...consentBody], handleValidation, consentsController.update);
router.delete('/consents/:consentId', requireFunction(FUNCTIONS.EDIT_MEMBER_FIELDS), consentId, handleValidation, consentsController.remove);
router.post(
  '/consents/:consentId/files',
  requireFunction(FUNCTIONS.EDIT_MEMBER_FIELDS),
  uploadPrivate(CONSENT_FILES_SUBDIR, { mimeToExt: { 'application/pdf': '.pdf' }, maxMb: 20, maxFiles: 10, errorMessage: 'Solo se aceptan archivos PDF.' }).array('files', 10),
  consentId,
  handleValidation,
  consentsController.addFiles
);
router.get('/consents/:consentId/files/:fileId', requireFunction(FUNCTIONS.VIEW_MEMBER_FIELDS), [...consentId, param('fileId').isInt({ min: 1 })], handleValidation, consentsController.downloadFile);
router.delete('/consents/:consentId/files/:fileId', requireFunction(FUNCTIONS.EDIT_MEMBER_FIELDS), [...consentId, param('fileId').isInt({ min: 1 })], handleValidation, consentsController.removeFile);

router.get('/', requireFunction(FUNCTIONS.VIEW_MEMBERS), [query('status').optional().isIn(['pending', 'approved', 'rejected'])], handleValidation, controller.list);
router.get(
  '/:id/files/:fileId',
  requireFunction(FUNCTIONS.VIEW_MEMBERS),
  [...applicationId, param('fileId').isInt({ min: 1 })],
  handleValidation,
  controller.downloadFile
);
router.get('/pending-count', requireFunction(FUNCTIONS.VIEW_MEMBERS, FUNCTIONS.CREATE_MEMBERS), controller.pendingCount);
router.post(
  '/:id/approve',
  requireFunction(FUNCTIONS.CREATE_MEMBERS),
  sanitizeBody,
  [
    ...applicationId,
    body('groupIds').optional().isArray(),
    body('groupIds.*').isInt({ min: 1 }).withMessage('Grupo inválido.'),
    body('joinedOn').optional({ nullable: true }).isISO8601().withMessage('Fecha de ingreso inválida.'),
  ],
  handleValidation,
  controller.approve
);
router.post(
  '/:id/reject',
  requireFunction(FUNCTIONS.CREATE_MEMBERS),
  sanitizeBody,
  [...applicationId, body('reason').optional({ nullable: true }).trim().isLength({ max: 255 })],
  handleValidation,
  controller.reject
);

module.exports = router;
