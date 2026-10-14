const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');
const { PROFILE_COLS, profileJoin } = require('../helpers/memberProfileSql');

/** Apoderados: cuentas que administran fichas de otras personas (ver sql/064_self_service.sql). */
class MemberGuardiansRepository extends BaseRepository {
  constructor() {
    super('member_guardians', 'id');
  }

  /**
   * "Mis fichas" de una cuenta en un club: la propia (members.user_id) + las que tiene a cargo.
   * `relation` = 'self' | 'guardian'; la propia primero. Nunca fichas eliminadas.
   */
  async findOwnMembers(clubId, userId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT m.*, ${PROFILE_COLS}, x.relation, x.guardian_relation
       FROM (
         SELECT id AS member_id, 'self' AS relation, NULL AS guardian_relation, 0 AS ord
           FROM members WHERE user_id = ? AND club_id = ? AND deleted_at IS NULL
         UNION
         SELECT mg.member_id, 'guardian', mg.relation, 1
           FROM member_guardians mg INNER JOIN members g ON g.id = mg.member_id
          WHERE mg.user_id = ? AND g.club_id = ? AND g.deleted_at IS NULL
       ) x
       INNER JOIN members m ON m.id = x.member_id
       ${profileJoin()}
       ORDER BY x.ord, mp.first_name, mp.last_name`,
      [userId, clubId, userId, clubId]
    );
    // Si la cuenta es titular Y apoderado de la misma ficha (no debería), queda una sola fila.
    const seen = new Set();
    return rows.filter((r) => (seen.has(r.id) ? false : seen.add(r.id)));
  }

  async findByMember(memberId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT mg.id, mg.member_id, mg.user_id, mg.relation, mg.created_at,
              u.username, u.email, u.avatar_url
       FROM member_guardians mg INNER JOIN users u ON u.id = mg.user_id
       WHERE mg.member_id = ? AND u.deleted_at IS NULL
       ORDER BY mg.created_at`,
      [memberId]
    );
    return rows;
  }

  /** Cuentas a notificar por una ficha: titular + apoderados (sin repetir). */
  async findUserIdsForMember(memberId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT user_id FROM members WHERE id = ? AND user_id IS NOT NULL
       UNION SELECT user_id FROM member_guardians WHERE member_id = ?`,
      [memberId, memberId]
    );
    return rows.map((r) => r.user_id);
  }

  async exists(memberId, userId, conn = pool) {
    const [rows] = await conn.query('SELECT 1 FROM member_guardians WHERE member_id = ? AND user_id = ? LIMIT 1', [memberId, userId]);
    return rows.length > 0;
  }

  /** Idempotente: si ya existe el vínculo, solo actualiza la relación. */
  async add({ memberId, userId, relation = null, createdBy = null }, conn = pool) {
    await conn.query(
      `INSERT INTO member_guardians (member_id, user_id, relation, created_by) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE relation = COALESCE(VALUES(relation), relation)`,
      [memberId, userId, relation, createdBy]
    );
  }

  async remove(memberId, userId, conn = pool) {
    const [result] = await conn.query('DELETE FROM member_guardians WHERE member_id = ? AND user_id = ?', [memberId, userId]);
    return result.affectedRows > 0;
  }

  /** Al sacar a alguien del club, deja de ser apoderado de las fichas de ese club. */
  async removeAllForUserInClub(userId, clubId, conn = pool) {
    await conn.query(
      `DELETE mg FROM member_guardians mg INNER JOIN members m ON m.id = mg.member_id WHERE mg.user_id = ? AND m.club_id = ?`,
      [userId, clubId]
    );
  }
}

module.exports = new MemberGuardiansRepository();
