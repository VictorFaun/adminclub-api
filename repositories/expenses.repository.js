const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');

class ExpensesRepository extends BaseRepository {
  constructor() {
    super('expenses', 'id');
  }

  async findActiveById(id, conn = pool) {
    const [rows] = await conn.query(
      `SELECT e.*, ec.name AS category_name, ec.color AS category_color
       FROM expenses e
       LEFT JOIN expense_categories ec ON ec.id = e.category_id
       WHERE e.id = ? AND e.deleted_at IS NULL LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }

  /** Solo gastos NO archivados — mismo criterio que charges.repository.js#findByClub. */
  async findByClub(clubId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT e.*, ec.name AS category_name, ec.color AS category_color
       FROM expenses e
       LEFT JOIN expense_categories ec ON ec.id = e.category_id
       WHERE e.club_id = ? AND e.deleted_at IS NULL AND e.archived_at IS NULL ORDER BY e.name ASC`,
      [clubId]
    );
    return rows;
  }

  async findArchivedByClub(clubId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT e.*, ec.name AS category_name, ec.color AS category_color
       FROM expenses e
       LEFT JOIN expense_categories ec ON ec.id = e.category_id
       WHERE e.club_id = ? AND e.deleted_at IS NULL AND e.archived_at IS NOT NULL ORDER BY e.archived_at DESC`,
      [clubId]
    );
    return rows;
  }

  async findActiveByClubForGeneration(clubId, conn = pool) {
    const [rows] = await conn.query(
      "SELECT * FROM expenses WHERE club_id = ? AND status = 'active' AND deleted_at IS NULL AND archived_at IS NULL",
      [clubId]
    );
    return rows;
  }

  async findAllActiveForGeneration(conn = pool) {
    const [rows] = await conn.query("SELECT * FROM expenses WHERE status = 'active' AND deleted_at IS NULL AND archived_at IS NULL");
    return rows;
  }

  async countActiveByClub(clubId, conn = pool) {
    const [rows] = await conn.query(
      "SELECT COUNT(*) AS total FROM expenses WHERE club_id = ? AND status = 'active' AND deleted_at IS NULL AND archived_at IS NULL",
      [clubId]
    );
    return rows[0].total;
  }

  async archive(id, conn = pool) {
    await conn.query('UPDATE expenses SET archived_at = NOW() WHERE id = ?', [id]);
  }

  async restore(id, conn = pool) {
    await conn.query('UPDATE expenses SET archived_at = NULL WHERE id = ?', [id]);
  }

  async softDelete(id, conn = pool) {
    await conn.query('UPDATE expenses SET deleted_at = NOW() WHERE id = ?', [id]);
  }

  async createExpense(data, conn = pool) {
    const [result] = await conn.query(
      `INSERT INTO expenses
        (uuid, club_id, category_id, name, description, color, amount, payee, recurrence, start_date, due_day, due_month, end_date, status, created_by)
       VALUES (UUID(), :clubId, :categoryId, :name, :description, :color, :amount, :payee, :recurrence, :startDate, :dueDay, :dueMonth, :endDate, :status, :createdBy)`,
      data
    );
    return result.insertId;
  }
}

module.exports = new ExpensesRepository();
