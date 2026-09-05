const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');

class ExpensePaymentsRepository extends BaseRepository {
  constructor() {
    super('expense_payments', 'id');
  }

  async findActiveById(id, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM expense_payments WHERE id = ? LIMIT 1', [id]);
    return rows[0] || null;
  }

  /** Todos los pagos que tocan UNA instancia — mismo rol que payments.repository.js#findByInstance
   * (un período puede acumular varios abonos). */
  async findByInstance(instanceId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT ep.*, u.username AS registered_by_username
       FROM expense_payments ep
       LEFT JOIN users u ON u.id = ep.registered_by
       WHERE ep.expense_instance_id = ? ORDER BY ep.paid_at DESC`,
      [instanceId]
    );
    return rows;
  }

  async createPayment(data, conn = pool) {
    const [result] = await conn.query(
      `INSERT INTO expense_payments (uuid, club_id, expense_instance_id, amount, paid_at, note, registered_by)
       VALUES (UUID(), :clubId, :expenseInstanceId, :amount, :paidAt, :note, :registeredBy)`,
      data
    );
    return result.insertId;
  }

  async deletePayment(id, conn = pool) {
    await conn.query('DELETE FROM expense_payments WHERE id = ?', [id]);
  }

  /** Suma histórica completa, filtrando gastos eliminados (mismo criterio que
   * payments.repository.js#sumDirectPayments — un gasto eliminado no debería seguir inflando el
   * total del dashboard). */
  async sumAllTime(clubId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT COALESCE(SUM(ep.amount), 0) AS total
       FROM expense_payments ep
       INNER JOIN expense_instances ei ON ei.id = ep.expense_instance_id
       INNER JOIN expenses e ON e.id = ei.expense_id
       WHERE ep.club_id = ? AND e.deleted_at IS NULL`,
      [clubId]
    );
    return Number(rows[0].total);
  }

  /** `{ 'YYYY-MM': total }` de los últimos `months` meses (incluido el actual) — mirror de
   * payments.repository.js#sumDirectPaymentsByMonth, para el gráfico del dashboard. */
  async sumAllTimeByMonth(clubId, months, conn = pool) {
    const [rows] = await conn.query(
      `SELECT DATE_FORMAT(ep.paid_at, '%Y-%m') AS month, COALESCE(SUM(ep.amount), 0) AS total
       FROM expense_payments ep
       INNER JOIN expense_instances ei ON ei.id = ep.expense_instance_id
       INNER JOIN expenses e ON e.id = ei.expense_id
       WHERE ep.club_id = ? AND e.deleted_at IS NULL
         AND ep.paid_at >= DATE_SUB(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL ? MONTH)
       GROUP BY month`,
      [clubId, months - 1]
    );
    const byMonth = {};
    for (const row of rows) byMonth[row.month] = Number(row.total);
    return byMonth;
  }
}

module.exports = new ExpensePaymentsRepository();
