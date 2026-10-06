const router = require('express').Router();
const { param, query, body } = require('express-validator');
const controller = require('../controllers/memberApplications.controller');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { clubContextMiddleware } = require('../middlewares/club.middleware');
const { requireFunction } = require('../middlewares/permission.middleware');
const { FUNCTIONS } = require('../config/constants');

router.use(authMiddleware, clubContextMiddleware);

const applicationId = [param('id').isInt({ min: 1 }).withMessage('Identificador de solicitud inválido.')];

// Formulario público de inscripción: activar/desactivar (Configuración → Ficha).
router.get('/settings', requireFunction(FUNCTIONS.VIEW_MEMBER_FIELDS), controller.getSetting);
router.put('/settings', requireFunction(FUNCTIONS.EDIT_MEMBER_FIELDS), sanitizeBody, [body('enabled').optional().isBoolean().toBoolean(), body('groups').optional().isObject(), body('groups.mode').optional().isIn(['off', 'optional', 'required']), body('groups.groupIds').optional().isArray()], handleValidation, controller.updateSetting);

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
