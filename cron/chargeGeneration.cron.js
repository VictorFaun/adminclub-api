const cron = require('node-cron');
const chargeInstancesService = require('../services/chargeInstances.service');
const logger = require('../helpers/logger');

/**
 * Genera (idempotente) las charge_instances del período actual + siguiente de todos los cobros
 * activos de todos los clubes — así nunca falta un período por vencer y un miembro agregado a un
 * grupo apuntado empieza a generársele sin ningún paso manual. Se ejecuta todos los días a las
 * 02:00 (antes que la limpieza de las 03:00, sin relación entre ambas).
 */
function registerChargeGenerationCron() {
  cron.schedule('0 2 * * *', async () => {
    try {
      const total = await chargeInstancesService.generateDueInstances();
      logger.info(`[cron] Generación de cobros ejecutada: ${total} instancias nuevas.`);
    } catch (error) {
      logger.error('[cron] Error en generación periódica de cobros', { error: error.message });
    }
  });
}

module.exports = registerChargeGenerationCron;
