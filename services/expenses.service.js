const expensesRepository = require('../repositories/expenses.repository');
const expenseCategoriesRepository = require('../repositories/expenseCategories.repository');
const auditRepository = require('../repositories/audit.repository');
const expenseInstancesService = require('./expenseInstances.service');
const AppError = require('../helpers/AppError');
const { diffValue, buildDiff } = require('../helpers/auditDiff');
const { CHARGE_RECURRENCE } = require('../config/constants');

class ExpensesService {
  toDto(expense) {
    return {
      id: expense.id,
      uuid: expense.uuid,
      clubId: expense.club_id,
      categoryId: expense.category_id,
      categoryName: expense.category_name ?? null,
      categoryColor: expense.category_color ?? null,
      name: expense.name,
      description: expense.description,
      color: expense.color,
      amount: Number(expense.amount),
      payee: expense.payee,
      recurrence: expense.recurrence,
      startDate: expense.start_date,
      dueDay: expense.due_day,
      dueMonth: expense.due_month,
      endDate: expense.end_date,
      status: expense.status,
      // `null` = no archivado — mismo criterio que charges.service.js#toDto (archivado ≠
      // eliminado, su dinero histórico sigue contando en el dashboard).
      archivedAt: expense.archived_at,
      createdAt: expense.created_at,
    };
  }

  /** Mismo criterio que charges.service.js#_resolveSchedule. */
  _resolveSchedule({ recurrence, dueDay, dueMonth }) {
    if (recurrence === CHARGE_RECURRENCE.ONCE) return { dueDay: null, dueMonth: null };
    if (recurrence === CHARGE_RECURRENCE.MONTHLY) {
      if (!dueDay || dueDay < 1 || dueDay > 31) throw AppError.badRequest('Debes indicar un día de vencimiento (1-31) para un gasto mensual.');
      return { dueDay, dueMonth: null };
    }
    if (!dueDay || dueDay < 1 || dueDay > 31) throw AppError.badRequest('Debes indicar un día de vencimiento (1-31) para un gasto anual.');
    if (!dueMonth || dueMonth < 1 || dueMonth > 12) throw AppError.badRequest('Debes indicar un mes de vencimiento (1-12) para un gasto anual.');
    return { dueDay, dueMonth };
  }

  async _assertCategoryValid(clubId, categoryId) {
    if (!categoryId) return;
    const found = await expenseCategoriesRepository.findByIds([categoryId], clubId);
    if (!found.length) throw AppError.badRequest('La categoría indicada no pertenece a este club.');
  }

  async listForClub(clubId) {
    const rows = await expensesRepository.findByClub(clubId);
    return rows.map((r) => this.toDto(r));
  }

  async listArchivedForClub(clubId) {
    const rows = await expensesRepository.findArchivedByClub(clubId);
    return rows.map((r) => this.toDto(r));
  }

  async getById(clubId, expenseId) {
    const expense = await expensesRepository.findActiveById(expenseId);
    if (!expense || expense.club_id !== clubId) throw AppError.notFound('Gasto no encontrado.');
    return this.toDto(expense);
  }

  async create(clubId, data, actorId) {
    const schedule = this._resolveSchedule(data);
    await this._assertCategoryValid(clubId, data.categoryId);

    const expenseId = await expensesRepository.createExpense({
      clubId,
      categoryId: data.categoryId || null,
      name: data.name,
      description: data.description || null,
      color: data.color || '#6366F1',
      amount: data.amount,
      payee: data.payee || null,
      recurrence: data.recurrence,
      startDate: data.startDate,
      dueDay: schedule.dueDay,
      dueMonth: schedule.dueMonth,
      endDate: data.endDate || null,
      status: data.status || 'active',
      createdBy: actorId,
    });

    await auditRepository.logAction({ userId: actorId, clubId, action: 'EXPENSE_CREATED', entityType: 'expense', entityId: expenseId, changes: { name: data.name, amount: data.amount } });

    // Genera de inmediato el/los primeros períodos — mismo criterio que charges.service.js#create.
    await expenseInstancesService.generateForExpense(expenseId);

    return this.getById(clubId, expenseId);
  }

