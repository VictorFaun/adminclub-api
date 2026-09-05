const expensesRepository = require('../repositories/expenses.repository');
const expensesService = require('./expenses.service');
const expenseInstancesRepository = require('../repositories/expenseInstances.repository');
const expenseInstancesService = require('./expenseInstances.service');
const expensePaymentsRepository = require('../repositories/expensePayments.repository');
const auditRepository = require('../repositories/audit.repository');
const AppError = require('../helpers/AppError');
const { withTransaction } = require('../config/database');

const MATRIX_MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
// Mismos valores que payments.service.js — la ventana de períodos mostrada de un gasto
// recurrente usa el mismo criterio de tamaño/centrado que la matriz de Cobros.
const DEFAULT_WINDOW_SIZE = 12;
const MIN_WINDOW_SIZE = 1;
const MAX_WINDOW_SIZE = 18;

const pad = (n) => String(n).padStart(2, '0');
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function clampDay(year, month, day) {
  return Math.min(day, daysInMonth(year, month));
}

/**
 * Vista de "períodos" de UN gasto — mirror simplificado de payments.service.js#getChargeMatrix,
 * sin la dimensión de miembro: acá hay una sola fila de períodos por gasto, no una matriz.
 */
class ExpensePaymentsService {
  toDto(payment) {
    return {
      id: payment.id,
      uuid: payment.uuid,
      clubId: payment.club_id,
      expenseInstanceId: payment.expense_instance_id,
      amount: Number(payment.amount),
      paidAt: payment.paid_at,
      note: payment.note,
      registeredBy: payment.registered_by,
      registeredByUsername: payment.registered_by_username ?? null,
      createdAt: payment.created_at,
    };
  }

  _resolveDisplayStatus(row) {
    if (row.status === 'pending' && new Date(row.due_date) < new Date()) return 'overdue';
    return row.status;
  }

  _windowBack(windowSize) {
    return Math.floor((windowSize - 1) / 2);
  }

  _firstApplicableMonthIndex(expense) {
    const startDate = new Date(expense.start_date);
    const startYear = startDate.getUTCFullYear();
    const startMonth = startDate.getUTCMonth() + 1;
    const startIndex = startYear * 12 + startMonth;
    const dueDateInStartMonth = new Date(Date.UTC(startYear, startMonth - 1, clampDay(startYear, startMonth, expense.due_day)));
    return dueDateInStartMonth >= startDate ? startIndex : startIndex + 1;
  }

  _lastApplicableMonthIndex(expense) {
    if (!expense.end_date) return null;
    const endDate = new Date(expense.end_date);
    const endYear = endDate.getUTCFullYear();
    const endMonth = endDate.getUTCMonth() + 1;
    const endIndex = endYear * 12 + endMonth;
    const dueDateInEndMonth = new Date(Date.UTC(endYear, endMonth - 1, clampDay(endYear, endMonth, expense.due_day)));
    return dueDateInEndMonth <= endDate ? endIndex : endIndex - 1;
  }

  _firstApplicableYear(expense) {
    const startDate = new Date(expense.start_date);
    const startYear = startDate.getUTCFullYear();
    const dueDateInStartYear = new Date(Date.UTC(startYear, expense.due_month - 1, clampDay(startYear, expense.due_month, expense.due_day)));
    return dueDateInStartYear >= startDate ? startYear : startYear + 1;
  }

  _lastApplicableYear(expense) {
    if (!expense.end_date) return null;
    const endDate = new Date(expense.end_date);
    const endYear = endDate.getUTCFullYear();
    const dueDateInEndYear = new Date(Date.UTC(endYear, expense.due_month - 1, clampDay(endYear, expense.due_month, expense.due_day)));
    return dueDateInEndYear <= endDate ? endYear : endYear - 1;
  }

