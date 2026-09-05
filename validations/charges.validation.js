const { body, param } = require('express-validator');

const HEX_COLOR = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

const chargeId = [param('id').isInt({ min: 1 }).withMessage('Identificador de cobro inválido.')];

// Cada target (grupo/etiqueta/miembro) lleva su propio monto — ver charges.repository.js#resolveAmounts.
const targetFields = [
  body('targetGroups').optional().isArray(),
  body('targetGroups.*.groupId').isInt({ min: 1 }).withMessage('Grupo inválido.'),
  body('targetGroups.*.amount').isFloat({ min: 0.01 }).withMessage('El monto debe ser mayor a cero.'),
  body('targetTags').optional().isArray(),
  body('targetTags.*.tagId').isInt({ min: 1 }).withMessage('Etiqueta inválida.'),
  body('targetTags.*.amount').isFloat({ min: 0.01 }).withMessage('El monto debe ser mayor a cero.'),
  body('targetMembers').optional().isArray(),
  body('targetMembers.*.memberId').isInt({ min: 1 }).withMessage('Miembro inválido.'),
  body('targetMembers.*.amount').isFloat({ min: 0.01 }).withMessage('El monto debe ser mayor a cero.'),
  body('exclusionMemberIds').optional().isArray(),
  body('exclusionMemberIds.*').optional().isInt({ min: 1 }),
];

const createCharge = [
  body('name').trim().notEmpty().withMessage('El nombre del cobro es obligatorio.').isLength({ max: 150 }),
  body('description').optional({ nullable: true }).trim().isLength({ max: 500 }),
  body('color').optional().matches(HEX_COLOR).withMessage('Color inválido.'),
  body('amount').isFloat({ min: 0.01 }).withMessage('El monto debe ser mayor a cero.'),
  body('recurrence').isIn(['once', 'monthly', 'yearly']).withMessage('Recurrencia inválida.'),
  body('startDate').isISO8601().withMessage('Fecha de inicio inválida.'),
  body('dueDay').optional({ nullable: true }).isInt({ min: 1, max: 31 }),
  body('dueMonth').optional({ nullable: true }).isInt({ min: 1, max: 12 }),
  body('endDate').optional({ nullable: true }).isISO8601().withMessage('Fecha de término inválida.'),
  body('status').optional().isIn(['active', 'inactive']),
  // 'external' se valida a fondo en charges.service.js#_assertPurposeValid (exige cobro único +
  // responsable) — acá solo se exige que sea uno de los 2 valores posibles.
  body('purpose').optional().isIn(['treasury', 'external']),
  body('responsibleMemberId').optional({ nullable: true }).isInt({ min: 1 }).withMessage('Responsable inválido.'),
  ...targetFields,
];

const updateCharge = [
  ...chargeId,
  body('name').optional().trim().isLength({ min: 1, max: 150 }),
  body('description').optional({ nullable: true }).trim().isLength({ max: 500 }),
  body('color').optional().matches(HEX_COLOR).withMessage('Color inválido.'),
  body('amount').optional().isFloat({ min: 0.01 }).withMessage('El monto debe ser mayor a cero.'),
  body('recurrence').optional().isIn(['once', 'monthly', 'yearly']),
  body('startDate').optional().isISO8601(),
  body('dueDay').optional({ nullable: true }).isInt({ min: 1, max: 31 }),
  body('dueMonth').optional({ nullable: true }).isInt({ min: 1, max: 12 }),
  body('endDate').optional({ nullable: true }).isISO8601(),
  body('status').optional().isIn(['active', 'inactive']),
  body('purpose').optional().isIn(['treasury', 'external']),
  body('responsibleMemberId').optional({ nullable: true }).isInt({ min: 1 }).withMessage('Responsable inválido.'),
  ...targetFields,
];

module.exports = { chargeId, createCharge, updateCharge };
