const cron = require('node-cron');
const calendarService = require('../services/calendar.service');
const logger = require('../helpers/logger');

/** Recordatorios de eventos del calendario: cada minuto se envían los que ya vencieron (a quien
 * creó el evento y a sus participantes), una sola vez cada uno — ver calendar.service.js. */
function registerCalendarRemindersCron() {
  let running = false;
  cron.schedule('* * * * *', async () => {
    if (running) return;
    running = true;
    try {
      const sent = await calendarService.sendDueReminders();
      if (sent) logger.info(`[cron] Recordatorios de calendario enviados: ${sent}.`);
    } catch (error) {
      logger.error('[cron] Error en recordatorios de calendario', { error: error.message });
    } finally {
      running = false;
    }
  });
}

module.exports = registerCalendarRemindersCron;
