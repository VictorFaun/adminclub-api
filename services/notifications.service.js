const notificationsRepository = require('../repositories/notifications.repository');
const { parsePagination, buildMeta } = require('../helpers/pagination');
const Notification = require('../models/Notification.model');
const { pool } = require('../config/database');
const { emitToUser } = require('../sockets');

class NotificationsService {
  async listForUser(userId, query) {
    const { limit, offset, sortBy, sortOrder, page } = parsePagination(query, ['created_at', 'is_read']);
    const { rows, total, unreadCount } = await notificationsRepository.paginateByUser(userId, {
      limit,
      offset,
      sortBy,
      sortOrder,
      unreadOnly: query.unreadOnly === 'true',
      clubId: query.clubId ? Number(query.clubId) : null,
    });
    return {
      items: rows.map(Notification.fromRow),
      meta: buildMeta({ page, limit, total }),
      unreadCount,
    };
  }

  async markRead(userId, notificationId) {
    await notificationsRepository.markRead(notificationId, userId);
  }

  async markAllRead(userId, clubId) {
    await notificationsRepository.markAllRead(userId, clubId ? Number(clubId) : null);
  }

  /** Envía una notificación a un usuario específico (persistida + push en tiempo real). */
  async notifyUser({ userId, clubId, type, title, message, link }) {
    const id = await notificationsRepository.createNotification({ userId, clubId, type, title, message, link });
    try {
      emitToUser(userId, 'notification:new', { id, userId, clubId, type, title, message, link });
    } catch {
      // Socket.IO puede no estar inicializado (p.ej. en scripts/tests) — no es crítico.
    }
    return id;
  }

  /**
   * Envía una notificación a los miembros de un club (broadcast administrativo). Los
   * destinatarios se arman combinando (unión, sin duplicados) hasta tres criterios —
   * "todos", una lista de roles, y una lista de usuarios puntuales — se puede usar
   * cualquier combinación de los tres (ej. todo el rol "Socios" + un jugador puntual).
   * Siempre acotado a miembros ACTIVOS de ese club — incluye al remitente si él mismo
   * queda dentro de los criterios elegidos (ej. está en el rol seleccionado).
   */
  async broadcastToClub(clubId, { type, title, message, link, targetAll, roleIds, userIds }) {
    const userIdsToNotify = await this._resolveBroadcastRecipients(clubId, { targetAll, roleIds, userIds });
    await Promise.all(
      userIdsToNotify.map((id) => this.notifyUser({ userId: id, clubId, type, title, message, link }))
    );
    return userIdsToNotify.length;
  }

  async _resolveBroadcastRecipients(clubId, { targetAll, roleIds, userIds }) {
    const conditions = [];
    const params = [];

    if (targetAll) {
      conditions.push('1 = 1');
    }
    if (Array.isArray(roleIds) && roleIds.length) {
      conditions.push('uc.user_id IN (SELECT ur.user_id FROM user_roles ur WHERE ur.club_id = ? AND ur.role_id IN (?))');
      params.push(clubId, roleIds);
    }
    if (Array.isArray(userIds) && userIds.length) {
      conditions.push('uc.user_id IN (?)');
      params.push(userIds);
    }
    // Sin ningún criterio no hay a quién notificar — la validación de la ruta ya exige
    // al menos uno, esto es solo para no mandar una query con un WHERE (...) vacío.
    if (conditions.length === 0) return [];

    const [rows] = await pool.query(
      `SELECT DISTINCT uc.user_id FROM user_clubs uc
       WHERE uc.club_id = ? AND uc.status = 'active' AND (${conditions.join(' OR ')})`,
      [clubId, ...params]
    );
    return rows.map((r) => r.user_id);
  }
}

module.exports = new NotificationsService();
