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
