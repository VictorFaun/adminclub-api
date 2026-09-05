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
    const rows = await expenseCategoriesRepository.findByClub(clubId);
    return rows.map((r) => this.toDto(r));
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
