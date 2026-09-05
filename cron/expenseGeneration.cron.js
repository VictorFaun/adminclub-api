const cron = require('node-cron');
const expenseInstancesService = require('../services/expenseInstances.service');
const logger = require('../helpers/logger');

/**
 * Genera (idempotente) las expense_instances del período actual + siguiente de todos los gastos
 * activos de todos los clubes — mismo criterio que chargeGeneration.cron.js. Se ejecuta a las
 * 02:05 (5 minutos después de la de cobros, para no chocar con ella).
 */
function registerExpenseGenerationCron() {
  cron.schedule('5 2 * * *', async () => {
    try {
      const total = await expenseInstancesService.generateDueInstances();
      logger.info(`[cron] Generación de gastos ejecutada: ${total} instancias nuevas.`);
    } catch (error) {
      logger.error('[cron] Error en generación periódica de gastos', { error: error.message });
    }
  });
}

module.exports = registerExpenseGenerationCron;
