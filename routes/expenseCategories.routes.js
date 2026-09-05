const router = require('express').Router();
const controller = require('../controllers/expenseCategories.controller');
const validation = require('../validations/expenseCategories.validation');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { clubContextMiddleware } = require('../middlewares/club.middleware');
const { requireFunction } = require('../middlewares/permission.middleware');
const { FUNCTIONS } = require('../config/constants');

router.use(authMiddleware, clubContextMiddleware);

router.get('/', requireFunction(FUNCTIONS.VIEW_EXPENSES), controller.list);

router.post('/', requireFunction(FUNCTIONS.CREATE_EXPENSES), sanitizeBody, validation.createCategory, handleValidation, controller.create);

router.put('/:id', requireFunction(FUNCTIONS.EDIT_EXPENSES), sanitizeBody, validation.updateCategory, handleValidation, controller.update);

router.delete('/:id', requireFunction(FUNCTIONS.DELETE_EXPENSES), validation.categoryId, handleValidation, controller.remove);

module.exports = router;
