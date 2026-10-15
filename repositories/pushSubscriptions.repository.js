const { pool } = require('../config/database');
const BaseRepository = require('./BaseRepository');
const { USER_STATUS } = require('../config/constants');

class PushSubscriptionsRepository extends BaseRepository {
  constructor() {
    super('push_subscriptions', 'id');
  }

  /** Guarda o REASIGNA (mismo navegador, otra cuenta o sesión nueva) la suscripción del endpoint. */
  async upsert({ userId, sessionId, endpoint, endpointHash, p256dh, auth, userAgent }, conn = pool) {
    await conn.query(
      `INSERT INTO push_subscriptions (user_id, session_id, endpoint, endpoint_hash, p256dh, auth, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), session_id = VALUES(session_id), endpoint = VALUES(endpoint),
         p256dh = VALUES(p256dh), auth = VALUES(auth), user_agent = VALUES(user_agent), last_seen_at = NOW(), failures = 0`,
      [userId, sessionId, endpoint, endpointHash, p256dh, auth, userAgent]
    );
  }

  async deleteByHashForUser(endpointHash, userId, conn = pool) {
    await conn.query('DELETE FROM push_subscriptions WHERE endpoint_hash = ? AND user_id = ?', [endpointHash, userId]);
  }

  async deleteBySession(sessionId, conn = pool) {
    await conn.query('DELETE FROM push_subscriptions WHERE session_id = ?', [sessionId]);
  }

  async deleteByUser(userId, conn = pool) {
    await conn.query('DELETE FROM push_subscriptions WHERE user_id = ?', [userId]);
  }

  /** Suscripciones a las que se puede enviar: usuario activo y sesión todavía abierta (o sin
   * sesión asociada, p. ej. activadas con un token anterior a esta función; se ligan a la sesión
   * en la siguiente apertura de la app). */
  async findDeliverableByUsers(userIds, conn = pool) {
    if (!userIds.length) return [];
    const [rows] = await conn.query(
      `SELECT ps.* FROM push_subscriptions ps
       JOIN users u ON u.id = ps.user_id AND u.status = ? AND u.deleted_at IS NULL
       LEFT JOIN sessions s ON s.id = ps.session_id
       WHERE ps.user_id IN (?) AND (ps.session_id IS NULL OR s.is_active = 1)`,
      [USER_STATUS.ACTIVE, userIds]
    );
    return rows;
  }

  /** Ids de sesión (de esta cuenta) que tienen el push activo — para la lista de Perfil → Sesiones. */
  async findSessionIdsWithPush(userId, conn = pool) {
    const [rows] = await conn.query('SELECT DISTINCT session_id FROM push_subscriptions WHERE user_id = ? AND session_id IS NOT NULL', [userId]);
    return new Set(rows.map((r) => r.session_id));
  }

  async markSuccess(id, conn = pool) {
    await conn.query('UPDATE push_subscriptions SET last_success_at = NOW(), failures = 0 WHERE id = ?', [id]);
  }

  async addFailure(id, conn = pool) {
    await conn.query('UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?', [id]);
  }

  /** Limpieza (cron): endpoints que fallan seguido sin responder 404/410. */
  async purgeFailing(maxFailures, conn = pool) {
    const [result] = await conn.query('DELETE FROM push_subscriptions WHERE failures >= ?', [maxFailures]);
    return result.affectedRows;
  }
}

module.exports = new PushSubscriptionsRepository();
