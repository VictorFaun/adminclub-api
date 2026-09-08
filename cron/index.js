const registerCleanupCron = require('./cleanup.cron');
const registerChargeGenerationCron = require('./chargeGeneration.cron');
const registerExpenseGenerationCron = require('./expenseGeneration.cron');
const registerTrainingSessionGenerationCron = require('./trainingSessionGeneration.cron');

function registerAllCronJobs() {
  registerCleanupCron();
  registerChargeGenerationCron();
  registerExpenseGenerationCron();
  registerTrainingSessionGenerationCron();
}

module.exports = registerAllCronJobs;
