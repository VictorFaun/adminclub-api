const { body, param } = require('express-validator');

// PUT /:id/read y PUT /read-all no tenían ninguna validación: `Number(req.params.id)` con un
// id no numérico da NaN, que se pasaba tal cual a la query SQL (repositories/notifications.
// repository.js) en vez de cortar con un 422 limpio antes de tocar la base.
const markReadParams = [param('id').isInt({ min: 1 }).withMessage('Identificador de notificación inválido.')];

const markAllRead = [body('clubId').optional({ nullable: true }).isInt({ min: 1 }).withMessage('clubId inválido.')];

const broadcast = [
  body('title').trim().notEmpty().withMessage('El título es obligatorio.').isLength({ max: 150 }),
  body('message').trim().notEmpty().withMessage('El mensaje es obligatorio.').isLength({ max: 500 }),
  body('type').optional().isIn(['info', 'success', 'warning', 'error']),
  body('link').optional({ nullable: true }).trim().isLength({ max: 500 }),
  // Destinatarios: los tres se pueden combinar (ej. todo el rol "Socios" + un jugador puntual)
  // — se validan por separado, y que haya elegido al menos uno se exige aparte más abajo.
  body('targetAll').optional().isBoolean().withMessage('targetAll debe ser booleano.').toBoolean(),
  body('roleIds').optional().isArray().withMessage('roleIds debe ser un arreglo.'),
  body('roleIds.*').isInt({ min: 1 }).withMessage('roleIds debe contener solo ids numéricos.').toInt(),
  body('userIds').optional().isArray().withMessage('userIds debe ser un arreglo.'),
  body('userIds.*').isInt({ min: 1 }).withMessage('userIds debe contener solo ids numéricos.').toInt(),
  body().custom((value) => {
    const hasTarget = value.targetAll === true || (value.roleIds ?? []).length > 0 || (value.userIds ?? []).length > 0;
    if (!hasTarget) throw new Error('Selecciona al menos un destinatario: todos, por rol, o usuarios específicos.');
    return true;
  }),
];

module.exports = { broadcast, markReadParams, markAllRead };
