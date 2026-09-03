const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');

class MemberGroupsRepository extends BaseRepository {
  constructor() {
    super('member_groups', 'id');
  }

  async findByClub(clubId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT g.*, COUNT(mgm.member_id) AS members_count FROM member_groups g
       LEFT JOIN member_group_members mgm ON mgm.group_id = g.id
       WHERE g.club_id = ? GROUP BY g.id ORDER BY g.name ASC`,
      [clubId]
    );
    return rows;
  }

  async findByIdInClub(id, clubId, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM member_groups WHERE id = ? AND club_id = ? LIMIT 1', [id, clubId]);
    return rows[0] || null;
  }

  async countMembers(groupId, conn = pool) {
    const [rows] = await conn.query('SELECT COUNT(*) AS total FROM member_group_members WHERE group_id = ?', [groupId]);
    return rows[0].total;
  }

  async findByNameInClub(name, clubId, excludeGroupId = null, conn = pool) {
    const sql = excludeGroupId
      ? 'SELECT id FROM member_groups WHERE name = ? AND club_id = ? AND id != ? LIMIT 1'
      : 'SELECT id FROM member_groups WHERE name = ? AND club_id = ? LIMIT 1';
    const params = excludeGroupId ? [name, clubId, excludeGroupId] : [name, clubId];
    const [rows] = await conn.query(sql, params);
    return rows[0] || null;
  }

  async createGroup(data, conn = pool) {
    const [result] = await conn.query(
      `INSERT INTO member_groups (uuid, club_id, name, description, color) VALUES (UUID(), :clubId, :name, :description, :color)`,
      data
    );
    return result.insertId;
  }

  async findByIds(ids, clubId, conn = pool) {
    if (!ids.length) return [];
    const [rows] = await conn.query('SELECT id FROM member_groups WHERE id IN (?) AND club_id = ?', [ids, clubId]);
    return rows;
  }

  /** Lista liviana `{id, name, color}` para pickers (scope de rol) — sin paginar. */
  async findOptions(clubId, conn = pool) {
    const [rows] = await conn.query('SELECT id, name, color FROM member_groups WHERE club_id = ? ORDER BY name ASC', [
      clubId,
    ]);
    return rows;
  }

  async paginateMembers(groupId, { limit, offset }) {
    const [rows] = await pool.query(
      `SELECT m.* FROM members m
       INNER JOIN member_group_members mgm ON mgm.member_id = m.id
       WHERE mgm.group_id = ? AND m.deleted_at IS NULL
       ORDER BY m.first_name ASC, m.last_name ASC LIMIT ? OFFSET ?`,
      [groupId, limit, offset]
    );
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM member_group_members mgm
       INNER JOIN members m ON m.id = mgm.member_id
       WHERE mgm.group_id = ? AND m.deleted_at IS NULL`,
      [groupId]
    );
    return { rows, total: countRows[0].total };
  }

  async addMembers(groupId, memberIds, conn = pool) {
    if (!memberIds.length) return;
    const values = memberIds.map((memberId) => [groupId, memberId]);
    await conn.query('INSERT IGNORE INTO member_group_members (group_id, member_id) VALUES ?', [values]);
  }

  async removeMember(groupId, memberId, conn = pool) {
    await conn.query('DELETE FROM member_group_members WHERE group_id = ? AND member_id = ?', [groupId, memberId]);
  }
}

module.exports = new MemberGroupsRepository();