  async update(clubId, expenseId, data, actorId) {
    const expense = await expensesRepository.findActiveById(expenseId);
    if (!expense || expense.club_id !== clubId) throw AppError.notFound('Gasto no encontrado.');
    if (expense.archived_at) throw AppError.conflict('Este gasto está archivado — restáuralo antes de editarlo.');

    const recurrence = data.recurrence !== undefined ? data.recurrence : expense.recurrence;
    const schedule =
      data.recurrence !== undefined || data.dueDay !== undefined || data.dueMonth !== undefined
        ? this._resolveSchedule({ recurrence, dueDay: data.dueDay, dueMonth: data.dueMonth })
        : undefined;

    if (data.categoryId !== undefined) await this._assertCategoryValid(clubId, data.categoryId);

    const updates = {};
    if (data.categoryId !== undefined) updates.category_id = data.categoryId || null;
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description || null;
    if (data.color !== undefined) updates.color = data.color;
    if (data.amount !== undefined) updates.amount = data.amount;
    if (data.payee !== undefined) updates.payee = data.payee || null;
    if (data.recurrence !== undefined) updates.recurrence = data.recurrence;
    if (data.startDate !== undefined) updates.start_date = data.startDate;
    if (schedule !== undefined) {
      updates.due_day = schedule.dueDay;
      updates.due_month = schedule.dueMonth;
    }
    if (data.endDate !== undefined) updates.end_date = data.endDate || null;
    if (data.status !== undefined) updates.status = data.status;

    if (Object.keys(updates).length) await expensesRepository.updateById(expenseId, updates);

    const changes = buildDiff({
      name: updates.name !== undefined ? diffValue(expense.name, updates.name) : undefined,
      amount: updates.amount !== undefined ? diffValue(Number(expense.amount), Number(updates.amount)) : undefined,
      status: updates.status !== undefined ? diffValue(expense.status, updates.status) : undefined,
    });
    if (changes) {
      await auditRepository.logAction({ userId: actorId, clubId, action: 'EXPENSE_UPDATED', entityType: 'expense', entityId: expenseId, changes });
    }

    // Reactivación: mismo criterio que charges.service.js#update — no esperar al cron nocturno.
    if (data.status === 'active' && expense.status !== 'active') {
      await expenseInstancesService.generateForExpense(expenseId);
    }

    return this.getById(clubId, expenseId);
  }

  /** Solo se puede eliminar un gasto YA ARCHIVADO — mismo criterio que charges.service.js#remove. */
  async remove(clubId, expenseId, actorId) {
    const expense = await expensesRepository.findActiveById(expenseId);
    if (!expense || expense.club_id !== clubId) throw AppError.notFound('Gasto no encontrado.');
    if (!expense.archived_at) throw AppError.conflict('Solo se pueden eliminar gastos archivados — archívalo primero.');
    await expensesRepository.softDelete(expenseId);
    await auditRepository.logAction({ userId: actorId, clubId, action: 'EXPENSE_DELETED', entityType: 'expense', entityId: expenseId, changes: { name: expense.name } });
  }

  /** Mismo criterio que charges.service.js#archive: oculta de Gastos, detiene la generación de
   * nuevos períodos, y auto-desactiva si estaba activo (su dinero histórico sigue contando). */
  async archive(clubId, expenseId, actorId) {
    const expense = await expensesRepository.findActiveById(expenseId);
    if (!expense || expense.club_id !== clubId) throw AppError.notFound('Gasto no encontrado.');
    if (expense.archived_at) throw AppError.conflict('Este gasto ya está archivado.');
    await expensesRepository.archive(expenseId);
    if (expense.status === 'active') await expensesRepository.updateById(expenseId, { status: 'inactive' });
    await auditRepository.logAction({ userId: actorId, clubId, action: 'EXPENSE_ARCHIVED', entityType: 'expense', entityId: expenseId, changes: { name: expense.name } });
    return this.getById(clubId, expenseId);
  }

  /** Restaurar NUNCA reactiva la generación por sí solo — mismo criterio que
   * charges.service.js#restore, queda inactivo hasta que alguien lo reactive a mano. */
  async restore(clubId, expenseId, actorId) {
    const expense = await expensesRepository.findActiveById(expenseId);
    if (!expense || expense.club_id !== clubId) throw AppError.notFound('Gasto no encontrado.');
    if (!expense.archived_at) throw AppError.conflict('Este gasto no está archivado.');
    await expensesRepository.restore(expenseId);
    await auditRepository.logAction({ userId: actorId, clubId, action: 'EXPENSE_RESTORED', entityType: 'expense', entityId: expenseId, changes: { name: expense.name } });
    return this.getById(clubId, expenseId);
  }
}

module.exports = new ExpensesService();
