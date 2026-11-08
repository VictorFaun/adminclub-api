const userSettingsRepository = require('../repositories/userSettings.repository');
const chargesRepository = require('../repositories/charges.repository');
const auditRepository = require('../repositories/audit.repository');
const { diffValue, buildDiff } = require('../helpers/auditDiff');

/** Cobros fijados como acceso rápido del menú (app: user-settings.service.ts). */
const QUICK_ACCESS_CHARGE_KEY = 'treasury_quick_access_charge';

/** Preferencias de UI por usuario y por club activo — ver sql/029_user_settings.sql. Sin
 * validación de `setting_key`/`setting_value` a propósito: es un balde genérico de preferencias
 * de UI (qué cards mostrar, un acceso rápido de menú), nunca datos de negocio ni nada que otro
 * usuario pueda leer (siempre se consulta/escribe con el `userId` del actor autenticado). */
class UserSettingsService {
  async getMine(userId, clubId) {
    const settings = await userSettingsRepository.findAllForUser(userId, clubId);
    if (settings[QUICK_ACCESS_CHARGE_KEY]) {
      const cleaned = await this._cleanQuickAccess(clubId, settings[QUICK_ACCESS_CHARGE_KEY]);
      if (cleaned !== settings[QUICK_ACCESS_CHARGE_KEY]) {
        await userSettingsRepository.upsertMany(userId, clubId, { [QUICK_ACCESS_CHARGE_KEY]: cleaned });
        settings[QUICK_ACCESS_CHARGE_KEY] = cleaned;
      }
    }
    return settings;
  }

  /**
   * Los accesos rápidos guardan el nombre del cobro al fijarlo: acá se dejan al día con el cobro
   * real — sin repetidos, con el nombre actual y sin los que se eliminaron o archivaron (si no,
   * el menú mostraba atajos duplicados o a cobros que ya no existen). Devuelve el valor a guardar.
   */
  async _cleanQuickAccess(clubId, raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return '';
    }
    const list = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    const ids = [...new Set(list.map((q) => Number(q?.chargeId)).filter((id) => Number.isInteger(id) && id > 0))];
    const charges = await chargesRepository.findNamesByIds(clubId, ids);
    const nameById = new Map(charges.map((c) => [c.id, c.name]));
    const cleaned = ids.filter((id) => nameById.has(id)).map((id) => ({ chargeId: id, chargeName: nameById.get(id) }));
    return cleaned.length ? JSON.stringify(cleaned) : '';
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
