const router = require('express').Router();
const controller = require('../controllers/users.controller');
const validation = require('../validations/users.validation');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { clubContextMiddleware } = require('../middlewares/club.middleware');
const { requireFunction } = require('../middlewares/permission.middleware');
const { uploadFor } = require('../middlewares/upload.middleware');
const audit = require('../middlewares/audit.middleware');
const { FUNCTIONS } = require('../config/constants');

router.use(authMiddleware);

// --- perfil propio (no requiere club) ---
router.get('/me', controller.me);
router.put('/me', sanitizeBody, validation.updateMe, handleValidation, controller.updateMe);
router.post('/me/avatar', uploadFor('avatars').single('avatar'), controller.updateMyAvatar);

// --- administración de plataforma (todos los usuarios, sin club activo) ---
// Prefijo literal '/platform' registrado ANTES de clubContextMiddleware y de las rutas
// '/:id' de más abajo, mismo truco que '/lookup': si no, Express tomaría "platform"
// como el parámetro :id de la ruta club-scoped.
router.get(
  '/platform',
  requireFunction(FUNCTIONS.VIEW_ALL_USERS),
  validation.listAllUsers,
  handleValidation,
  controller.listAllPlatform
);
router.put(
  '/platform/:id',
  requireFunction(FUNCTIONS.EDIT_ALL_USERS),
  sanitizeBody,
  validation.updateGlobalUser,
  handleValidation,
  controller.updateGlobal
);
router.put(
  '/platform/:id/status',
  requireFunction(FUNCTIONS.SUSPEND_ALL_USERS),
  sanitizeBody,
  validation.updateGlobalStatus,
  handleValidation,
  controller.updateStatusGlobal
);

// --- gestión de miembros del club activo ---
router.use(clubContextMiddleware);

router.get('/', requireFunction(FUNCTIONS.VIEW_USERS), validation.listUsers, handleValidation, controller.list);

// Sin middleware `audit()` aquí: registraría `req.body` tal cual como "changes",
// lo que dejaría la contraseña en texto plano en el registro de auditoría. El
// servicio ya deja su propio registro de auditoría (sin la contraseña).
router.post('/', requireFunction(FUNCTIONS.CREATE_USERS), sanitizeBody, validation.createUser, handleValidation, controller.create);

// Antes de '/:id': si no, Express tomaría "lookup" como el parámetro :id.
router.get('/lookup', requireFunction(FUNCTIONS.VIEW_USERS), validation.lookupByEmail, handleValidation, controller.lookupByEmail);

router.post(
  '/:id/add-existing',
  requireFunction(FUNCTIONS.CREATE_USERS),
  sanitizeBody,
  validation.addExisting,
  handleValidation,
  controller.addExisting
);

router.get('/:id', requireFunction(FUNCTIONS.VIEW_USERS), validation.userId, handleValidation, controller.getById);
router.get('/:id/activity', requireFunction(FUNCTIONS.VIEW_USERS), validation.userId, handleValidation, controller.activity);

router.put(
  '/:id',
  requireFunction(FUNCTIONS.EDIT_USERS),
  sanitizeBody,
  validation.updateUser,
  handleValidation,
  audit('USER_UPDATED', 'user'),
  controller.update
);

router.put(
  '/:id/status',
  requireFunction(FUNCTIONS.SUSPEND_USERS),
  sanitizeBody,
  validation.updateStatus,
  handleValidation,
  controller.updateStatus
);

router.put(
  '/:id/roles',
  requireFunction(FUNCTIONS.ASSIGN_USER_ROLES),
  sanitizeBody,
  validation.updateRoles,
  handleValidation,
  controller.updateRoles
);

router.delete(
  '/:id',
  requireFunction(FUNCTIONS.DELETE_USERS),
  validation.userId,
  handleValidation,
  controller.remove
);

module.exports = router;
