/**
 * Forma de dominio de la entidad Usuario. `fromRow` mapea snake_case (MySQL)
 * a camelCase y excluye campos sensibles salvo que se pidan explícitamente.
 */
class User {
  static fromRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      uuid: row.uuid,
      username: row.username,
      email: row.email,
      avatarUrl: row.avatar_url,
      phone: row.phone,
      status: row.status,
      emailVerifiedAt: row.email_verified_at,
      defaultClubId: row.default_club_id,
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  static withPasswordHash(row) {
    const user = User.fromRow(row);
    if (user) user.passwordHash = row.password_hash;
    return user;
  }
}

module.exports = User;
