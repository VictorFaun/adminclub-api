/**
 * Cobertura de un período por el historial de pertenencia de un miembro (`member_memberships`).
 * Un período APLICA si el miembro estuvo activo en algún momento dentro de él:
 *  - mensual: el mes completo (se retira el 15 de enero → enero aplica; vuelve el 10 de
 *    febrero → febrero aplica);
 *  - anual: el año completo;
 *  - único / sesión de entrenamiento: el día exacto (vencimiento o fecha de la sesión).
 * Lo que no aplica se muestra como "no aplica — Retirado".
 */

const RETIRED_REASON = 'Retirado';
/** Períodos anteriores a su fecha de ingreso al club. */
const NOT_JOINED_REASON = 'Antes de su ingreso';
/** Motivos que pone el sistema según el historial (y que puede volver a quitar). */
const COVERAGE_REASONS = [RETIRED_REASON, NOT_JOINED_REASON];
/** Motivo que usaba la versión anterior al congelar cobros al pasar a inactivo (050 lo migra a
 * RETIRED_REASON; se sigue reconociendo por si queda alguno). */
const LEGACY_INACTIVE_REASON = 'Miembro inactivo';

const pad = (n) => String(n).padStart(2, '0');
const toDateOnly = (value) => {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const lastDayOfMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Rango [desde, hasta] (YYYY-MM-DD) que abarca un período de cobro. */
function periodRange(recurrence, periodKey, dueDate) {
  if (recurrence === 'monthly' && /^\d{4}-\d{2}$/.test(periodKey)) {
    const [y, m] = periodKey.split('-').map(Number);
    return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDayOfMonth(y, m))}` };
  }
  if (recurrence === 'yearly' && /^\d{4}$/.test(periodKey)) return { from: `${periodKey}-01-01`, to: `${periodKey}-12-31` };
  const day = toDateOnly(dueDate);
  return { from: day, to: day };
}

/** `intervals`: [{ startedOn, endedOn }] (YYYY-MM-DD o null). Sin historial = siempre activo. */
function covers(intervals, range) {
  if (!intervals || !intervals.length) return true;
  return intervals.some((i) => (!i.startedOn || i.startedOn <= range.to) && (!i.endedOn || i.endedOn >= range.from));
}

function coversPeriod(intervals, recurrence, periodKey, dueDate) {
  return covers(intervals, periodRange(recurrence, periodKey, dueDate));
}

function coversDate(intervals, date) {
  const day = toDateOnly(date);
  return covers(intervals, { from: day, to: day });
}

/** Motivo de un período que NO aplica: antes del ingreso, o mientras estaba retirado. `null` si aplica. */
function uncoveredReason(intervals, range) {
  if (covers(intervals, range)) return null;
  const first = intervals[0];
  return first?.startedOn && range.to < first.startedOn ? NOT_JOINED_REASON : RETIRED_REASON;
}

function periodReason(intervals, recurrence, periodKey, dueDate) {
  return uncoveredReason(intervals, periodRange(recurrence, periodKey, dueDate));
}

function dateReason(intervals, date) {
  const day = toDateOnly(date);
  return uncoveredReason(intervals, { from: day, to: day });
}

// ---------------------------------------------------------------- política del mes de ingreso/retiro
/**
 * Cómo se cobra (solo cobros MENSUALES) el mes en que alguien entra o se va, configurable por club
 * (Tesorería → Configuración):
 *  - ingreso: 'full' = el mes de ingreso se cobra completo (por defecto); 'next' = se cobra desde
 *    el mes siguiente (salvo que entre el día 1); 'prorate' = se cobra la parte proporcional.
 *  - retiro: 'full' = el mes del retiro se cobra completo (por defecto); 'none' = no se cobra
 *    (salvo que se vaya el último día); 'prorate' = la parte proporcional.
 */
const DEFAULT_MONTH_POLICY = { join: 'full', leave: 'full' };
const MONTH_POLICY_OPTIONS = { join: ['full', 'next', 'prorate'], leave: ['full', 'none', 'prorate'] };

function normalizeMonthPolicy(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  return {
    join: MONTH_POLICY_OPTIONS.join.includes(p.join) ? p.join : DEFAULT_MONTH_POLICY.join,
    leave: MONTH_POLICY_OPTIONS.leave.includes(p.leave) ? p.leave : DEFAULT_MONTH_POLICY.leave,
  };
}

const addDays = (day, n) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return toDateOnly(d);
};
const isFirstOfMonth = (day) => day.endsWith('-01');
const isLastOfMonth = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return d === lastDayOfMonth(y, m);
};

/** Intervalos ajustados a la política (para decidir qué meses de un cobro MENSUAL aplican). */
function intervalsForMonthly(intervals, policy) {
  if (!intervals || !intervals.length || !policy) return intervals;
  const adjusted = intervals
    .map((i) => {
      let { startedOn, endedOn } = i;
      if (policy.join === 'next' && startedOn && !isFirstOfMonth(startedOn)) {
        const [y, m] = startedOn.split('-').map(Number);
        startedOn = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
      }
      if (policy.leave === 'none' && endedOn && !isLastOfMonth(endedOn)) endedOn = addDays(`${endedOn.slice(0, 7)}-01`, -1);
      return { ...i, startedOn, endedOn };
    })
    .filter((i) => !i.startedOn || !i.endedOn || i.startedOn <= i.endedOn);
  // Si ningún intervalo sobrevive (entró y salió el mismo mes sin cobrarse), no aplica nada.
  return adjusted.length ? adjusted : [{ startedOn: '9999-12-31', endedOn: '9999-12-31' }];
}

/** Cobertura de un período según el tipo de cobro, aplicando la política en los mensuales. */
function coversChargePeriod(intervals, recurrence, periodKey, dueDate, policy) {
  return coversPeriod(recurrence === 'monthly' ? intervalsForMonthly(intervals, policy) : intervals, recurrence, periodKey, dueDate);
}

function chargePeriodReason(intervals, recurrence, periodKey, dueDate, policy) {
  return periodReason(recurrence === 'monthly' ? intervalsForMonthly(intervals, policy) : intervals, recurrence, periodKey, dueDate);
}

/**
 * Monto de un período mensual con la política "proporcional": se cobra la fracción de días del
 * mes en que estuvo en el club (redondeado a la decena). Cualquier otro caso: el monto completo.
 */
function proratedAmount(amount, intervals, recurrence, periodKey, policy) {
  const value = Number(amount);
  if (recurrence !== 'monthly' || !policy || (policy.join !== 'prorate' && policy.leave !== 'prorate')) return value;
  if (!intervals || !intervals.length || !/^\d{4}-\d{2}$/.test(periodKey)) return value;
  const [y, m] = periodKey.split('-').map(Number);
  const total = lastDayOfMonth(y, m);
  const from = `${periodKey}-01`;
  const to = `${periodKey}-${pad(total)}`;
  let days = 0;
  for (const i of intervals) {
    // Solo se prorratea el lado que la política indica; el otro cuenta como mes completo.
    const start = i.startedOn && i.startedOn > from && policy.join === 'prorate' ? i.startedOn : from;
    const end = i.endedOn && i.endedOn < to && policy.leave === 'prorate' ? i.endedOn : to;
    if ((i.startedOn && i.startedOn > to) || (i.endedOn && i.endedOn < from) || start > end) continue;
    days += Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
  }
  if (!days || days >= total) return value;
  return Math.round((value * Math.min(days, total)) / total / 10) * 10;
}

module.exports = {
  DEFAULT_MONTH_POLICY,
  MONTH_POLICY_OPTIONS,
  normalizeMonthPolicy,
  intervalsForMonthly,
  coversChargePeriod,
  chargePeriodReason,
  proratedAmount,
  RETIRED_REASON,
  NOT_JOINED_REASON,
  COVERAGE_REASONS,
  LEGACY_INACTIVE_REASON,
  periodRange,
  covers,
  coversPeriod,
  coversDate,
  periodReason,
  dateReason,
  toDateOnly,
};
