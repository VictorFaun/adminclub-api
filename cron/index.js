const registerCleanupCron = require('./cleanup.cron');
const registerChargeGenerationCron = require('./chargeGeneration.cron');
const registerExpenseGenerationCron = require('./expenseGeneration.cron');
const registerTrainingSessionGenerationCron = require('./trainingSessionGeneration.cron');
const registerBirthdayEmailsCron = require('./birthdayEmails.cron');
const registerDebtRemindersCron = require('./debtReminders.cron');

function registerAllCronJobs() {
  registerCleanupCron();
  registerChargeGenerationCron();
  registerExpenseGenerationCron();
  registerTrainingSessionGenerationCron();
  registerBirthdayEmailsCron();
  registerDebtRemindersCron();
}

module.exports = registerAllCronJobs;