  /** Idéntico a payments.service.js#_matrixPeriods, adaptado a `expense`. */
  _periodWindow(expense, anchor, windowSize) {
    if (expense.recurrence === 'once') return { periods: [{ key: 'unico', label: 'Único' }], canGoBack: false, canGoForward: false };

    const size = Math.max(MIN_WINDOW_SIZE, Math.min(MAX_WINDOW_SIZE, windowSize || DEFAULT_WINDOW_SIZE));
    const back = this._windowBack(size);

    if (expense.recurrence === 'monthly') {
      const firstIndex = this._firstApplicableMonthIndex(expense);
      const lastIndex = this._lastApplicableMonthIndex(expense);

      const match = anchor ? /^(\d{4})-(\d{2})$/.exec(anchor) : null;
      let windowStart;
      if (match) {
        windowStart = Math.max(Number(match[1]) * 12 + Number(match[2]), firstIndex);
      } else {
        const now = new Date();
        const todayIndex = now.getUTCFullYear() * 12 + (now.getUTCMonth() + 1);
        windowStart = Math.max(todayIndex - back, firstIndex);
      }

      let windowEnd = windowStart + size - 1;
      if (lastIndex !== null) windowEnd = Math.min(windowEnd, lastIndex);
      if (windowEnd < windowStart) windowEnd = windowStart;

      const periods = [];
      for (let idx = windowStart; idx <= windowEnd; idx += 1) {
        const year = Math.floor((idx - 1) / 12);
        const month = idx - year * 12;
        periods.push({ key: `${year}-${pad(month)}`, label: `${MATRIX_MONTH_LABELS[month - 1]} ${year}` });
      }
      return { periods, canGoBack: windowStart > firstIndex, canGoForward: lastIndex === null || windowEnd < lastIndex };
    }

    // yearly
    const firstYear = this._firstApplicableYear(expense);
    const lastYear = this._lastApplicableYear(expense);
    let windowStart;
    if (anchor && /^\d{4}$/.test(anchor)) {
      windowStart = Math.max(Number(anchor), firstYear);
    } else {
      windowStart = Math.max(new Date().getUTCFullYear() - back, firstYear);
    }

    let windowEnd = windowStart + size - 1;
    if (lastYear !== null) windowEnd = Math.min(windowEnd, lastYear);
    if (windowEnd < windowStart) windowEnd = windowStart;

    const periods = [];
    for (let y = windowStart; y <= windowEnd; y += 1) periods.push({ key: String(y), label: String(y) });
    return { periods, canGoBack: windowStart > firstYear, canGoForward: lastYear === null || windowEnd < lastYear };
  }

  _dueDateForPeriod(expense, periodKey) {
    if (expense.recurrence === 'once') return new Date(expense.start_date);
    if (expense.recurrence === 'monthly') {
      const [year, month] = periodKey.split('-').map(Number);
      return new Date(Date.UTC(year, month - 1, clampDay(year, month, expense.due_day)));
    }
    const year = Number(periodKey);
    return new Date(Date.UTC(year, expense.due_month - 1, clampDay(year, expense.due_month, expense.due_day)));
  }

  _cellToDto(instance, paidAmount) {
    return {
      instanceId: instance.id,
      periodLabel: instance.period_label,
      amount: Number(instance.amount),
      paidAmount: instance.status === 'paid' ? Number(instance.amount) : paidAmount,
      dueDate: instance.due_date,
      status: instance.status,
      displayStatus: this._resolveDisplayStatus(instance),
    };
  }

  /** Celda "virtual" para un período aplicable sin `expense_instance` generada todavía — mismo
   * criterio que payments.service.js#_virtualCellToDto. */
  _virtualCellToDto(expense, periodKey) {
    const dueDate = this._dueDateForPeriod(expense, periodKey);
    const isOverdue = dueDate < new Date();
    return {
      instanceId: null,
      periodLabel: periodKey,
      amount: Number(expense.amount),
      paidAmount: 0,
      dueDate: dueDate.toISOString(),
      status: 'pending',
      displayStatus: isOverdue ? 'overdue' : 'pending',
    };
  }

  async _findExpenseInClub(clubId, expenseId) {
    const expense = await expensesRepository.findActiveById(expenseId);
    if (!expense || expense.club_id !== clubId) throw AppError.notFound('Gasto no encontrado.');
    return expense;
  }

  async _findInstanceInClub(clubId, instanceId) {
    const instance = await expenseInstancesRepository.findActiveById(instanceId);
    if (!instance) throw AppError.notFound('Período no encontrado.');
    const expense = await expensesRepository.findActiveById(instance.expense_id);
    if (!expense || expense.club_id !== clubId) throw AppError.notFound('Período no encontrado.');
    return instance;
  }

  /** Ventana de períodos de un gasto, con su estado — mirror simplificado (sin miembros) de
   * payments.service.js#getChargeMatrix. */
  async getPeriods(clubId, expenseId, { anchor, columns } = {}) {
    const expense = await this._findExpenseInClub(clubId, expenseId);
    const { periods, canGoBack, canGoForward } = this._periodWindow(expense, anchor || null, columns || null);

    const periodKeys = periods.map((p) => p.key);
    const instances = periodKeys.length ? await Promise.all(periodKeys.map((key) => expenseInstancesRepository.findByExpenseAndPeriod(expenseId, key))) : [];
    const byPeriod = new Map();
    instances.forEach((row, i) => {
      if (row) byPeriod.set(periodKeys[i], row);
    });

    const cells = await Promise.all(
      periods.map(async (period) => {
        const instance = byPeriod.get(period.key);
        if (!instance) return { ...period, ...this._virtualCellToDto(expense, period.key) };
        const paid = await expenseInstancesRepository.sumPayments(instance.id);
        return { ...period, ...this._cellToDto(instance, paid) };
      })
    );

    return { expense: expensesService.toDto(expense), periods: cells, canGoBack, canGoForward };
  }

