const expensesRepository = require('../repositories/expenses.repository');
const expenseInstancesRepository = require('../repositories/expenseInstances.repository');
const { CHARGE_RECURRENCE } = require('../config/constants');

const pad = (n) => String(n).padStart(2, '0');

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Mismo criterio que chargeInstances.service.js#clampDay — un gasto con `dueDay=31` vence el
 * 28/29 en febrero, no revienta ni se corre a marzo. */
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
 * Genera (idempotente, `INSERT IGNORE`) las `expense_instances` de los gastos activos — mirror
 * simplificado de chargeInstances.service.js: un gasto no tiene "miembros", así que genera UNA
 * fila por período (no una por miembro×período), sin `resolveAmounts` ni `expandTargetMemberIds`.
 */
class ExpenseInstancesService {
  /** Idéntico a chargeInstances.service.js#_computePeriods (current+next, respetando start_date/
   * end_date) — duplicado a propósito, mismo criterio que los helpers de fecha de arriba: es
   * lógica de una pantalla, no vale la pena compartirla entre los dos módulos. */
  _computePeriods(expense, referenceDate) {
    if (expense.recurrence === CHARGE_RECURRENCE.ONCE) {
      return [{ label: 'unico', dueDate: formatDateOnly(expense.start_date) }];
    }

    const startDate = new Date(expense.start_date);
    const endDate = expense.end_date ? new Date(expense.end_date) : null;
    const periods = [];

    if (expense.recurrence === CHARGE_RECURRENCE.MONTHLY) {
      let year = referenceDate.getUTCFullYear();
      let month = referenceDate.getUTCMonth() + 1;
      for (let i = 0; i < 2; i += 1) {
        const day = clampDay(year, month, expense.due_day);
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
        const day = clampDay(year, expense.due_month, expense.due_day);
        const dueDate = new Date(Date.UTC(year, expense.due_month - 1, day));
        if (dueDate >= startDate && (!endDate || dueDate <= endDate)) {
          periods.push({ label: `${year}`, dueDate: toDateString(year, expense.due_month, day) });
        }
        year += 1;
      }
    }

    return periods;
  }

  async generateForExpense(expenseId, referenceDate = new Date()) {
    const expense = await expensesRepository.findActiveById(expenseId);
    if (!expense || expense.status !== 'active' || expense.archived_at) return 0;

    const periods = this._computePeriods(expense, referenceDate);
    if (!periods.length) return 0;

    const rows = periods.map((period) => ({ expenseId, periodLabel: period.label, amount: Number(expense.amount), dueDate: period.dueDate }));
    return expenseInstancesRepository.bulkInsertIgnore(rows);
  }

  /** Crea (idempotente) la instancia de UN período puntual si todavía no existe — usado cuando el
   * admin interactúa con una celda vacía de la vista de períodos (mismo rol que
   * chargeInstances.service.js#ensureInstance). */
  async ensureInstance(expenseId, periodKey) {
    const expense = await expensesRepository.findActiveById(expenseId);
    if (!expense) return null;

    let dueDate;
    if (expense.recurrence === CHARGE_RECURRENCE.ONCE) {
      if (periodKey !== 'unico') return null;
      dueDate = formatDateOnly(expense.start_date);
    } else if (expense.recurrence === CHARGE_RECURRENCE.MONTHLY) {
      const match = /^(\d{4})-(\d{2})$/.exec(periodKey);
      if (!match) return null;
      const year = Number(match[1]);
      const month = Number(match[2]);
      dueDate = toDateString(year, month, clampDay(year, month, expense.due_day));
    } else {
      if (!/^\d{4}$/.test(periodKey)) return null;
      const year = Number(periodKey);
      dueDate = toDateString(year, expense.due_month, clampDay(year, expense.due_month, expense.due_day));
    }

    await expenseInstancesRepository.bulkInsertIgnore([{ expenseId, periodLabel: periodKey, amount: Number(expense.amount), dueDate }]);
    return expenseInstancesRepository.findByExpenseAndPeriod(expenseId, periodKey);
  }

  /** `clubId` opcional: sin él, recorre todos los clubes (usado por el cron diario). */
  async generateDueInstances(clubId = null) {
    const expenses = clubId
      ? await expensesRepository.findActiveByClubForGeneration(clubId)
      : await expensesRepository.findAllActiveForGeneration();

    let total = 0;
    for (const expense of expenses) {
      // eslint-disable-next-line no-await-in-loop
      total += await this.generateForExpense(expense.id);
    }
    return total;
  }
}

module.exports = new ExpenseInstancesService();
