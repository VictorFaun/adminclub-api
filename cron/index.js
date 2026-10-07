const registerCleanupCron = require('./cleanup.cron');
const registerChargeGenerationCron = require('./chargeGeneration.cron');
const registerExpenseGenerationCron = require('./expenseGeneration.cron');
const registerTrainingSessionGenerationCron = require('./trainingSessionGeneration.cron');
const registerBirthdayEmailsCron = require('./birthdayEmails.cron');
const registerDebtRemindersCron = require('./debtReminders.cron');
const registerCalendarRemindersCron = require('./calendarReminders.cron');

function registerAllCronJobs() {
  registerCleanupCron();
  registerChargeGenerationCron();
  registerExpenseGenerationCron();
  registerTrainingSessionGenerationCron();
  registerBirthdayEmailsCron();
  registerDebtRemindersCron();
  registerCalendarRemindersCron();
}

module.exports = registerAllCronJobs;
