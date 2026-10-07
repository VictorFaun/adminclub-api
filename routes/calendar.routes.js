const router = require('express').Router();
const controller = require('../controllers/calendar.controller');
const validation = require('../validations/calendar.validation');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { clubContextMiddleware } = require('../middlewares/club.middleware');
const { requireClubMember } = require('../middlewares/permission.middleware');

// Calendario (ver calendar.service.js): personal de cada miembro del club, sin funcionalidad
// propia — lo que se muestra además de sus eventos (cumpleaños, entrenamientos) lo decide el
// service según sus permisos.
router.use(authMiddleware, clubContextMiddleware, requireClubMember());

router.get('/feed', validation.feed, handleValidation, controller.feed);
router.get('/users', controller.shareableUsers);
router.get('/events/:id', validation.eventId, handleValidation, controller.getEvent);
router.post('/events', sanitizeBody, validation.saveEvent, handleValidation, controller.createEvent);
router.put('/events/:id', sanitizeBody, validation.eventId, validation.saveEvent, handleValidation, controller.updateEvent);
router.delete('/events/:id', validation.eventId, handleValidation, controller.removeEvent);
// Un participante deja de ver un evento que le compartieron.
router.delete('/events/:id/participation', validation.eventId, handleValidation, controller.leaveEvent);

module.exports = router;
