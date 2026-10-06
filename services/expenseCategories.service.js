const expenseCategoriesRepository = require('../repositories/expenseCategories.repository');
const auditRepository = require('../repositories/audit.repository');
const AppError = require('../helpers/AppError');

class ExpenseCategoriesService {
  toDto(category) {
    return {
      id: category.id,
      uuid: category.uuid,
      clubId: category.club_id,
      name: category.name,
      description: category.description,
      color: category.color,
      createdAt: category.created_at,
    };
  }

  async listForClub(clubId) {
    const [rows, stats] = await Promise.all([expenseCategoriesRepository.findByClub(clubId), expenseCategoriesRepository.statsByClub(clubId)]);
    const byCategory = new Map(stats.map((st) => [st.category_id, st]));
    return rows.map((r) => {
      const st = byCategory.get(r.id);
      return {
        ...this.toDto(r),
        stats: {
          activeExpenses: Number(st?.active_count ?? 0),
          dueThisMonth: Number(st?.due_month ?? 0),
          paidThisMonth: Number(st?.paid_month ?? 0),
          overdue: Number(st?.overdue ?? 0),
        },
      };
    });
  }

  /** Detalle de UNA categoría: totales, gastos asociados, serie mensual de pagos y últimos pagos. */
  async getSummary(clubId, categoryId, months = 12) {
    const category = await expenseCategoriesRepository.findById(categoryId);
    if (!category || category.club_id !== clubId) throw AppError.notFound('Categoría no encontrada.');

    const [expenseRows, overdue, monthRows, recent] = await Promise.all([
      expenseCategoriesRepository.findExpensesWithTotals(clubId, categoryId),
      expenseCategoriesRepository.sumOverdue(clubId, categoryId),
      expenseCategoriesRepository.sumPaidByMonth(clubId, categoryId, months),
      expenseCategoriesRepository.findRecentPayments(clubId, categoryId, 10),
    ]);

    const expenses = expenseRows.map((e) => {
      const budgeted = Number(e.budgeted_total);
      const paid = Number(e.paid_total);
      return {
        id: e.id,
        name: e.name,
        color: e.color,
        amount: Number(e.amount),
        payee: e.payee,
        recurrence: e.recurrence,
        status: e.status,
        archivedAt: e.archived_at,
        periodsCount: Number(e.periods_count),
        budgetedTotal: budgeted,
        paidTotal: paid,
        pendingTotal: Math.max(budgeted - paid, 0),
      };
    });

    const paidTotal = expenses.reduce((sum, e) => sum + e.paidTotal, 0);
    const budgetedTotal = expenses.reduce((sum, e) => sum + e.budgetedTotal, 0);

    // Serie continua de `months` meses (los sin pagos van en 0) para que el gráfico no tenga huecos.
    const byMonth = new Map(monthRows.map((r) => [r.month, Number(r.total)]));
    const monthly = [];
    const now = new Date();
    for (let i = months - 1; i >= 0; i -= 1) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      monthly.push({ month: key, total: byMonth.get(key) ?? 0 });
    }

    return {
      category: this.toDto(category),
      totals: {
        expensesCount: expenses.length,
        activeExpensesCount: expenses.filter((e) => e.status === 'active' && !e.archivedAt).length,
        paidTotal,
        budgetedTotal,
        pendingTotal: Math.max(budgetedTotal - paidTotal, 0),
        overdueTotal: overdue,
      },
      expenses,
      monthly,
      recentPayments: recent.map((r) => ({
        id: r.id,
        amount: Number(r.amount),
        paidAt: r.paid_at,
        note: r.note,
        expenseId: r.expense_id,
        expenseName: r.expense_name,
        periodLabel: r.period_label,
      })),
    };
  }

  async create(clubId, data, actorId) {
    const id = await expenseCategoriesRepository.createCategory({
      clubId,
      name: data.name,
      description: data.description || null,
      color: data.color || '#6366F1',
    });
    await auditRepository.logAction({ userId: actorId, clubId, action: 'EXPENSE_CATEGORY_CREATED', entityType: 'expense_category', entityId: id, changes: { name: data.name } });
    const category = await expenseCategoriesRepository.findById(id);
    return this.toDto(category);
  }

  async update(clubId, categoryId, data, actorId) {
    const category = await expenseCategoriesRepository.findById(categoryId);
    if (!category || category.club_id !== clubId) throw AppError.notFound('Categoría no encontrada.');

    const updates = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description || null;
    if (data.color !== undefined) updates.color = data.color;
    if (Object.keys(updates).length) await expenseCategoriesRepository.updateById(categoryId, updates);

    await auditRepository.logAction({ userId: actorId, clubId, action: 'EXPENSE_CATEGORY_UPDATED', entityType: 'expense_category', entityId: categoryId, changes: updates });
    const updated = await expenseCategoriesRepository.findById(categoryId);
    return this.toDto(updated);
  }

  /** El borrado es seguro sin confirmación extra (`expenses.category_id` tiene ON DELETE SET
   * NULL), pero un gasto que se queda "sin categoría" de la nada sorprendería al usuario — se
   * exige desasignarla de sus gastos primero. */
  async remove(clubId, categoryId, actorId) {
    const category = await expenseCategoriesRepository.findById(categoryId);
    if (!category || category.club_id !== clubId) throw AppError.notFound('Categoría no encontrada.');
    if (await expenseCategoriesRepository.isInUse(categoryId)) {
      throw AppError.conflict('Esta categoría tiene gastos asignados — quítala de esos gastos antes de eliminarla.');
    }
    await expenseCategoriesRepository.deleteById(categoryId);
    await auditRepository.logAction({ userId: actorId, clubId, action: 'EXPENSE_CATEGORY_DELETED', entityType: 'expense_category', entityId: categoryId, changes: { name: category.name } });
  }
}

module.exports = new ExpenseCategoriesService();
