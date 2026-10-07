const router = require('express').Router();
const controller = require('../controllers/users.controller');
const validation = require('../validations/users.validation');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { clubContextMiddleware } = require('../middlewares/club.middleware');
const { requireFunction } = require('../middlewares/permission.middleware');
const { uploadFor } = require('../middlewares/upload.middleware');
const { FUNCTIONS } = require('../config/constants');

router.use(authMiddleware);

// --- perfil propio (no requiere club) ---
router.get('/me', controller.me);
router.put('/me', sanitizeBody, validation.updateMe, handleValidation, controller.updateMe);
router.post('/me/avatar', uploadFor('avatars').single('avatar'), controller.updateMyAvatar);
// Preferencias de UI por usuario y por club activo (ver userSettings.service.js) — clubId sale
// de X-Club-Id, igual que /me y /me (PUT) de arriba, no de clubContextMiddleware.
router.get('/me/settings', controller.getMySettings);
router.put('/me/settings', sanitizeBody, controller.updateMySettings);
// Invitaciones de clubes recibidas (perfil → Invitaciones): son del usuario, no del club activo.
router.get('/me/invitations', controller.myInvitations);
router.get('/me/invitations/count', controller.myInvitationsCount);
router.post('/me/invitations/:invitationId/accept', validation.invitationId, handleValidation, controller.acceptInvitation);
router.post('/me/invitations/:invitationId/reject', validation.invitationId, handleValidation, controller.rejectInvitation);

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
router.delete(
  '/platform/:id',
  requireFunction(FUNCTIONS.DELETE_ALL_USERS),
  validation.userId,
  handleValidation,
  controller.removeGlobal
);

// --- gestión de miembros del club activo ---
router.use(clubContextMiddleware);

router.get('/', requireFunction(FUNCTIONS.VIEW_USERS), validation.listUsers, handleValidation, controller.list);

// Antes de '/:id': si no, Express tomaría "lookup" como el parámetro :id.
router.get('/lookup', requireFunction(FUNCTIONS.VIEW_USERS), validation.lookupByEmail, handleValidation, controller.lookupByEmail);

// Ya no se agrega directo ni se crean cuentas desde el club: se invita a quien ya tiene cuenta y
// la persona acepta o rechaza desde su perfil (ver clubUserInvitations.service.js).
router.post('/:id/invite', requireFunction(FUNCTIONS.CREATE_USERS), sanitizeBody, validation.inviteUser, handleValidation, controller.invite);
// Antes de '/:id' (DELETE): retirar una invitación aún sin responder.
router.delete('/invitations/:invitationId', requireFunction(FUNCTIONS.CREATE_USERS), validation.invitationId, handleValidation, controller.cancelInvitation);

router.get('/:id', requireFunction(FUNCTIONS.VIEW_USERS), validation.userId, handleValidation, controller.getById);
router.get('/:id/activity', requireFunction(FUNCTIONS.VIEW_USERS), validation.userId, handleValidation, controller.activity);

// Sin PUT '/:id': el club no edita datos personales de sus usuarios (solo roles y estado);
// cada persona los edita desde su perfil (/me).

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
  validation.removeUser,
  handleValidation,
  controller.remove
);

module.exports = router;
