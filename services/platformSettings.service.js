const platformSettingsRepository = require('../repositories/platformSettings.repository');
const auditRepository = require('../repositories/audit.repository');
const AppError = require('../helpers/AppError');
const { diffValue, buildDiff } = require('../helpers/auditDiff');

class PlatformSettingsService {
  async get() {
    const row = await platformSettingsRepository.get();
    if (!row) throw AppError.notFound('Configuración de plataforma no encontrada.');
    return { timezone: row.timezone, updatedAt: row.updated_at };
  }

  async updateTimezone(timezone, actorId) {
    const previous = await platformSettingsRepository.get();
    if (!previous) throw AppError.notFound('Configuración de plataforma no encontrada.');

    await platformSettingsRepository.updateTimezone(timezone);

    const changes = buildDiff({ timezone: diffValue(previous.timezone, timezone) });
    if (changes) {
      await auditRepository.logAction({
        userId: actorId,
        clubId: null,
        action: 'PLATFORM_SETTINGS_UPDATED',
        entityType: 'platform_settings',
        entityId: 1,
        changes,
      });
    }

    return this.get();
  }
}

module.exports = new PlatformSettingsService();
