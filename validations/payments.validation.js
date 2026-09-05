const { body, param, query } = require('express-validator');

const memberIdParam = [param('memberId').isInt({ min: 1 }).withMessage('Identificador de miembro inválido.')];
const paymentId = [param('id').isInt({ min: 1 }).withMessage('Identificador de pago inválido.')];
const instanceIdParam = [param('instanceId').isInt({ min: 1 }).withMessage('Identificador de período inválido.')];
const chargeMatrix = [
  param('chargeId').isInt({ min: 1 }).withMessage('Identificador de cobro inválido.'),
  query('anchor')
    .optional()
    .matches(/^(\d{4}-\d{2}|\d{4})$/)
    .withMessage('Período inválido.'),
  // Cuántas columnas de período pedir — las decide el frontend según cuántas entran sin scroll
  // horizontal (ver payments.service.js#_matrixPeriods, que igual las clampea 1-18).
  query('columns').optional().isInt({ min: 1, max: 18 }).withMessage('Cantidad de columnas inválida.'),
];
const ensureInstance = [
  param('chargeId').isInt({ min: 1 }).withMessage('Identificador de cobro inválido.'),
  param('memberId').isInt({ min: 1 }).withMessage('Identificador de miembro inválido.'),
  body('periodKey')
    .trim()
    .matches(/^(\d{4}-\d{2}|\d{4}|unico)$/)
    .withMessage('Período inválido.'),
];

// Un pago corresponde a UN solo período (completo o abono) — ya no se aceptan varios a la vez.
const createPayment = [
  body('memberId').isInt({ min: 1 }).withMessage('Debes indicar el miembro que paga.'),
  body('chargeInstanceId').isInt({ min: 1 }).withMessage('Debes indicar el período a pagar.'),
  body('amount').isFloat({ min: 0.01 }).withMessage('El monto debe ser mayor a cero.'),
  body('paidAt').optional().isISO8601().withMessage('Fecha de pago inválida.'),
  body('note').optional({ nullable: true }).trim().isLength({ max: 255 }),
  // `null`/ausente = Tesorería (pago directo); el único otro valor válido es el responsable del
  // cobro, validado contra eso en el service (acá solo se exige que sea un id numérico).
  body('paidToMemberId').optional({ nullable: true }).isInt({ min: 1 }).withMessage('Destinatario del pago inválido.'),
];

// A diferencia de createPayment, acá no se puede cambiar a qué período apunta un pago — solo
// monto/fecha/nota/destinatario (ver payments.service.js#update).
const updatePayment = [
  ...paymentId,
  body('amount').optional().isFloat({ min: 0.01 }).withMessage('El monto debe ser mayor a cero.'),
  body('paidAt').optional().isISO8601().withMessage('Fecha de pago inválida.'),
  body('note').optional({ nullable: true }).trim().isLength({ max: 255 }),
  body('paidToMemberId').optional({ nullable: true }).isInt({ min: 1 }).withMessage('Destinatario del pago inválido.'),
];

const exemptInstance = [
  ...instanceIdParam,
  body('reason').optional({ nullable: true }).trim().isLength({ max: 255 }),
  body('type').optional().isIn(['frozen', 'not_applicable']).withMessage('Tipo de exención inválido.'),
];

const chargeIdParam = [param('chargeId').isInt({ min: 1 }).withMessage('Identificador de cobro inválido.')];
const settlementId = [param('id').isInt({ min: 1 }).withMessage('Identificador de transferencia inválido.')];
const listSettlements = [
  ...chargeIdParam,
  param('periodKey')
    .matches(/^(\d{4}-\d{2}|\d{4}|unico)$/)
    .withMessage('Período inválido.'),
];
const createSettlement = [
  ...chargeIdParam,
  body('periodKey')
    .matches(/^(\d{4}-\d{2}|\d{4}|unico)$/)
    .withMessage('Período inválido.'),
  body('amount').isFloat({ min: 0.01 }).withMessage('El monto debe ser mayor a cero.'),
  body('transferredAt').optional().isISO8601().withMessage('Fecha de transferencia inválida.'),
  body('note').optional({ nullable: true }).trim().isLength({ max: 255 }),
];
const updateSettlement = [
  ...settlementId,
  body('amount').optional().isFloat({ min: 0.01 }).withMessage('El monto debe ser mayor a cero.'),
  body('transferredAt').optional().isISO8601().withMessage('Fecha de transferencia inválida.'),
  body('note').optional({ nullable: true }).trim().isLength({ max: 255 }),
];

module.exports = {
  memberIdParam,
  paymentId,
  instanceIdParam,
  chargeMatrix,
  ensureInstance,
  createPayment,
  updatePayment,
  exemptInstance,
  listSettlements,
  createSettlement,
  updateSettlement,
  settlementId,
};
