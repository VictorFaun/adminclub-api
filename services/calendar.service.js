const calendarEventsRepository = require('../repositories/calendarEvents.repository');
const membersRepository = require('../repositories/members.repository');
const trainingsRepository = require('../repositories/trainings.repository');
const usersRepository = require('../repositories/users.repository');
const auditRepository = require('../repositories/audit.repository');
const permissionService = require('./permission.service');
const membersService = require('./members.service');
const notificationsService = require('./notifications.service');
const AppError = require('../helpers/AppError');
const logger = require('../helpers/logger');
const { withTransaction } = require('../config/database');
const { toAbsoluteMediaUrl } = require('../helpers/mediaUrl');
const { FUNCTIONS } = require('../config/constants');

/** Rango máximo que se puede pedir de una vez (la vista anual pide un año completo). */
const MAX_RANGE_DAYS = 400;
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const pad = (n) => String(n).padStart(2, '0');
/** DATE de MySQL (Date a medianoche UTC o string) → "YYYY-MM-DD". */
function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}
/** TIME de MySQL ("HH:MM:SS") → "HH:MM". */
const hhmm = (value) => (value ? String(value).slice(0, 5) : null);
const parseDate = (s) => new Date(`${s}T00:00:00Z`);
/** ISO 1=lunes..7=domingo (como training_schedules.day_of_week). */
const isoDay = (d) => (d.getUTCDay() === 0 ? 7 : d.getUTCDay());

