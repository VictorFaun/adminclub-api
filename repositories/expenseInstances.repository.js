const crypto = require('crypto');
const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');

class ExpenseInstancesRepository extends BaseRepository {
  constructor() {
    super('expense_instances', 'id');
  }

  async findActiveById(id, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM expense_instances WHERE id = ? LIMIT 1', [id]);
    return rows[0] || null;
  }

  async findByExpenseAndPeriod(expenseId, periodLabel, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM expense_instances WHERE expense_id = ? AND period_label = ? LIMIT 1', [
      expenseId,
      periodLabel,
    ]);
    return rows[0] || null;
  }

  /** Todas las instancias de UN gasto — usado por la vista de períodos (mirror simplificado de
   * la matriz de Cobros, sin dimensión de miembro). */
  async findForExpense(expenseId, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM expense_instances WHERE expense_id = ? ORDER BY due_date ASC', [expenseId]);
    return rows;
  }

  /** Genera (o ignora si ya existe, ver UNIQUE(expense_id, period_label)) — mismo patrón que
   * chargeInstances.repository.js#bulkInsertIgnore pero sin fan-out por miembro. */
  async bulkInsertIgnore(rows, conn = pool) {
    if (!rows.length) return 0;
    const values = rows.map((r) => [crypto.randomUUID(), r.expenseId, r.periodLabel, r.amount, r.dueDate]);
    const [result] = await conn.query(
      'INSERT IGNORE INTO expense_instances (uuid, expense_id, period_label, amount, due_date) VALUES ?',
      [values]
    );
    return result.affectedRows;
  }

  async sumPayments(instanceId, conn = pool) {
    const [rows] = await conn.query('SELECT COALESCE(SUM(amount), 0) AS total FROM expense_payments WHERE expense_instance_id = ?', [
      instanceId,
    ]);
    return Number(rows[0].total);
  }

  /** Recalcula `status` sumando los pagos vigentes contra el monto de la instancia — mismo
   * patrón que chargeInstancesRepository.recomputeStatus, sin el caso `exempt`. */
  async recomputeStatus(instanceId, conn = pool) {
    const instance = await this.findActiveById(instanceId, conn);
    if (!instance) return;
    const paid = await this.sumPayments(instanceId, conn);
    const status = paid <= 0 ? 'pending' : paid >= Number(instance.amount) ? 'paid' : 'partial';
    await conn.query('UPDATE expense_instances SET status = ? WHERE id = ?', [status, instanceId]);
  }
}

module.exports = new ExpenseInstancesRepository();
