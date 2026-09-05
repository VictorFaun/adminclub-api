const chargesRepository = require('../repositories/charges.repository');
const chargeInstancesRepository = require('../repositories/chargeInstances.repository');
const { CHARGE_RECURRENCE } = require('../config/constants');

const pad = (n) => String(n).padStart(2, '0');

function daysInMonth(year, month) {
  // Día 0 del mes siguiente = último día del mes actual.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Recorta el día de vencimiento configurado (1-31) al último día real del mes/año en cuestión
 * — un cobro con `dueDay=31` vence el 28/29 en febrero, no revienta ni se corre a marzo. */
function clampDay(year, month, day) {
  return Math.min(day, daysInMonth(year, month));
}

function toDateString(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function formatDateOnly(date) {
  const d = new Date(date);
  return toDateString(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * Genera (idempotente, `INSERT IGNORE`) las `charge_instances` de los cobros activos — un cobro
 * "once" genera una única instancia (período `'unico'`); uno recurrente genera el período
 * ACTUAL + el SIGUIENTE siempre que se corra (current+next, sin importar si ya existían — el
 * `INSERT IGNORE` sobre `UNIQUE(charge_id, member_id, period_label)` hace que reintentar sea
 * gratis), así nunca falta un período por vencer y un miembro agregado a un grupo apuntado
 * empieza a generársele desde la próxima corrida sin ningún paso manual.
 */
class ChargeInstancesService {
  /** Períodos a generar para un cobro, respetando `start_date`/`end_date` — no genera periodos
   * fuera de esa ventana (ej. un cobro que ya terminó no sigue generando meses). */
  _computePeriods(charge, referenceDate) {
    if (charge.recurrence === CHARGE_RECURRENCE.ONCE) {
      return [{ label: 'unico', dueDate: formatDateOnly(charge.start_date) }];
    }

    const startDate = new Date(charge.start_date);
    const endDate = charge.end_date ? new Date(charge.end_date) : null;
    const periods = [];

    if (charge.recurrence === CHARGE_RECURRENCE.MONTHLY) {
      let year = referenceDate.getUTCFullYear();
      let month = referenceDate.getUTCMonth() + 1;
      for (let i = 0; i < 2; i += 1) {
        const day = clampDay(year, month, charge.due_day);
        const dueDate = new Date(Date.UTC(year, month - 1, day));
        if (dueDate >= startDate && (!endDate || dueDate <= endDate)) {
          periods.push({ label: `${year}-${pad(month)}`, dueDate: toDateString(year, month, day) });
        }
        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
      }
    } else {
      // yearly
      let year = referenceDate.getUTCFullYear();
      for (let i = 0; i < 2; i += 1) {
        const day = clampDay(year, charge.due_month, charge.due_day);
        const dueDate = new Date(Date.UTC(year, charge.due_month - 1, day));
        if (dueDate >= startDate && (!endDate || dueDate <= endDate)) {
          periods.push({ label: `${year}`, dueDate: toDateString(year, charge.due_month, day) });
        }
        year += 1;
      }
    }

    return periods;
  }

  async generateForCharge(chargeId, referenceDate = new Date()) {
    const charge = await chargesRepository.findActiveById(chargeId);
    // Un cobro archivado no debe seguir generando nuevos períodos en silencio: quedaría oculto de
    // "Pagos" pero acumulando pendientes que nadie ve — ver charges.service.js#archive/restore.
    if (!charge || charge.status !== 'active' || charge.archived_at) return 0;

    const memberIds = await chargesRepository.expandTargetMemberIds(chargeId);
    if (!memberIds.length) return 0;

    const periods = this._computePeriods(charge, referenceDate);
    if (!periods.length) return 0;

    // Monto por miembro (default < grupo < etiqueta < miembro específico) — se resuelve UNA vez
    // para todos los miembros del cobro, no por fila, para no repetir las mismas queries por
    // cada período generado (típicamente 2, current+next).
    const amounts = await chargesRepository.resolveAmounts(chargeId, memberIds, charge.amount);

    const rows = [];
    for (const period of periods) {
      for (const memberId of memberIds) {
        rows.push({ chargeId, memberId, periodLabel: period.label, amount: amounts.get(memberId), dueDate: period.dueDate });
      }
    }
    return chargeInstancesRepository.bulkInsertIgnore(rows);
  }

  /** Crea (idempotente, mismo `INSERT IGNORE` que la generación automática) la instancia de UN
   * período puntual para UN miembro si todavía no existe — usado cuando el admin interactúa con
   * una celda vacía de la matriz "Pagos" (pagar o eximir un período que el cron aún no generó,
   * o que nunca iba a generar por caer fuera de la ventana actual de generación "current+next").
   * Reutiliza el mismo cálculo de fecha de vencimiento que `_computePeriods`, pero para el
   * período EXACTO pedido en vez de "actual+siguiente". */
  async ensureInstance(chargeId, memberId, periodKey) {
    const charge = await chargesRepository.findActiveById(chargeId);
    if (!charge) return null;

    let dueDate;
    if (charge.recurrence === CHARGE_RECURRENCE.ONCE) {
      if (periodKey !== 'unico') return null;
      dueDate = formatDateOnly(charge.start_date);
    } else if (charge.recurrence === CHARGE_RECURRENCE.MONTHLY) {
      const match = /^(\d{4})-(\d{2})$/.exec(periodKey);
      if (!match) return null;
      const year = Number(match[1]);
      const month = Number(match[2]);
      dueDate = toDateString(year, month, clampDay(year, month, charge.due_day));
    } else {
      const year = Number(periodKey);
      if (!year || !/^\d{4}$/.test(periodKey)) return null;
      dueDate = toDateString(year, charge.due_month, clampDay(year, charge.due_month, charge.due_day));
    }

    const amounts = await chargesRepository.resolveAmounts(chargeId, [memberId], charge.amount);
    await chargeInstancesRepository.bulkInsertIgnore([{ chargeId, memberId, periodLabel: periodKey, amount: amounts.get(memberId), dueDate }]);
    return chargeInstancesRepository.findByChargeMemberPeriod(chargeId, memberId, periodKey);
  }

  /** `clubId` opcional: sin él, recorre todos los clubes (usado por el cron diario). */
  async generateDueInstances(clubId = null) {
    const charges = clubId
      ? await chargesRepository.findActiveByClubForGeneration(clubId)
      : await chargesRepository.findAllActiveForGeneration();

    let total = 0;
    for (const charge of charges) {
      // eslint-disable-next-line no-await-in-loop
      total += await this.generateForCharge(charge.id);
    }
    return total;
  }
}

module.exports = new ChargeInstancesService();
