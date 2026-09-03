const auditRepository = require('../repositories/audit.repository');
const logger = require('../helpers/logger');

/**
 * Middleware factory que registra una acción de auditoría cuando la respuesta
 * termina con un status 2xx. No bloquea la respuesta (fire-and-forget) y
 * nunca debe hacer fallar la request si el log falla.
 * @param {string} action p.ej. "ROLE_DELETED", "USER_SUSPENDED"
 * @param {string} entityType p.ej. "role", "user", "club"
 * @param {(req) => number|string} [getEntityId]
 */
function audit(action, entityType, getEntityId = (req) => req.params.id) {
  return (req, res, next) => {
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        auditRepository
          .logAction({
            userId: req.user ? req.user.id : null,
            clubId: req.club ? req.club.id : null,
            action,
            entityType,
            entityId: getEntityId(req) || null,
            changes: req.body && Object.keys(req.body).length ? req.body : null,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'] || null,
          })
          .catch((err) => logger.error('No se pudo registrar auditoría', { action, error: err.message }));
      }
    });
    next();
  };
}

module.exports = audit;
