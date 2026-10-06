const logger = require('./logger');

/**
 * Genera ya los períodos vigentes (actual + siguiente) de los cobros y las sesiones de
 * entrenamiento del club — tras crear un miembro, cambiar sus grupos o su historial de
 * pertenencia — en vez de esperar al cron nocturno (sin esto su ficha de pagos quedaba vacía
 * hasta el día siguiente). Idempotente (INSERT IGNORE) y respeta el historial de pertenencia.
 * Nunca hace fallar la operación que lo dispara: un error solo se registra.
 */
async function regeneratePeriods(clubId) {
  try {
    // eslint-disable-next-line global-require
    await require('../services/chargeInstances.service').generateDueInstances(clubId);
    // eslint-disable-next-line global-require
    await require('../services/trainingAttendance.service').generateDueTrainings(clubId);
  } catch (error) {
    logger.error(`[regeneratePeriods] club ${clubId}: ${error.message}`);
  }
}

module.exports = { regeneratePeriods };
