const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');

class MemberTagsRepository extends BaseRepository {
  constructor() {
    super('member_tags', 'id');
  }

  async findByClub(clubId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT t.*, COUNT(mtm.member_id) AS members_count FROM member_tags t
       LEFT JOIN member_tag_members mtm ON mtm.tag_id = t.id
       WHERE t.club_id = ? GROUP BY t.id ORDER BY t.name ASC`,
      [clubId]
    );
    return rows;
  }

  async findByIdInClub(id, clubId, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM member_tags WHERE id = ? AND club_id = ? LIMIT 1', [id, clubId]);
    return rows[0] || null;
  }

  async countMembers(tagId, conn = pool) {
    const [rows] = await conn.query('SELECT COUNT(*) AS total FROM member_tag_members WHERE tag_id = ?', [tagId]);
    return rows[0].total;
  }

  async findByNameInClub(name, clubId, excludeTagId = null, conn = pool) {
    const sql = excludeTagId
      ? 'SELECT id FROM member_tags WHERE name = ? AND club_id = ? AND id != ? LIMIT 1'
      : 'SELECT id FROM member_tags WHERE name = ? AND club_id = ? LIMIT 1';
    const params = excludeTagId ? [name, clubId, excludeTagId] : [name, clubId];
    const [rows] = await conn.query(sql, params);
    return rows[0] || null;
  }

  async createTag(data, conn = pool) {
    const [result] = await conn.query(
      `INSERT INTO member_tags (uuid, club_id, name, description, color) VALUES (UUID(), :clubId, :name, :description, :color)`,
      data
    );
    return result.insertId;
  }

  async findByIds(ids, clubId, conn = pool) {
    if (!ids.length) return [];
    const [rows] = await conn.query('SELECT id FROM member_tags WHERE id IN (?) AND club_id = ?', [ids, clubId]);
    return rows;
  }

  /** Lista liviana `{id, name, color}` para pickers (charge-form, member-form) — sin paginar. */
  async findOptions(clubId, conn = pool) {
    const [rows] = await conn.query('SELECT id, name, color FROM member_tags WHERE club_id = ? ORDER BY name ASC', [clubId]);
    return rows;
  }

  async paginateMembers(tagId, { limit, offset }) {
    const [rows] = await pool.query(
      `SELECT m.* FROM members m
       INNER JOIN member_tag_members mtm ON mtm.member_id = m.id
       WHERE mtm.tag_id = ? AND m.deleted_at IS NULL
       ORDER BY m.first_name ASC, m.last_name ASC LIMIT ? OFFSET ?`,
      [tagId, limit, offset]
    );
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM member_tag_members mtm
       INNER JOIN members m ON m.id = mtm.member_id
       WHERE mtm.tag_id = ? AND m.deleted_at IS NULL`,
      [tagId]
    );
    return { rows, total: countRows[0].total };
  }

  async addMembers(tagId, memberIds, conn = pool) {
    if (!memberIds.length) return;
    const values = memberIds.map((memberId) => [tagId, memberId]);
    await conn.query('INSERT IGNORE INTO member_tag_members (tag_id, member_id) VALUES ?', [values]);
  }

  async removeMember(tagId, memberId, conn = pool) {
    await conn.query('DELETE FROM member_tag_members WHERE tag_id = ? AND member_id = ?', [tagId, memberId]);
  }
}

module.exports = new MemberTagsRepository();
