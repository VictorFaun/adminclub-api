class Role {
  static fromRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      uuid: row.uuid,
      clubId: row.club_id,
      name: row.name,
      description: row.description,
      scope: row.scope,
      color: row.color,
      isSystem: !!row.is_system,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

module.exports = Role;
