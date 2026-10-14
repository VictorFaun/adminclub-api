const { pool } = require('../config/database');

class SessionsRepository {
  async createSession({ userId, ipAddress, userAgent }, conn = pool) {
    const [result] = await conn.query(
      'INSERT INTO sessions (user_id, ip_address, user_agent, is_active, last_activity_at) VALUES (?, ?, ?, 1, NOW())',
      [userId, ipAddress, userAgent]
    );
    return result.insertId;
  }

  async touch(sessionId, conn = pool) {
    await conn.query('UPDATE sessions SET last_activity_at = NOW() WHERE id = ?', [sessionId]);
  }

  async deactivate(sessionId, conn = pool) {
    await conn.query('UPDATE sessions SET is_active = 0 WHERE id = ?', [sessionId]);
  }

  async findActiveByUser(userId, conn = pool) {
    const [rows] = await conn.query(
      'SELECT * FROM sessions WHERE user_id = ? AND is_active = 1 ORDER BY last_activity_at DESC',
      [userId]
    );
    return rows;
  }

  // --- refresh tokens ---

  async storeRefreshToken({ userId, sessionId, tokenHash, expiresAt, ipAddress, userAgent }, conn = pool) {
    const [result] = await conn.query(
      `INSERT INTO refresh_tokens (user_id, session_id, token_hash, expires_at, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, sessionId, tokenHash, expiresAt, ipAddress, userAgent]
    );
    return result.insertId;
  }

  async findValidByHash(tokenHash, conn = pool) {
    const [rows] = await conn.query(
      `SELECT * FROM refresh_tokens
       WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > NOW() LIMIT 1`,
      [tokenHash]
    );
    return rows[0] || null;
  }

  /** Token rotado hace muy poco (tiene reemplazo, no fue un logout): se acepta igual dentro de un
   * margen corto. Cubre la carrera de recargar la página (u otra pestaña) mientras un refresh
   * anterior ya había rotado el token pero su respuesta (con la cookie nueva) no alcanzó a llegar. */
  async findRecentlyRotatedByHash(tokenHash, graceSeconds, conn = pool) {
    const [rows] = await conn.query(
      `SELECT * FROM refresh_tokens
       WHERE token_hash = ? AND revoked_at IS NOT NULL AND replaced_by_token_hash IS NOT NULL
         AND revoked_at > (NOW() - INTERVAL ? SECOND) AND expires_at > NOW() LIMIT 1`,
      [tokenHash, graceSeconds]
    );
    return rows[0] || null;
  }

  async revokeByHash(tokenHash, replacedByHash = null, conn = pool) {
    await conn.query('UPDATE refresh_tokens SET revoked_at = NOW(), replaced_by_token_hash = ? WHERE token_hash = ?', [
      replacedByHash,
      tokenHash,
    ]);
  }

  async revokeAllForUser(userId, conn = pool) {
    await conn.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [
      userId,
    ]);
    await conn.query('UPDATE sessions SET is_active = 0 WHERE user_id = ?', [userId]);
  }

  async purgeExpired(conn = pool) {
    const [result] = await conn.query('DELETE FROM refresh_tokens WHERE expires_at < NOW() - INTERVAL 7 DAY');
    return result.affectedRows;
  }
}

module.exports = new SessionsRepository();
