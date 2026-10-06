const settingsRepository = require('../repositories/settings.repository');
const { normalizeMonthPolicy, DEFAULT_MONTH_POLICY } = require('../helpers/membership');

const MONTH_POLICY_KEY = 'membership_month_policy';

/**
 * Políticas del club que afectan cómo se calculan los cobros (ver helpers/membership.js). Módulo
 * aparte y sin dependencias de otros services, para poder usarlo desde la generación de períodos,
 * la matriz y las fichas sin dependencias circulares.
 */
class ClubPolicyService {
  async getMonthPolicy(clubId) {
    const settings = await settingsRepository.findAllByClub(clubId);
    try {
      return normalizeMonthPolicy(JSON.parse(settings[MONTH_POLICY_KEY] || 'null'));
    } catch {
      return { ...DEFAULT_MONTH_POLICY };
    }
  }

  async saveMonthPolicy(clubId, policy) {
    const normalized = normalizeMonthPolicy(policy);
    await settingsRepository.upsertMany(clubId, { [MONTH_POLICY_KEY]: JSON.stringify(normalized) });
    return normalized;
  }
}

module.exports = new ClubPolicyService();
