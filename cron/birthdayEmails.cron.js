const cron = require('node-cron');
const birthdaysService = require('../services/birthdays.service');
const logger = require('../helpers/logger');

/**
 * Notificación de cumpleaños: cada 5 minutos se revisa a quién le toca — cada persona elige la
 * hora (Miembros → Cumpleaños, en su zona horaria o la del club) y le llega una vez al día el/los
 * cumpleaños con foto y datos, como notificación en la app que además dispara un correo con el
 * mismo contenido (ver notifications.service.js#notifyUser y birthdays.service.js#sendDailyDigests).
 */
function registerBirthdayEmailsCron() {
  let running = false;
  cron.schedule('*/5 * * * *', async () => {
    // Una pasada larga (muchas imágenes que componer) no debe solaparse con la siguiente.
    if (running) return;
    running = true;
    try {
      const sent = await birthdaysService.sendDailyDigests();
      if (sent) logger.info(`[cron] Notificaciones de cumpleaños enviadas: ${sent}.`);
    } catch (error) {
      logger.error('[cron] Error en notificaciones de cumpleaños', { error: error.message });
    } finally {
      running = false;
    }
  });
}

module.exports = registerBirthdayEmailsCron;
