const cron = require('node-cron');
const birthdaysService = require('../services/birthdays.service');
const logger = require('../helpers/logger');

/**
 * Notificación de cumpleaños: cada día a las 08:00 (hora del servidor) le llega a quien lo activó
 * (Miembros → Cumpleaños) el/los cumpleaños con foto y datos del cumpleañero — como notificación
 * en la app, que además dispara un correo con el mismo contenido (ver
 * notifications.service.js#notifyUser).
 */
function registerBirthdayEmailsCron() {
  cron.schedule('0 8 * * *', async () => {
    try {
      const sent = await birthdaysService.sendDailyDigests();
      logger.info(`[cron] Notificaciones de cumpleaños enviadas: ${sent}.`);
    } catch (error) {
      logger.error('[cron] Error en notificaciones de cumpleaños', { error: error.message });
    }
  });
}

module.exports = registerBirthdayEmailsCron;