  /** Crea (si no existe) la instancia de un período puntual — disparado al interactuar con una
   * celda vacía de la vista de períodos (mismo rol que payments.service.js#ensureInstance). */
  async ensureInstance(clubId, expenseId, periodKey) {
    await this._findExpenseInClub(clubId, expenseId);
    const instance = await expenseInstancesService.ensureInstance(expenseId, periodKey);
    if (!instance) throw AppError.badRequest('Período inválido para este gasto.');
    const paid = await expenseInstancesRepository.sumPayments(instance.id);
    return this._cellToDto(instance, paid);
  }

  async listForInstance(clubId, instanceId) {
    const instance = await this._findInstanceInClub(clubId, instanceId);
    const rows = await expensePaymentsRepository.findByInstance(instance.id);
    return rows.map((r) => this.toDto(r));
  }

  async create(clubId, data, actorId) {
    const instance = await expenseInstancesRepository.findActiveById(data.expenseInstanceId);
    if (!instance) throw AppError.badRequest('El período indicado no existe.');
    const expense = await expensesRepository.findActiveById(instance.expense_id);
    if (!expense || expense.club_id !== clubId) throw AppError.notFound('Gasto no encontrado.');

    if (data.amount <= 0) throw AppError.badRequest('El monto debe ser mayor a cero.');
    const alreadyPaid = await expenseInstancesRepository.sumPayments(instance.id);
    const remaining = Number(instance.amount) - alreadyPaid;
    if (data.amount > remaining + 0.005) {
      throw AppError.badRequest(`El monto excede el saldo pendiente de "${instance.period_label}" ($${remaining.toFixed(2)}).`);
    }

    const paymentId = await withTransaction(async (conn) => {
      const id = await expensePaymentsRepository.createPayment(
        {
          clubId,
          expenseInstanceId: instance.id,
          amount: data.amount,
          paidAt: data.paidAt || new Date(),
          note: data.note || null,
          registeredBy: actorId,
        },
        conn
      );
      await expenseInstancesRepository.recomputeStatus(instance.id, conn);
      return id;
    });

    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'EXPENSE_PAYMENT_CREATED',
      entityType: 'expense_payment',
      entityId: paymentId,
      changes: { expenseId: expense.id, amount: data.amount, periodLabel: instance.period_label },
    });

    const payment = await expensePaymentsRepository.findActiveById(paymentId);
    return this.toDto(payment);
  }

  async update(clubId, paymentId, data, actorId) {
    const payment = await expensePaymentsRepository.findActiveById(paymentId);
    if (!payment || payment.club_id !== clubId) throw AppError.notFound('Pago no encontrado.');
    const instance = await expenseInstancesRepository.findActiveById(payment.expense_instance_id);

    let newAmount = Number(payment.amount);
    if (data.amount !== undefined) {
      newAmount = data.amount;
      if (newAmount <= 0) throw AppError.badRequest('El monto debe ser mayor a cero.');
      const paidByOthers = (await expenseInstancesRepository.sumPayments(instance.id)) - Number(payment.amount);
      const remaining = Number(instance.amount) - paidByOthers;
      if (newAmount > remaining + 0.005) {
        throw AppError.badRequest(`El monto excede el saldo pendiente de "${instance.period_label}" ($${remaining.toFixed(2)}).`);
      }
    }

    await withTransaction(async (conn) => {
      const updates = {};
      if (data.amount !== undefined) updates.amount = newAmount;
      if (data.paidAt !== undefined) updates.paid_at = data.paidAt;
      if (data.note !== undefined) updates.note = data.note || null;
      if (Object.keys(updates).length) await expensePaymentsRepository.updateById(paymentId, updates, conn);
      if (data.amount !== undefined) await expenseInstancesRepository.recomputeStatus(instance.id, conn);
    });

    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'EXPENSE_PAYMENT_UPDATED',
      entityType: 'expense_payment',
      entityId: paymentId,
      changes: { amount: data.amount !== undefined ? { from: Number(payment.amount), to: newAmount } : undefined },
    });

    const updated = await expensePaymentsRepository.findActiveById(paymentId);
    return this.toDto(updated);
  }

  async remove(clubId, paymentId, actorId) {
    const payment = await expensePaymentsRepository.findActiveById(paymentId);
    if (!payment || payment.club_id !== clubId) throw AppError.notFound('Pago no encontrado.');

    await withTransaction(async (conn) => {
      await expensePaymentsRepository.deletePayment(paymentId, conn);
      await expenseInstancesRepository.recomputeStatus(payment.expense_instance_id, conn);
    });

    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'EXPENSE_PAYMENT_DELETED',
      entityType: 'expense_payment',
      entityId: paymentId,
      changes: { amount: Number(payment.amount) },
    });
  }
}

module.exports = new ExpensePaymentsService();
