const cron = require('node-cron');
const debtRemindersService = require('../services/debtReminders.service');
const logger = require('../helpers/logger');

/** Recordatorios de deuda automáticos: cada día a las 09:00 revisa qué clubes los tienen activos
 * para el día de hoy (Tesorería → Configuración) y que todavía no los enviaron este mes. */
function registerDebtRemindersCron() {
  cron.schedule('0 9 * * *', async () => {
    try {
      const clubs = await debtRemindersService.runScheduled();
      if (clubs) logger.info(`[cron] Recordatorios de deuda enviados en ${clubs} club(es).`);
    } catch (error) {
      logger.error('[cron] Error en recordatorios de deuda', { error: error.message });
    }
  });
}

module.exports = registerDebtRemindersCron;
