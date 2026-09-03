const cron = require('node-cron');
const sessionsRepository = require('../repositories/sessions.repository');
const invitationsRepository = require('../repositories/invitations.repository');
const logger = require('../helpers/logger');

/**
 * Tareas de limpieza periódica:
 * - Purga refresh tokens expirados hace más de 7 días.
 * - Marca como "expired" las invitaciones activas cuya fecha de expiración pasó.
 * Se ejecuta todos los días a las 03:00 (hora del servidor).
 */
function registerCleanupCron() {
  cron.schedule('0 3 * * *', async () => {
    try {
      const purged = await sessionsRepository.purgeExpired();
      const expired = await invitationsRepository.expireOutdated();
      logger.info(`[cron] Limpieza ejecutada: ${purged} refresh tokens purgados, ${expired} invitaciones expiradas.`);
    } catch (error) {
      logger.error('[cron] Error en limpieza periódica', { error: error.message });
    }
  });
}

module.exports = registerCleanupCron;
