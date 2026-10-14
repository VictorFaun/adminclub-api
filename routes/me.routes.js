const router = require('express').Router();
const controller = require('../controllers/me.controller');
const validation = require('../validations/me.validation');
const { handleValidation, sanitizeBody } = require('../middlewares/validation.middleware');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { clubContextMiddleware } = require('../middlewares/club.middleware');
const { requireClubMember } = require('../middlewares/permission.middleware');
const { uploadFor } = require('../middlewares/upload.middleware');
const { uploadPrivate, PROOF_MIME_TO_EXT } = require('../middlewares/privateUpload.middleware');
const { selfProofUploadRateLimit } = require('../middlewares/rateLimit.middleware');

// "Mi club": lo que el socio (o apoderado) ve de sus fichas. Sin requireFunction: no depende de
// roles; cada endpoint revalida en selfService.service.js que la ficha sea de la cuenta.
router.use(authMiddleware, clubContextMiddleware, requireClubMember());

router.get('/club', controller.overview);
router.get('/payments/:paymentId/receipt', validation.paymentId, handleValidation, controller.receipt);

router.get('/members/:memberId/summary', validation.memberId, handleValidation, controller.summary);
router.get('/members/:memberId/payments', validation.memberId, handleValidation, controller.payments);
router.get('/members/:memberId/pay-options', validation.memberId, handleValidation, controller.payOptions);
router.get('/members/:memberId/proofs', validation.memberId, handleValidation, controller.proofs);
router.post(
  '/members/:memberId/proofs',
  selfProofUploadRateLimit,
  validation.memberId,
  handleValidation,
  uploadPrivate('payment-proofs', {
    mimeToExt: PROOF_MIME_TO_EXT,
    maxMb: 15,
    errorMessage: 'Formato no permitido. Sube una imagen (PNG/JPG/WEBP) o un PDF.',
  }).single('proof'),
  controller.submitProof
);
router.get('/members/:memberId/attendance', validation.memberId, handleValidation, controller.attendance);
router.get('/members/:memberId/profile', validation.memberId, handleValidation, controller.profile);
router.put('/members/:memberId/profile', sanitizeBody, validation.updateProfile, handleValidation, controller.updateProfile);
router.post('/members/:memberId/fields/:fieldId/image', validation.memberId, validation.fieldId, handleValidation, uploadFor('member-photos').single('image'), controller.setImage);
router.delete('/members/:memberId/fields/:fieldId/image', validation.memberId, validation.fieldId, handleValidation, controller.removeImage);
router.get('/members/:memberId/guardians', validation.memberId, handleValidation, controller.guardians);
router.post('/members/:memberId/guardians', sanitizeBody, validation.inviteGuardian, handleValidation, controller.inviteGuardian);

module.exports = router;
