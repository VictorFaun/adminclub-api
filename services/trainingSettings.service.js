const trainingStatusColorsRepository = require('../repositories/trainingStatusColors.repository');
const auditRepository = require('../repositories/audit.repository');
const AppError = require('../helpers/AppError');

const HEX_COLOR = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

/** Los 5 "estados visuales" configurables — mirror de treasurySettings.service.js. */
const STATUS_CODES = ['pending', 'attended', 'absent', 'not_applicable', 'frozen'];

/** `pending: null` a propósito — "sin color" para una sesión aún no marcada, mismo criterio que
 * Tesorería. El resto: verde para asistió, rojo para no asistió, gris para "no aplica", celeste
 * para congelado (mismos 2 últimos colores literales que Tesorería usa para exempt/not_applicable). */
const DEFAULT_COLORS = {
  pending: null,
  attended: '#16a34a',
  absent: '#dc2626',
  not_applicable: '#94a3b8',
  frozen: '#38bdf8',
};

class TrainingSettingsService {
  async getStatusColors(clubId) {
    const rows = await trainingStatusColorsRepository.findByClub(clubId);
    const byCode = new Map(rows.map((r) => [r.status_code, r.color]));
    const colors = {};
    for (const code of STATUS_CODES) {
      colors[code] = byCode.has(code) ? byCode.get(code) : DEFAULT_COLORS[code];
    }
    return colors;
  }

  async updateStatusColors(clubId, colors, actorId) {
    if (!colors || typeof colors !== 'object') throw AppError.badRequest('Debes indicar los colores a actualizar.');

    const invalidCodes = Object.keys(colors).filter((code) => !STATUS_CODES.includes(code));
    if (invalidCodes.length) throw AppError.badRequest(`Estados inválidos: ${invalidCodes.join(', ')}.`);

    const entries = [];
    for (const code of STATUS_CODES) {
      if (colors[code] === undefined) continue;
      const value = colors[code];
      if (value !== null && !HEX_COLOR.test(value)) throw AppError.badRequest(`Color inválido para el estado "${code}".`);
      entries.push({ statusCode: code, color: value });
    }

    if (entries.length) await trainingStatusColorsRepository.upsertMany(clubId, entries);

    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'TRAINING_STATUS_COLORS_UPDATED',
      entityType: 'club',
      entityId: clubId,
      changes: colors,
    });

    return this.getStatusColors(clubId);
  }
}

module.exports = new TrainingSettingsService();
