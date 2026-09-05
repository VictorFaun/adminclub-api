const chargeStatusColorsRepository = require('../repositories/chargeStatusColors.repository');
const auditRepository = require('../repositories/audit.repository');
const AppError = require('../helpers/AppError');

const HEX_COLOR = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

/** Los 6 "estados visuales" configurables: los 4 `charge_instances.status` guardados
 * (pending/partial/paid/exempt) + `overdue` y `not_applicable`, que no son un status guardado
 * sino calculados al leer según `exempt_type`/fecha (ver payments.service.js#_resolveDisplayStatus)
 * pero igual necesitan su propio color. */
const STATUS_CODES = ['pending', 'partial', 'paid', 'exempt', 'overdue', 'not_applicable'];

/** `pending: null` a propósito — "sin color" es el default pedido (una fila aún no vencida no
 * necesita destacarse). El resto son los colores literales que se pidieron: verde para pagado,
 * ámbar/warning para abonado (parcial — distinguible de "pagado completo" a simple vista, mismo
 * tono que `--ion-color-warning` en theme/variables.scss), celeste para congelado (exento), rojo
 * para atrasado, gris para "no aplica" (distinguible de "sin color" de pendiente, pero igual
 * neutro). */
const DEFAULT_COLORS = {
  pending: null,
  partial: '#8a5a00',
  paid: '#16a34a',
  exempt: '#38bdf8',
  overdue: '#dc2626',
  not_applicable: '#94a3b8',
};

class TreasurySettingsService {
  async getStatusColors(clubId) {
    const rows = await chargeStatusColorsRepository.findByClub(clubId);
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

    if (entries.length) await chargeStatusColorsRepository.upsertMany(clubId, entries);

    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'TREASURY_STATUS_COLORS_UPDATED',
      entityType: 'club',
      entityId: clubId,
      changes: colors,
    });

    return this.getStatusColors(clubId);
  }
}

module.exports = new TreasurySettingsService();
