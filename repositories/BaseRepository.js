const { pool } = require('../config/database');

/**
 * Repositorio base con operaciones CRUD genéricas sobre una tabla.
 * Los repositorios de cada módulo extienden esta clase y añaden sus propias
 * queries específicas (joins, filtros de dominio, etc). Todas las queries
 * usan placeholders (?) — nunca concatenar valores de usuario en el SQL.
 */
class BaseRepository {
  /**
   * @param {string} table nombre de la tabla
   * @param {string} primaryKey nombre de la columna PK
   */
  constructor(table, primaryKey = 'id') {
    this.table = table;
    this.primaryKey = primaryKey;
  }

  async findById(id, conn = pool) {
    const [rows] = await conn.query(`SELECT * FROM \`${this.table}\` WHERE \`${this.primaryKey}\` = ? LIMIT 1`, [id]);
    return rows[0] || null;
  }

  async findOneBy(column, value, conn = pool) {
    const [rows] = await conn.query(`SELECT * FROM \`${this.table}\` WHERE \`${column}\` = ? LIMIT 1`, [value]);
    return rows[0] || null;
  }

  async findAll(conn = pool) {
    const [rows] = await conn.query(`SELECT * FROM \`${this.table}\``);
    return rows;
  }

  async insert(data, conn = pool) {
    const [result] = await conn.query(`INSERT INTO \`${this.table}\` SET ?`, [data]);
    return result.insertId;
  }

  async updateById(id, data, conn = pool) {
    const [result] = await conn.query(`UPDATE \`${this.table}\` SET ? WHERE \`${this.primaryKey}\` = ?`, [
      data,
      id,
    ]);
    return result.affectedRows > 0;
  }

  async deleteById(id, conn = pool) {
    const [result] = await conn.query(`DELETE FROM \`${this.table}\` WHERE \`${this.primaryKey}\` = ?`, [id]);
    return result.affectedRows > 0;
  }

  async count(whereSql = '1', params = [], conn = pool) {
    const [rows] = await conn.query(`SELECT COUNT(*) AS total FROM \`${this.table}\` WHERE ${whereSql}`, params);
    return rows[0].total;
  }
}

module.exports = BaseRepository;
