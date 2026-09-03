class Invitation {
  static fromRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      uuid: row.uuid,
      clubId: row.club_id,
      code: row.code,
      createdBy: row.created_by,
      maxUses: row.max_uses,
      usesCount: row.uses_count,
      expiresAt: row.expires_at,
      status: row.status,
      defaultRoleId: row.default_role_id,
      note: row.note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

module.exports = Invitation;