function eachDate(from, to, fn) {
  const cursor = parseDate(from);
  const end = parseDate(to);
  while (cursor <= end) {
    fn(dateOnly(cursor), cursor);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
}

/**
 * Vista Calendario: junta en un rango de fechas lo que la persona puede ver —
 *
 * - **Eventos** propios o que le compartieron (cualquiera con cuenta en el club los usa: son
 *   personales; por defecto solo para quien los crea).
 * - **Cumpleaños** de los miembros, solo con VIEW_MEMBERS/_SCOPED (y acotados a su scope).
 * - **Entrenamientos** (sesiones calculadas desde el horario semanal y los días especiales): con
 *   VIEW_TRAININGS/VIEW_ATTENDANCE todos; si no, los que entrena (responsable) o en los que
 *   participa su ficha.
 *
 * El recordatorio de un evento lo envía cron/calendarReminders.cron.js a quien lo creó y a los
 * participantes.
 */
class CalendarService {
  _assertRange(from, to) {
    if (!from || !to || from > to) throw AppError.badRequest('Rango de fechas inválido.');
    if ((parseDate(to) - parseDate(from)) / 86400000 > MAX_RANGE_DAYS) throw AppError.badRequest('El rango pedido es demasiado largo.');
  }

  async getFeed(clubId, userId, authContext, { from, to }) {
    this._assertRange(from, to);
    const canBirthdays = permissionService.hasAnyFunction(authContext, [FUNCTIONS.VIEW_MEMBERS, FUNCTIONS.VIEW_MEMBERS_SCOPED]);
    const [events, birthdays, trainings] = await Promise.all([
      this._events(clubId, userId, from, to),
      canBirthdays ? this._birthdays(clubId, userId, authContext, from, to) : null,
      this._trainings(clubId, userId, authContext, from, to),
    ]);
    return {
      events,
      birthdays: birthdays ?? [],
      trainings: trainings ?? [],
      // Qué fuentes aplican a esta persona (para mostrar/ocultar sus filtros en la vista).
      sources: { birthdays: canBirthdays, trainings: trainings !== null },
    };
  }

  // ------------------------------------------------------------------ eventos

  _eventDto(row, participants, userId) {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      color: row.color,
      allDay: !!row.all_day,
      startDate: dateOnly(row.start_date),
      endDate: dateOnly(row.end_date),
      startTime: hhmm(row.start_time),
      endTime: hhmm(row.end_time),
      reminderMinutes: row.reminder_minutes,
      isOwner: row.created_by === userId,
      owner: { id: row.created_by, username: row.creator_username ?? null, avatarUrl: toAbsoluteMediaUrl(row.creator_avatar_url) },
      participants: participants.map((p) => ({ id: p.id, username: p.username, avatarUrl: toAbsoluteMediaUrl(p.avatar_url) })),
    };
  }

  async _events(clubId, userId, from, to) {
    const rows = await calendarEventsRepository.findVisibleInRange(clubId, userId, from, to);
    const participants = await calendarEventsRepository.findParticipants(rows.map((r) => r.id));
    return rows.map((r) =>
      this._eventDto(
        r,
        participants.filter((p) => p.event_id === r.id),
        userId
      )
    );
  }

  async getEvent(clubId, userId, eventId) {
    const row = await calendarEventsRepository.findById(eventId);
    if (!row || row.club_id !== clubId) throw AppError.notFound('Evento no encontrado.');
    if (row.created_by !== userId && !(await calendarEventsRepository.isParticipant(eventId, userId))) throw AppError.notFound('Evento no encontrado.');
    const creator = await usersRepository.findById(row.created_by);
    const participants = await calendarEventsRepository.findParticipants([row.id]);
    return this._eventDto({ ...row, creator_username: creator?.username, creator_avatar_url: creator?.avatar_url }, participants, userId);
  }

  /** Solo usuarios ACTIVOS del club (nunca quien crea, que ya lo ve). */
  async _validParticipantIds(clubId, userId, ids) {
    const wanted = [...new Set((ids || []).map(Number).filter(Boolean))].filter((id) => id !== userId);
    if (!wanted.length) return [];
    const valid = new Set((await calendarEventsRepository.findClubUsers(clubId)).map((u) => u.id));
    if (wanted.some((id) => !valid.has(id))) throw AppError.badRequest('Solo puedes compartir el evento con usuarios activos del club.');
    return wanted;
  }

  _normalize(data) {
    const allDay = !!data.allDay;
    const startDate = data.startDate;
    const endDate = data.endDate && data.endDate >= startDate ? data.endDate : startDate;
    const startTime = allDay ? null : data.startTime || null;
    let endTime = allDay ? null : data.endTime || null;
    if (!allDay && !startTime) throw AppError.badRequest('Indica la hora de inicio, o marca el evento como de todo el día.');
    if (!allDay && endTime && startDate === endDate && endTime <= startTime) throw AppError.badRequest('La hora de término debe ser posterior a la de inicio.');
    const reminderMinutes = data.reminderMinutes === null || data.reminderMinutes === undefined || data.reminderMinutes === '' ? null : Number(data.reminderMinutes);
    // El instante del aviso lo calcula el cliente (conoce la zona horaria de quien lo eligió).
    const remindAt = reminderMinutes !== null && data.remindAt ? new Date(data.remindAt) : null;
    if (remindAt && Number.isNaN(remindAt.getTime())) throw AppError.badRequest('Recordatorio inválido.');
    if (!allDay && endTime === '') endTime = null;
    return {
      title: String(data.title).trim(),
      description: data.description ? String(data.description).trim() || null : null,
      color: data.color || null,
      allDay: allDay ? 1 : 0,
      startDate,
      endDate,
      startTime,
      endTime,
      reminderMinutes: remindAt ? reminderMinutes : null,
      remindAt,
    };
  }

  async create(clubId, userId, data) {
    const fields = this._normalize(data);
    const participantIds = await this._validParticipantIds(clubId, userId, data.participantIds);
    let added = [];
    const id = await withTransaction(async (conn) => {
      const eventId = await calendarEventsRepository.create({ clubId, createdBy: userId, ...fields }, conn);
      added = await calendarEventsRepository.setParticipants(eventId, participantIds, conn);
      return eventId;
    });
    await auditRepository.logAction({ userId, clubId, action: 'CALENDAR_EVENT_CREATED', entityType: 'calendar_event', entityId: id, changes: { title: fields.title } });
    this._notifyShared(clubId, userId, id, fields, added);
    return this.getEvent(clubId, userId, id);
  }

  async _ownEvent(clubId, userId, eventId) {
    const row = await calendarEventsRepository.findById(eventId);
    if (!row || row.club_id !== clubId) throw AppError.notFound('Evento no encontrado.');
    if (row.created_by !== userId) throw AppError.forbidden('Solo quien creó el evento puede modificarlo.');
    return row;
  }

  async update(clubId, userId, eventId, data) {
    const row = await this._ownEvent(clubId, userId, eventId);
    const fields = this._normalize(data);
    const participantIds = await this._validParticipantIds(clubId, userId, data.participantIds);
    const remindBefore = row.remind_at ? new Date(row.remind_at).getTime() : null;
    const remindChanged = remindBefore !== (fields.remindAt ? fields.remindAt.getTime() : null);
    let added = [];
    await withTransaction(async (conn) => {
      await calendarEventsRepository.updateById(
        eventId,
        {
          title: fields.title,
          description: fields.description,
          color: fields.color,
          all_day: fields.allDay,
          start_date: fields.startDate,
          end_date: fields.endDate,
          start_time: fields.startTime,
          end_time: fields.endTime,
          reminder_minutes: fields.reminderMinutes,
          remind_at: fields.remindAt,
          // Si cambió cuándo avisar, el aviso vuelve a estar pendiente.
          ...(remindChanged ? { reminder_sent_at: null } : {}),
        },
        conn
      );
      added = await calendarEventsRepository.setParticipants(eventId, participantIds, conn);
    });
    this._notifyShared(clubId, userId, eventId, fields, added);
    return this.getEvent(clubId, userId, eventId);
  }

  async remove(clubId, userId, eventId) {
    const row = await this._ownEvent(clubId, userId, eventId);
    await calendarEventsRepository.deleteById(eventId);
    await auditRepository.logAction({ userId, clubId, action: 'CALENDAR_EVENT_DELETED', entityType: 'calendar_event', entityId: eventId, changes: { title: row.title } });
  }

  /** Un participante deja de ver un evento que le compartieron. */
  async leave(clubId, userId, eventId) {
    const row = await calendarEventsRepository.findById(eventId);
    if (!row || row.club_id !== clubId || !(await calendarEventsRepository.removeParticipant(eventId, userId))) throw AppError.notFound('Evento no encontrado.');
  }

  async listShareableUsers(clubId, userId) {
    return (await calendarEventsRepository.findClubUsers(clubId))
      .filter((u) => u.id !== userId)
      .map((u) => ({ id: u.id, username: u.username, avatarUrl: toAbsoluteMediaUrl(u.avatar_url) }));
  }

  _whenLabel(fields) {
    const d = parseDate(fields.startDate);
    const day = `${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`;
    if (fields.allDay) return fields.endDate !== fields.startDate ? `desde el ${day} (todo el día)` : `el ${day} (todo el día)`;
    return `el ${day} a las ${fields.startTime}`;
  }

  /** Aviso a quienes se acaba de sumar a un evento (mejor esfuerzo). */
  async _notifyShared(clubId, userId, eventId, fields, addedIds) {
    if (!addedIds.length) return;
    try {
      const owner = await usersRepository.findById(userId);
      for (const id of addedIds) {
        // eslint-disable-next-line no-await-in-loop
        await notificationsService.notifyUser({
          userId: id,
          clubId,
          type: 'info',
          title: `📅 ${owner?.username ?? 'Alguien'} te agregó a un evento`,
          message: `«${fields.title}» ${this._whenLabel(fields)}.`,
          link: `/calendar?date=${fields.startDate}`,
        });
      }
    } catch (error) {
      logger.error('[calendar] Error avisando a participantes', { eventId, error: error.message });
    }
  }

  /** Cron: envía los recordatorios vencidos a quien creó el evento y a sus participantes. */
  async sendDueReminders() {
    const due = await calendarEventsRepository.findDueReminders();
    let sent = 0;
    for (const row of due) {
      // eslint-disable-next-line no-await-in-loop
      if (!(await calendarEventsRepository.claimReminder(row.id))) continue;
      const fields = {
        title: row.title,
        allDay: !!row.all_day,
        startDate: dateOnly(row.start_date),
        endDate: dateOnly(row.end_date),
        startTime: hhmm(row.start_time),
      };
      // eslint-disable-next-line no-await-in-loop
      const recipients = [row.created_by, ...(await calendarEventsRepository.participantUserIds(row.id))];
      for (const userId of new Set(recipients)) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await notificationsService.notifyUser({
            userId,
            clubId: row.club_id,
            type: 'info',
            title: `⏰ Recordatorio: ${row.title}`,
            message: `${row.title} es ${this._whenLabel(fields)}.${row.description ? `\n${row.description}` : ''}`,
            link: `/calendar?date=${fields.startDate}`,
          });
          sent += 1;
        } catch (error) {
          logger.error('[calendar] Error enviando recordatorio', { eventId: row.id, userId, error: error.message });
        }
      }
    }
    return sent;
  }

  // ------------------------------------------------------------------ cumpleaños

  async _birthdays(clubId, userId, authContext, from, to) {
    const access = await membersService.resolveAccessForController(authContext, userId, clubId);
    const rows = await membersRepository.findBirthDatesForCalendar(clubId, access.full ? null : access.memberIds);
    const fromYear = Number(from.slice(0, 4));
    const toYear = Number(to.slice(0, 4));
    const items = [];
    for (const m of rows) {
      const birth = dateOnly(m.birth_date);
      const [by, bm, bd] = birth.split('-').map(Number);
      for (let year = fromYear; year <= toYear; year += 1) {
        // 29 de febrero en un año no bisiesto: se celebra el 28.
        const leapFix = bm === 2 && bd === 29 && !(year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0));
        const date = `${year}-${pad(bm)}-${pad(leapFix ? 28 : bd)}`;
        if (date < from || date > to || year < by) continue;
        items.push({
          memberId: m.id,
          name: [m.first_name, m.middle_name, m.last_name, m.second_last_name].filter(Boolean).join(' ') || `Miembro #${m.id}`,
          date,
          age: year - by,
        });
      }
    }
    return items.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  }

  // ------------------------------------------------------------------ entrenamientos

  /** `null` = la persona no tiene ningún acceso a entrenamientos (la fuente no aplica). */
  async _visibleTrainings(clubId, userId, authContext) {
    if (permissionService.hasAnyFunction(authContext, [FUNCTIONS.VIEW_TRAININGS, FUNCTIONS.VIEW_ATTENDANCE])) {
      return trainingsRepository.findByClub(clubId);
    }
    const member = await membersRepository.findByUserId(userId, clubId);
    if (!member) return null;
    const all = await trainingsRepository.findByClub(clubId);
    const responsible = new Set((await trainingsRepository.findByClubResponsibleMember(clubId, member.id)).map((t) => t.id));
    const visible = [];
    for (const t of all) {
      // eslint-disable-next-line no-await-in-loop
      if (responsible.has(t.id) || (await trainingsRepository.expandTargetMemberIds(t.id)).includes(member.id)) visible.push(t);
    }
    return visible.length ? visible : null;
  }

  async _trainings(clubId, userId, authContext, from, to) {
    const trainings = await this._visibleTrainings(clubId, userId, authContext);
    if (!trainings) return null;
    const items = [];
    for (const t of trainings.filter((x) => x.status === 'active')) {
      // eslint-disable-next-line no-await-in-loop
      const [schedules, overrides] = await Promise.all([trainingsRepository.getSchedules(t.id), trainingsRepository.getSessionOverrides(t.id)]);
      const start = dateOnly(t.start_date);
      const end = t.end_date ? dateOnly(t.end_date) : null;
      const rangeFrom = start > from ? start : from;
      const rangeTo = end && end < to ? end : to;
      const byDate = new Map(overrides.map((o) => [dateOnly(o.session_date), o]));
      const base = { trainingId: t.id, name: t.name, color: t.color };
      if (rangeFrom <= rangeTo) {
        eachDate(rangeFrom, rangeTo, (date, d) => {
          const override = byDate.get(date);
          if (override?.kind === 'cancelled' || override?.kind === 'extra') return;
          for (const s of schedules.filter((x) => x.dayOfWeek === isoDay(d))) {
            const modified = override?.kind === 'modified';
            items.push({ ...base, date, startTime: hhmm(modified ? override.start_time : s.startTime), endTime: hhmm(modified ? override.end_time : s.endTime) });
          }
        });
      }
      // Días extra (fuera del horario semanal).
      for (const o of overrides.filter((x) => x.kind === 'extra')) {
        const date = dateOnly(o.session_date);
        if (date >= from && date <= to) items.push({ ...base, date, startTime: hhmm(o.start_time), endTime: hhmm(o.end_time), extra: true });
      }
    }
    return items.sort((a, b) => a.date.localeCompare(b.date) || String(a.startTime ?? '').localeCompare(String(b.startTime ?? '')));
  }
}

module.exports = new CalendarService();
