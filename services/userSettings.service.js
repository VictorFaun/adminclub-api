const userSettingsRepository = require('../repositories/userSettings.repository');
const auditRepository = require('../repositories/audit.repository');
const { diffValue, buildDiff } = require('../helpers/auditDiff');

/** Preferencias de UI por usuario y por club activo — ver sql/029_user_settings.sql. Sin
 * validación de `setting_key`/`setting_value` a propósito: es un balde genérico de preferencias
 * de UI (qué cards mostrar, un acceso rápido de menú), nunca datos de negocio ni nada que otro
 * usuario pueda leer (siempre se consulta/escribe con el `userId` del actor autenticado). */
class UserSettingsService {
  async getMine(userId, clubId) {
    return userSettingsRepository.findAllForUser(userId, clubId);
  }

  async updateMine(userId, clubId, settings, actorId) {
    const previous = await userSettingsRepository.findAllForUser(userId, clubId);
    await userSettingsRepository.upsertMany(userId, clubId, settings);

    const changes = buildDiff(
      Object.fromEntries(Object.keys(settings).map((key) => [key, diffValue(previous[key] ?? null, String(settings[key]))]))
    );
    if (changes) {
      await auditRepository.logAction({ userId: actorId, clubId, action: 'USER_SETTINGS_UPDATED', entityType: 'user_settings', entityId: userId, changes });
    }
    return this.getMine(userId, clubId);
  }
}

module.exports = new UserSettingsService();
