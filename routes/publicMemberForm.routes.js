const router = require('express').Router();
const { body } = require('express-validator');
const controller = require('../controllers/memberApplications.controller');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { publicPaymentsReadRateLimit, publicMemberFormSubmitRateLimit } = require('../middlewares/rateLimit.middleware');
const { uploadPrivate } = require('../middlewares/privateUpload.middleware');
const { TEMP_SUBDIR, parseMultipartFields } = require('../helpers/memberUploads');

// SIN authMiddleware a propósito: formulario público de inscripción del club
// (`/inscripcion/<código-del-club>`). Solo responde si el club lo activó; lo enviado queda como
// solicitud pendiente de revisión, nunca crea una ficha directamente. Limitado por IP.
router.get('/:code', publicPaymentsReadRateLimit, controller.publicForm);
router.post(
  '/:code',
  publicMemberFormSubmitRateLimit,
  // Multipart: `fields` (JSON) + imágenes/archivos de la ficha como `file_<id del campo>` (20MB c/u).
  uploadPrivate(TEMP_SUBDIR, { maxFiles: 20, errorMessage: 'Formato no permitido. Usa PDF, imagen (PNG/JPG/WEBP) o Word.' }).any(),
  parseMultipartFields,
  sanitizeBody,
  // Los datos llegan en `fields` ({ código: valor }) y se validan contra la ficha del club.
  [body('fields').isObject().withMessage('Faltan los datos de la ficha.'), body('message').optional({ nullable: true }).isString().isLength({ max: 500 })],
  handleValidation,
  controller.publicSubmit
);

module.exports = router;
