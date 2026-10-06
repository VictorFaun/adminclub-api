const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');

class ExpenseCategoriesRepository extends BaseRepository {
  constructor() {
    super('expense_categories', 'id');
  }

  async findByClub(clubId, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM expense_categories WHERE club_id = ? ORDER BY name ASC', [clubId]);
    return rows;
  }

  async findByIds(ids, clubId, conn = pool) {
    if (!ids.length) return [];
    const [rows] = await conn.query('SELECT * FROM expense_categories WHERE id IN (?) AND club_id = ?', [ids, clubId]);
    return rows;
  }

  /** Resumen por categoría para el listado: gastos activos, lo que vence este mes, lo pagado
   * de eso y lo vencido sin pagar. */
  async statsByClub(clubId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT e.category_id,
              COUNT(DISTINCT CASE WHEN e.status = 'active' AND e.archived_at IS NULL THEN e.id END) AS active_count,
              COALESCE(SUM(CASE WHEN DATE_FORMAT(ei.due_date, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m') THEN ei.amount END), 0) AS due_month,
              COALESCE(SUM(CASE WHEN DATE_FORMAT(ei.due_date, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m') THEN LEAST(COALESCE(pp.paid, 0), ei.amount) END), 0) AS paid_month,
              COALESCE(SUM(CASE WHEN ei.due_date < CURDATE() AND ei.status <> 'paid' THEN GREATEST(ei.amount - COALESCE(pp.paid, 0), 0) END), 0) AS overdue
       FROM expenses e
       LEFT JOIN expense_instances ei ON ei.expense_id = e.id
       LEFT JOIN (SELECT expense_instance_id, SUM(amount) AS paid FROM expense_payments GROUP BY expense_instance_id) pp
         ON pp.expense_instance_id = ei.id
       WHERE e.club_id = ? AND e.category_id IS NOT NULL AND e.deleted_at IS NULL
       GROUP BY e.category_id`,
      [clubId]
    );
    return rows;
  }

  /** Gastos de la categoría (incluye archivados) con lo presupuestado (suma de sus períodos) y lo
   * ya pagado — insumo del detalle de categoría. */
  async findExpensesWithTotals(clubId, categoryId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT e.id, e.name, e.color, e.amount, e.payee, e.recurrence, e.status, e.archived_at,
              COUNT(ei.id) AS periods_count,
              COALESCE(SUM(ei.amount), 0) AS budgeted_total,
              COALESCE(SUM(pp.paid), 0) AS paid_total
       FROM expenses e
       LEFT JOIN expense_instances ei ON ei.expense_id = e.id
       LEFT JOIN (SELECT expense_instance_id, SUM(amount) AS paid FROM expense_payments GROUP BY expense_instance_id) pp
         ON pp.expense_instance_id = ei.id
       WHERE e.club_id = ? AND e.category_id = ? AND e.deleted_at IS NULL
       GROUP BY e.id ORDER BY e.name ASC`,
      [clubId, categoryId]
    );
    return rows;
  }

  /** Monto vencido sin pagar (períodos con fecha pasada, no pagados del todo). */
  async sumOverdue(clubId, categoryId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT COALESCE(SUM(GREATEST(ei.amount - COALESCE(pp.paid, 0), 0)), 0) AS total
       FROM expense_instances ei
       INNER JOIN expenses e ON e.id = ei.expense_id
       LEFT JOIN (SELECT expense_instance_id, SUM(amount) AS paid FROM expense_payments GROUP BY expense_instance_id) pp
         ON pp.expense_instance_id = ei.id
       WHERE e.club_id = ? AND e.category_id = ? AND e.deleted_at IS NULL
         AND ei.status <> 'paid' AND ei.due_date < CURDATE()`,
      [clubId, categoryId]
    );
    return Number(rows[0].total);
  }

  /** `{ 'YYYY-MM': total pagado }` de los últimos `months` meses (incluido el actual). */
  async sumPaidByMonth(clubId, categoryId, months, conn = pool) {
    const [rows] = await conn.query(
      `SELECT DATE_FORMAT(ep.paid_at, '%Y-%m') AS month, COALESCE(SUM(ep.amount), 0) AS total
       FROM expense_payments ep
       INNER JOIN expense_instances ei ON ei.id = ep.expense_instance_id
       INNER JOIN expenses e ON e.id = ei.expense_id
       WHERE ep.club_id = ? AND e.category_id = ? AND e.deleted_at IS NULL
         AND ep.paid_at >= DATE_SUB(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL ? MONTH)
       GROUP BY month`,
      [clubId, categoryId, months - 1]
    );
    return rows;
  }

  async findRecentPayments(clubId, categoryId, limit, conn = pool) {
    const [rows] = await conn.query(
      `SELECT ep.id, ep.amount, ep.paid_at, ep.note, e.id AS expense_id, e.name AS expense_name, ei.period_label
       FROM expense_payments ep
       INNER JOIN expense_instances ei ON ei.id = ep.expense_instance_id
       INNER JOIN expenses e ON e.id = ei.expense_id
       WHERE ep.club_id = ? AND e.category_id = ? AND e.deleted_at IS NULL
       ORDER BY ep.paid_at DESC LIMIT ?`,
      [clubId, categoryId, limit]
    );
    return rows;
  }

  async createCategory(data, conn = pool) {
    const [result] = await conn.query(
      'INSERT INTO expense_categories (uuid, club_id, name, description, color) VALUES (UUID(), :clubId, :name, :description, :color)',
      data
    );
    return result.insertId;
  }

  /** `true` si hay al menos un gasto (no eliminado) usando esta categoría — usado antes de
   * borrarla para decidir si conviene avisar al usuario (el borrado igual es seguro, `expenses.
   * category_id` tiene ON DELETE SET NULL, pero es mejor pedir confirmación explícita). */
  async isInUse(categoryId, conn = pool) {
    const [rows] = await conn.query('SELECT 1 FROM expenses WHERE category_id = ? AND deleted_at IS NULL LIMIT 1', [categoryId]);
    return rows.length > 0;
  }
}

module.exports = new ExpenseCategoriesRepository();
