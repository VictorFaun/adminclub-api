class FunctionModel {
  static fromRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      category: row.category,
      isClubAssignable: !!row.is_club_assignable,
      createdAt: row.created_at,
    };
  }
}

module.exports = FunctionModel;
