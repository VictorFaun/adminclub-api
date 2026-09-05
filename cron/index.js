const registerCleanupCron = require('./cleanup.cron');
const registerChargeGenerationCron = require('./chargeGeneration.cron');
const registerExpenseGenerationCron = require('./expenseGeneration.cron');

function registerAllCronJobs() {
  registerCleanupCron();
  registerChargeGenerationCron();
  registerExpenseGenerationCron();
}

module.exports = registerAllCronJobs;
