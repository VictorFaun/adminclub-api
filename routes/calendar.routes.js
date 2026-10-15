const router = require('express').Router();
const controller = require('../controllers/calendar.controller');
const validation = require('../validations/calendar.validation');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { clubContextMiddleware } = require('../middlewares/club.middleware');
const { requireClubMember, requireClubAccess } = require('../middlewares/permission.middleware');

// Calendario (ver calendar.service.js): personal de cada miembro del club, sin funcionalidad
// propia — lo que se muestra además de sus eventos (cumpleaños, entrenamientos) lo decide el
// service según sus permisos.
router.use(authMiddleware, clubContextMiddleware);

// El feed también se abre a quien explora el club sin cuenta en él. Con EDIT_ALL_CLUBS (Super
// Admin) usa el calendario completo: sus propios eventos y grupos en ese club, más entrenamientos y
// cumpleaños. Solo con VIEW_ALL_CLUBS queda en solo lectura (entrenamientos y cumpleaños). Nadie
// ve eventos personales ajenos que no le compartieron.
router.get('/feed', requireClubAccess(), validation.feed, handleValidation, controller.feed);

router.use(requireClubMember({ allowGlobalEditors: true }));
router.get('/users', controller.shareableUsers);
router.get('/events/:id', validation.eventId, handleValidation, controller.getEvent);
router.post('/events', sanitizeBody, validation.saveEvent, handleValidation, controller.createEvent);
router.put('/events/:id', sanitizeBody, validation.eventId, validation.saveEvent, handleValidation, controller.updateEvent);
router.delete('/events/:id', validation.eventId, handleValidation, controller.removeEvent);
// Un participante deja de ver un evento que le compartieron.
router.delete('/events/:id/participation', validation.eventId, handleValidation, controller.leaveEvent);

// Grupos de eventos propios (personales, como los eventos).
router.get('/groups', controller.listGroups);
router.post('/groups', sanitizeBody, validation.saveGroup, handleValidation, controller.createGroup);
router.put('/groups/:groupId', sanitizeBody, validation.groupId, validation.saveGroup, handleValidation, controller.updateGroup);
router.delete('/groups/:groupId', validation.groupId, handleValidation, controller.removeGroup);

module.exports = router;
