const router = require('express').Router();
const controller = require('../controllers/functions.controller');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { clubContextMiddleware } = require('../middlewares/club.middleware');
const { requireFunction } = require('../middlewares/permission.middleware');
const { FUNCTIONS } = require('../config/constants');

/**
 * Catálogo de funcionalidades del sistema (usado por la UI de gestión de roles
 * para construir el listado de casillas de verificación por categoría). Solo
 * las asignables a un rol de club (is_club_assignable = 1).
 */
router.get('/', authMiddleware, clubContextMiddleware, requireFunction(FUNCTIONS.VIEW_FUNCTIONS), controller.list);

/**
 * Catálogo COMPLETO (incluidas las funcionalidades exclusivas de plataforma) — vista de
 * nivel plataforma, sin club activo, igual que GET /clubs (VIEW_ALL_CLUBS).
 */
router.get('/all', authMiddleware, requireFunction(FUNCTIONS.VIEW_ALL_FUNCTIONS), controller.listAll);

module.exports = router;
