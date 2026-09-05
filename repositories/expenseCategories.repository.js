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
