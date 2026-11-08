const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');
const { PROFILE_COLS, profileJoin } = require('../helpers/memberProfileSql');

/**
 * Apoderados (ver sql/072): un apoderado es un MIEMBRO del club vinculado a otro miembro
 * (`guardian_member_id` → `member_id`). La cuenta de usuario es opcional e independiente: si el
 * registro del apoderado tiene cuenta (members.user_id), esa cuenta ve en "Mi club" las fichas a
 * su cargo.
 */
class MemberGuardiansRepository extends BaseRepository {
  constructor() {
    super('member_guardians', 'id');
  }

  /**
   * "Mis fichas" de una cuenta en un club: la propia (members.user_id) + las que tiene a cargo
   * su registro de miembro. `relation` = 'self' | 'guardian'; la propia primero. Nunca fichas
   * eliminadas (ni la del apoderado ni la del miembro a cargo).
   */
  async findOwnMembers(clubId, userId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT m.*, ${PROFILE_COLS}, x.relation, x.guardian_relation
       FROM (
         SELECT id AS member_id, 'self' AS relation, NULL AS guardian_relation, 0 AS ord
           FROM members WHERE user_id = ? AND club_id = ? AND deleted_at IS NULL
         UNION
         SELECT mg.member_id, 'guardian', mg.relation, 1
           FROM member_guardians mg
           INNER JOIN members g ON g.id = mg.guardian_member_id
           INNER JOIN members child ON child.id = mg.member_id
          WHERE g.user_id = ? AND g.club_id = ? AND g.deleted_at IS NULL AND child.deleted_at IS NULL
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

  /** Apoderados de una ficha: su registro de miembro + la cuenta vinculada, si tiene. */
  async findByMember(memberId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT mg.id, mg.member_id, mg.guardian_member_id, mg.relation, mg.created_at,
              g.user_id, g.status AS guardian_status, ${PROFILE_COLS},
              u.username, u.email AS user_email, u.avatar_url AS user_avatar_url
       FROM member_guardians mg
       INNER JOIN members g ON g.id = mg.guardian_member_id
       ${profileJoin('g')}
       LEFT JOIN users u ON u.id = g.user_id AND u.deleted_at IS NULL
       WHERE mg.member_id = ? AND g.deleted_at IS NULL
       ORDER BY mg.created_at`,
      [memberId]
    );
    return rows;
  }

  /** Fichas de las que es apoderado un miembro. */
  async findWards(guardianMemberId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT mg.id, mg.member_id, mg.relation, mg.created_at, m.status, ${PROFILE_COLS}
       FROM member_guardians mg
       INNER JOIN members m ON m.id = mg.member_id
       ${profileJoin()}
       WHERE mg.guardian_member_id = ? AND m.deleted_at IS NULL
       ORDER BY mp.first_name, mp.last_name`,
      [guardianMemberId]
    );
    return rows;
  }

  /** Cuentas a notificar por una ficha: titular + cuentas de sus apoderados (sin repetir). */
  async findUserIdsForMember(memberId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT user_id FROM members WHERE id = ? AND user_id IS NOT NULL
       UNION
       SELECT g.user_id FROM member_guardians mg INNER JOIN members g ON g.id = mg.guardian_member_id
        WHERE mg.member_id = ? AND g.user_id IS NOT NULL AND g.deleted_at IS NULL`,
      [memberId, memberId]
    );
    return rows.map((r) => r.user_id);
  }

  async exists(memberId, guardianMemberId, conn = pool) {
    const [rows] = await conn.query('SELECT 1 FROM member_guardians WHERE member_id = ? AND guardian_member_id = ? LIMIT 1', [memberId, guardianMemberId]);
    return rows.length > 0;
  }

  /** Idempotente: si ya existe el vínculo, solo actualiza la relación. */
  async add({ memberId, guardianMemberId, relation = null, createdBy = null }, conn = pool) {
    await conn.query(
      `INSERT INTO member_guardians (member_id, guardian_member_id, relation, created_by) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE relation = COALESCE(VALUES(relation), relation)`,
      [memberId, guardianMemberId, relation, createdBy]
    );
  }

  async remove(memberId, guardianMemberId, conn = pool) {
    const [result] = await conn.query('DELETE FROM member_guardians WHERE member_id = ? AND guardian_member_id = ?', [memberId, guardianMemberId]);
    return result.affectedRows > 0;
  }
}

module.exports = new MemberGuardiansRepository();
