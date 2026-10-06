const router = require('express').Router();
const controller = require('../controllers/paymentProofs.controller');
const { uploadPrivate, PROOF_MIME_TO_EXT } = require('../middlewares/privateUpload.middleware');
const { publicPaymentsReadRateLimit, publicPaymentsLookupRateLimit, publicPaymentsUploadRateLimit } = require('../middlewares/rateLimit.middleware');

// SIN authMiddleware a propósito: es la página pública de pagos del club (`/pay/<código-del-club>`).
// Solo responde si el club la activó; la persona se identifica con su RUT y nada más que su primer
// nombre y sus cobros sale de acá. Todo limitado por IP.
router.get('/:code', publicPaymentsReadRateLimit, controller.publicClub);
router.get('/:code/lookup', publicPaymentsLookupRateLimit, controller.publicLookup);

router.post(
  '/:code/proofs',
  publicPaymentsUploadRateLimit,
  uploadPrivate('payment-proofs', {
    mimeToExt: PROOF_MIME_TO_EXT,
    maxMb: 8,
    errorMessage: 'Formato no permitido. Sube una imagen (PNG/JPG/WEBP) o un PDF.',
  }).single('proof'),
  controller.publicSubmit
);

module.exports = router;
