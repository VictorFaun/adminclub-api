const BaseRepository = require('./BaseRepository');
const { pool } = require('../config/database');

/** Eventos del calendario y sus participantes (ver calendar.service.js). */
class CalendarEventsRepository extends BaseRepository {
  constructor() {
    super('calendar_events');
  }

  /** Eventos que el usuario ve en el club (los suyos y los que le compartieron) que se cruzan con
   * el rango de fechas [from, to]. */
  async findVisibleInRange(clubId, userId, from, to, conn = pool) {
    const [rows] = await conn.query(
      `SELECT e.*, u.username AS creator_username, u.avatar_url AS creator_avatar_url
       FROM calendar_events e
       INNER JOIN users u ON u.id = e.created_by
       WHERE e.club_id = ? AND e.start_date <= ? AND e.end_date >= ?
         AND (e.created_by = ? OR EXISTS (SELECT 1 FROM calendar_event_participants p WHERE p.event_id = e.id AND p.user_id = ?))
       ORDER BY e.start_date ASC, e.all_day DESC, e.start_time ASC`,
      [clubId, to, from, userId, userId]
    );
    return rows;
  }

  async findParticipants(eventIds, conn = pool) {
    if (!eventIds.length) return [];
    const [rows] = await conn.query(
      `SELECT p.event_id, u.id, u.username, u.avatar_url
       FROM calendar_event_participants p INNER JOIN users u ON u.id = p.user_id
       WHERE p.event_id IN (?) ORDER BY u.username ASC`,
      [eventIds]
    );
    return rows;
  }

  async isParticipant(eventId, userId, conn = pool) {
    const [rows] = await conn.query('SELECT 1 FROM calendar_event_participants WHERE event_id = ? AND user_id = ? LIMIT 1', [eventId, userId]);
    return rows.length > 0;
  }

  async create(data, conn = pool) {
    const [result] = await conn.query(
      `INSERT INTO calendar_events (club_id, created_by, title, description, color, all_day, start_date, end_date, start_time, end_time, reminder_minutes, remind_at)
       VALUES (:clubId, :createdBy, :title, :description, :color, :allDay, :startDate, :endDate, :startTime, :endTime, :reminderMinutes, :remindAt)`,
      data
    );
    return result.insertId;
  }

  /** Reemplaza la lista de participantes; devuelve los ids que se agregaron (para avisarles). */
  async setParticipants(eventId, userIds, conn = pool) {
    const [current] = await conn.query('SELECT user_id FROM calendar_event_participants WHERE event_id = ?', [eventId]);
    const before = new Set(current.map((r) => r.user_id));
    const next = new Set(userIds);
    const removed = [...before].filter((id) => !next.has(id));
    const added = [...next].filter((id) => !before.has(id));
    if (removed.length) await conn.query('DELETE FROM calendar_event_participants WHERE event_id = ? AND user_id IN (?)', [eventId, removed]);
    if (added.length) await conn.query('INSERT INTO calendar_event_participants (event_id, user_id) VALUES ?', [added.map((id) => [eventId, id])]);
    return added;
  }

  async removeParticipant(eventId, userId, conn = pool) {
    const [result] = await conn.query('DELETE FROM calendar_event_participants WHERE event_id = ? AND user_id = ?', [eventId, userId]);
    return result.affectedRows > 0;
  }

  /** Recordatorios vencidos sin enviar (los de hace más de un día se descartan: un aviso tan
   * atrasado, p. ej. tras una caída larga del servidor, ya no sirve). */
  async findDueReminders(conn = pool) {
    const [rows] = await conn.query(
      `SELECT * FROM calendar_events
       WHERE remind_at IS NOT NULL AND reminder_sent_at IS NULL AND remind_at <= UTC_TIMESTAMP() AND remind_at > UTC_TIMESTAMP() - INTERVAL 1 DAY
       ORDER BY remind_at ASC LIMIT 500`
    );
    return rows;
  }

  /** Marca el aviso como enviado solo si nadie lo hizo antes (dos procesos a la vez). */
  async claimReminder(eventId, conn = pool) {
    const [result] = await conn.query('UPDATE calendar_events SET reminder_sent_at = UTC_TIMESTAMP() WHERE id = ? AND reminder_sent_at IS NULL', [eventId]);
    return result.affectedRows > 0;
  }

  async participantUserIds(eventId, conn = pool) {
    const [rows] = await conn.query('SELECT user_id FROM calendar_event_participants WHERE event_id = ?', [eventId]);
    return rows.map((r) => r.user_id);
  }

  /** Usuarios ACTIVOS del club (para elegir con quién compartir un evento). */
  async findClubUsers(clubId, conn = pool) {
    const [rows] = await conn.query(
      `SELECT u.id, u.username, u.avatar_url FROM user_clubs uc INNER JOIN users u ON u.id = uc.user_id
       WHERE uc.club_id = ? AND uc.status = 'active' ORDER BY u.username ASC`,
      [clubId]
    );
    return rows;
  }
}

module.exports = new CalendarEventsRepository();
