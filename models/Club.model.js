class Club {
  static fromRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      uuid: row.uuid,
      name: row.name,
      publicCode: row.public_code,
      description: row.description,
      logoUrl: row.logo_url,
      bannerUrl: row.banner_url,
      primaryColor: row.primary_color,
      secondaryColor: row.secondary_color,
      theme: row.theme,
      status: row.status,
      inviteCode: row.invite_code,
      isPublic: !!row.is_public,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

module.exports = Club;
