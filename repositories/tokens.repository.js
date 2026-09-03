const { pool } = require('../config/database');
const { TOKEN_TYPE } = require('../config/constants');

/**
 * Repositorio genérico para tokens de un solo uso (verificación de email, reset de password).
 * Se persiste únicamente el hash (sha256) del token, nunca el valor en texto plano.
 */
class TokensRepository {
  async create({ userId, tokenHash, type, expiresAt }, conn = pool) {
    const table = type === TOKEN_TYPE.RESET_PASSWORD ? 'password_reset_tokens' : 'email_verification_tokens';
    const [result] = await conn.query(
      `INSERT INTO ${table} (user_id, token_hash, expires_at) VALUES (?, ?, ?)`,
      [userId, tokenHash, expiresAt]
    );
    return result.insertId;
  }

  async findValid({ tokenHash, type }, conn = pool) {
    const table = type === TOKEN_TYPE.RESET_PASSWORD ? 'password_reset_tokens' : 'email_verification_tokens';
    const [rows] = await conn.query(
      `SELECT * FROM ${table} WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() LIMIT 1`,
      [tokenHash]
    );
    return rows[0] || null;
  }

  async markUsed({ id, type }, conn = pool) {
    const table = type === TOKEN_TYPE.RESET_PASSWORD ? 'password_reset_tokens' : 'email_verification_tokens';
    await conn.query(`UPDATE ${table} SET used_at = NOW() WHERE id = ?`, [id]);
  }

  async invalidateAllForUser({ userId, type }, conn = pool) {
    const table = type === TOKEN_TYPE.RESET_PASSWORD ? 'password_reset_tokens' : 'email_verification_tokens';
    await conn.query(`UPDATE ${table} SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL`, [userId]);
  }
}

module.exports = new TokensRepository();
