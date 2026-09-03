const registerCleanupCron = require('./cleanup.cron');

function registerAllCronJobs() {
  registerCleanupCron();
}

module.exports = registerAllCronJobs;
