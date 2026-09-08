const cron = require('node-cron');
const trainingAttendanceService = require('../services/trainingAttendance.service');
const logger = require('../helpers/logger');

/**
 * Genera (idempotente) las sesiones de asistencia de los próximos días de todos los
 * entrenamientos activos de todos los clubes — mismo patrón que chargeGeneration.cron.js, con
 * una ventana más ancha (ver trainingAttendance.service.js#GENERATION_WINDOW_DAYS) porque la
 * granularidad es semanal, no mensual. Se ejecuta todos los días a las 02:00.
 */
function registerTrainingSessionGenerationCron() {
  cron.schedule('0 2 * * *', async () => {
    try {
      const total = await trainingAttendanceService.generateDueTrainings();
      logger.info(`[cron] Generación de sesiones de entrenamiento ejecutada: ${total} sesiones nuevas.`);
    } catch (error) {
      logger.error('[cron] Error en generación periódica de sesiones de entrenamiento', { error: error.message });
    }
  });
}

module.exports = registerTrainingSessionGenerationCron;
