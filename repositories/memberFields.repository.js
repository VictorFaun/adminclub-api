const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');

class MemberFieldsRepository extends BaseRepository {
  constructor() {
    super('member_fields', 'id');
  }

  async findByClub(clubId, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM member_fields WHERE club_id = ? ORDER BY sort_order ASC, label ASC', [
      clubId,
    ]);
    return rows;
  }

  async findByCode(clubId, code, conn = pool) {
    const [rows] = await conn.query('SELECT * FROM member_fields WHERE club_id = ? AND code = ? LIMIT 1', [
      clubId,
      code,
    ]);
    return rows[0] || null;
  }

  async createField(data, conn = pool) {
    const [result] = await conn.query(
      `INSERT INTO member_fields (club_id, code, label, field_type, options, is_required, sort_order)
       VALUES (:clubId, :code, :label, :fieldType, :options, :isRequired, :sortOrder)`,
      data
    );
    return result.insertId;
  }

  async deleteField(id, clubId, conn = pool) {
    const [result] = await conn.query('DELETE FROM member_fields WHERE id = ? AND club_id = ?', [id, clubId]);
    return result.affectedRows > 0;
  }
}

module.exports = new MemberFieldsRepository();
