const membersRepository = require('../repositories/members.repository');
const clubsRepository = require('../repositories/clubs.repository');
const usersRepository = require('../repositories/users.repository');
const userSettingsRepository = require('../repositories/userSettings.repository');
const settingsRepository = require('../repositories/settings.repository');
const memberGroupsRepository = require('../repositories/memberGroups.repository');
const auditRepository = require('../repositories/audit.repository');
const { toAbsoluteMediaUrl } = require('../helpers/mediaUrl');
const permissionService = require('./permission.service');
const membersService = require('./members.service');
const notificationsService = require('./notifications.service');
const { renderBirthdayTemplateToBuffer, saveBirthdayNotificationImage } = require('../utils/birthdayTemplateRenderer');
const AppError = require('../helpers/AppError');
const logger = require('../helpers/logger');
const { FUNCTIONS, USER_CLUB_STATUS, NOTIFICATION_TYPE } = require('../config/constants');

/**
 * Preferencia por usuario y club (user_settings) — si recibe la notificación de cumpleaños:
 *  - `reminders`: uno o varios avisos, cada uno con su anticipación (0 = el mismo día) y su hora
 *    (p. ej. 1 semana antes a las 09:00 y el mismo día a las 08:00 y a las 20:00);
 *  - `groupIds` / `noGroup`: solo los cumpleaños de esos grupos y/o de quienes no tienen grupo
 *    (ninguno de los dos = todos los que puede ver);
 *  - `assignedBy`: la configuró otra persona del club (MANAGE_BIRTHDAY_NOTIFICATIONS). Así le
 *    llega aunque no tenga acceso a Miembros (ve los cumpleaños de los grupos elegidos).
 * Crea una notificación en la app, que además dispara push y correo con el mismo contenido (ver
 * notifications.service.js#notifyUser).
 */
const SETTING_KEY = 'birthday_notification';
/** Día (local) del último envío de cada aviso a ese usuario/club: `{ "<días>@<hora>": "YYYY-MM-DD" }`
 * (antes, un día en texto plano: el del único aviso). Evita repetir un aviso el mismo día. */
const LAST_SENT_KEY = 'birthday_notification_last';
const DEFAULT_REMINDER = { daysBefore: 0, sendTime: '08:00' };
const MAX_REMINDERS = 6;
const SEND_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const reminderKey = (r) => `${r.daysBefore}@${r.sendTime}`;
const defaultSettings = () => ({ enabled: false, reminders: [{ ...DEFAULT_REMINDER }], groupIds: [], noGroup: false, assignedBy: null });

/** Fecha "YYYY-MM-DD" y hora "HH:mm" actuales en una zona horaria. */
function nowIn(timezone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
const VIEW_FUNCTIONS = [FUNCTIONS.VIEW_MEMBERS, FUNCTIONS.VIEW_MEMBERS_SCOPED];

/** Plantilla de diseño (club_settings), una por club y por formato — ver
 * core/utils/birthday-template.util.ts (frontend) para el renderer que consume esto. Solo existe
 * "historia" (se eliminó "post" a pedido explícito); se deja como lista de todos modos para no
 * tener que retocar la validación si algún día se agrega otro formato. */
const TEMPLATE_FORMATS = ['story'];
const TEMPLATE_ELEMENT_TYPES = ['image', 'text', 'photo', 'shape'];
const TEXT_VARIANTS = ['static', 'name', 'age', 'date'];
const TEXT_ALIGNS = ['left', 'center', 'right'];
const TEXT_WEIGHTS = [400, 600, 700, 800];
const SHAPE_FILL_TYPES = ['solid', 'gradient'];
const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function minutesBetween(from, to) {
  const [fh, fm] = from.split(':').map(Number);
  const [th, tm] = to.split(':').map(Number);
  return th * 60 + tm - (fh * 60 + fm);
}

function templateSettingKey(format) {
  return `birthday_template_${format}`;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function sanitizeColor(value, fallback) {
  return typeof value === 'string' && HEX_COLOR_RE.test(value.trim()) ? value.trim() : fallback;
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

class BirthdaysService {
  /** Avisos válidos, sin repetidos, en el orden en que se agregaron (máx. MAX_REMINDERS). */
  _normalizeReminders(list) {
    const seen = new Map();
    for (const r of Array.isArray(list) ? list : []) {
      const reminder = {
        daysBefore: Math.min(Math.max(Math.trunc(Number(r?.daysBefore)) || 0, 0), 30),
        sendTime: SEND_TIME_RE.test(r?.sendTime) ? r.sendTime : DEFAULT_REMINDER.sendTime,
      };
      seen.set(reminderKey(reminder), reminder);
    }
    const out = [...seen.values()].slice(0, MAX_REMINDERS);
    return out.length ? out : [{ ...DEFAULT_REMINDER }];
  }

  /** Lo guardado (o el formato viejo: un solo aviso con `daysBefore`/`sendTime` sueltos). */
  _parseSettings(raw) {
    if (!raw) return defaultSettings();
    try {
      const parsed = JSON.parse(raw);
      const reminders = Array.isArray(parsed.reminders) ? parsed.reminders : [{ daysBefore: parsed.daysBefore, sendTime: parsed.sendTime }];
      return {
        enabled: !!parsed.enabled,
        reminders: this._normalizeReminders(reminders),
        groupIds: Array.isArray(parsed.groupIds) ? parsed.groupIds.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [],
        noGroup: !!parsed.noGroup,
        assignedBy: Number(parsed.assignedBy) || null,
      };
    } catch {
      return defaultSettings();
    }
  }

  /** Ajustes que llegan del cliente sobre los actuales (`base`); los grupos deben ser del club. */
  async _settingsFromBody(clubId, body, base) {
    const out = { ...base };
    if (body.enabled !== undefined) out.enabled = !!body.enabled;
    if (body.reminders !== undefined) out.reminders = this._normalizeReminders(body.reminders);
    if (body.groupIds !== undefined) {
      const wanted = [...new Set((Array.isArray(body.groupIds) ? body.groupIds : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
      const valid = wanted.length ? await memberGroupsRepository.findByIds(wanted, clubId) : [];
      if (valid.length !== wanted.length) throw AppError.badRequest('Uno o más grupos no pertenecen a este club.');
      out.groupIds = wanted;
    }
    if (body.noGroup !== undefined) out.noGroup = !!body.noGroup;
    return out;
  }

  async _readSettings(userId, clubId) {
    const all = await userSettingsRepository.findAllForUser(userId, clubId);
    return this._parseSettings(all[SETTING_KEY]);
  }

  async _saveSettings(userId, clubId, settings) {
    await userSettingsRepository.upsertMany(userId, clubId, { [SETTING_KEY]: JSON.stringify(settings) });
  }

  /** Puede ver la lista de cumpleaños del club (Miembros). */
  async _canView(userId, clubId) {
    const authContext = await permissionService.buildAuthorizationContext(userId, clubId);
    return permissionService.hasAnyFunction(authContext, VIEW_FUNCTIONS);
  }

  async _settingsDto(clubId, userId, settings) {
    const assigner = settings.assignedBy ? await usersRepository.findById(settings.assignedBy) : null;
    // Nombre de los grupos elegidos: quien no ve Miembros no puede pedir la lista de grupos.
    const groups = settings.groupIds.length ? (await memberGroupsRepository.findOptions(clubId)).filter((g) => settings.groupIds.includes(g.id)) : [];
    return { ...settings, groups, assignedByUsername: assigner?.username ?? null, canView: await this._canView(userId, clubId) };
  }

  async getMySettings(userId, clubId) {
    return this._settingsDto(clubId, userId, await this._readSettings(userId, clubId));
  }

  /**
   * Cambia los ajustes propios. Quien puede ver Miembros los maneja completos (y pasan a ser
   * suyos). Quien no, solo la tiene si se la asignaron: puede apagarla o cambiar sus horarios,
   * pero no los grupos (eso lo decidió quien se la asignó).
   */
  async updateMySettings(userId, clubId, body) {
    const current = await this._readSettings(userId, clubId);
    let next;
    if (await this._canView(userId, clubId)) {
      next = { ...(await this._settingsFromBody(clubId, body, current)), assignedBy: null };
    } else {
      if (!current.assignedBy) throw AppError.forbidden('No tienes acceso a los cumpleaños del club.');
      next = await this._settingsFromBody(clubId, { enabled: body.enabled, reminders: body.reminders }, current);
    }
    await this._saveSettings(userId, clubId, next);
    return this._settingsDto(clubId, userId, next);
  }

  // ---------------------------------------------------------------- asignar a otros usuarios

  /** Usuarios activos del club con su notificación de cumpleaños (para asignarla). */
  async listAssignments(clubId) {
    const [users, rows] = await Promise.all([usersRepository.findActiveClubUsers(clubId), userSettingsRepository.findAllByKey(SETTING_KEY)]);
    const byUser = new Map(rows.filter((r) => r.club_id === clubId).map((r) => [r.user_id, this._parseSettings(r.setting_value)]));
    const usernames = new Map(users.map((u) => [u.id, u.username]));
    return Promise.all(
      users.map(async (u) => {
        const settings = byUser.get(u.id) ?? defaultSettings();
        return {
          userId: u.id,
          username: u.username,
          email: u.email,
          avatarUrl: toAbsoluteMediaUrl(u.avatar_url),
          canView: await this._canView(u.id, clubId),
          settings: { ...settings, assignedByUsername: settings.assignedBy ? usernames.get(settings.assignedBy) ?? null : null },
        };
      })
    );
  }

  /** Configura la notificación de OTRO usuario activo del club: le llega con lo que se eligió acá. */
  async updateForUser(clubId, targetUserId, body, actorId) {
    const membership = await usersRepository.findMembership(targetUserId, clubId);
    if (!membership || membership.status !== USER_CLUB_STATUS.ACTIVE) throw AppError.notFound('Usuario no encontrado en este club.');
    const current = await this._readSettings(targetUserId, clubId);
    const next = { ...(await this._settingsFromBody(clubId, body, current)), assignedBy: actorId };
    await this._saveSettings(targetUserId, clubId, next);
    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'BIRTHDAY_NOTIFICATION_ASSIGNED',
      entityType: 'user',
      entityId: targetUserId,
      changes: { enabled: next.enabled, reminders: next.reminders.map(reminderKey), groupIds: next.groupIds, noGroup: next.noGroup },
    });
    return this._settingsDto(clubId, targetUserId, next);
  }

  // ---------------------------------------------------------------- plantilla (club_settings)

  /** Valida/normaliza un elemento del diseño — nunca confía en lo que llega del cliente, ya que
   * se guarda tal cual y se vuelve a servir a cualquiera con VIEW_MEMBERS/_SCOPED. Un elemento
   * que no calza con ningún tipo conocido se descarta en vez de guardarse a medias. */
  /** Opacidad y difuminado a transparente de la propia imagen (imágenes subidas y foto del socio). */
  _fadeOptions(el) {
    return {
      opacity: clampNumber(el.opacity, 0, 100, 100),
      fadeEnabled: !!el.fadeEnabled,
      fadeType: el.fadeType === 'radial' ? 'radial' : 'linear',
      fadeAngle: clampNumber(el.fadeAngle, 0, 359, 180),
      fadeStart: clampNumber(el.fadeStart, 0, 100, 50),
      fadeEnd: clampNumber(el.fadeEnd, 0, 100, 100),
    };
  }

  _sanitizeElement(el, index) {
    if (!el || !TEMPLATE_ELEMENT_TYPES.includes(el.type)) return null;
    const base = {
      id: typeof el.id === 'string' && el.id ? el.id.slice(0, 64) : `el-${index}`,
      zIndex: clampNumber(el.zIndex, 0, 1000, index),
      x: clampNumber(el.x, -5000, 5000, 0),
      y: clampNumber(el.y, -5000, 5000, 0),
      width: clampNumber(el.width, 1, 5000, 100),
      height: clampNumber(el.height, 1, 5000, 100),
      rotation: clampNumber(el.rotation, -360, 360, 0),
      ...(typeof el.name === 'string' && el.name.trim() ? { name: el.name.trim().slice(0, 80) } : {}),
      ...(el.locked ? { locked: true } : {}),
    };
    if (el.type === 'image') {
      if (typeof el.url !== 'string' || !el.url.trim()) return null;
      return {
        ...base,
        type: 'image',
        url: el.url.trim().slice(0, 500),
        lockAspectRatio: !!el.lockAspectRatio,
        ...this._fadeOptions(el),
      };
    }
    if (el.type === 'text') {
      return {
        ...base,
        type: 'text',
        variant: TEXT_VARIANTS.includes(el.variant) ? el.variant : 'static',
        content: typeof el.content === 'string' ? el.content.slice(0, 200) : '',
        fontFamily: typeof el.fontFamily === 'string' && el.fontFamily.trim() ? el.fontFamily.trim().slice(0, 80) : 'sans-serif',
        fontSize: clampNumber(el.fontSize, 1, 400, 48),
        fontWeight: TEXT_WEIGHTS.includes(Number(el.fontWeight)) ? Number(el.fontWeight) : 700,
        color: sanitizeColor(el.color, '#16151f'),
        align: TEXT_ALIGNS.includes(el.align) ? el.align : 'center',
      };
    }
    if (el.type === 'shape') {
      return {
        ...base,
        type: 'shape',
        ...(el.shapeKind === 'circle' ? { shapeKind: 'circle' } : {}),
        fillType: SHAPE_FILL_TYPES.includes(el.fillType) ? el.fillType : 'solid',
        color: sanitizeColor(el.color, '#4F46E5'),
        gradientColor: sanitizeColor(el.gradientColor, '#7C3AED'),
        // Degradado: lineal (ángulo CSS) o radial; inicio/fin en %; segundo color transparente
        // (difuminado); opacidad de toda la forma.
        gradientType: el.gradientType === 'radial' ? 'radial' : 'linear',
        gradientAngle: clampNumber(el.gradientAngle, 0, 359, 135),
        gradientStart: clampNumber(el.gradientStart, 0, 100, 0),
        gradientEnd: clampNumber(el.gradientEnd, 0, 100, 100),
        gradientToTransparent: !!el.gradientToTransparent,
        opacity: clampNumber(el.opacity, 0, 100, 100),
      };
    }
    // 'photo': rectangular siempre, relación de aspecto bloqueada y sin recorte — no lleva
    // campos propios más allá de la posición/tamaño/rotación base.
    return { ...base, type: 'photo', ...this._fadeOptions(el) };
  }

  _sanitizeTemplate(format, design) {
    const elements = Array.isArray(design.elements)
      ? design.elements.map((el, i) => this._sanitizeElement(el, i)).filter(Boolean)
      : [];
    return { format, elements };
  }

  async getTemplate(clubId, format) {
    if (!TEMPLATE_FORMATS.includes(format)) throw AppError.badRequest('Formato de plantilla inválido.');
    const settings = await settingsRepository.findAllByClub(clubId);
    const raw = settings[templateSettingKey(format)];
    if (!raw) return null;
    try {
      return this._sanitizeTemplate(format, JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async saveTemplate(clubId, format, design) {
    if (!TEMPLATE_FORMATS.includes(format)) throw AppError.badRequest('Formato de plantilla inválido.');
    if (!design || typeof design !== 'object') throw AppError.badRequest('Diseño de plantilla inválido.');
    const sanitized = this._sanitizeTemplate(format, design);
    await settingsRepository.upsertMany(clubId, { [templateSettingKey(format)]: JSON.stringify(sanitized) });
    return sanitized;
  }

  /** Edad que cumple en la próxima celebración (`daysUntil` días desde `today`, 'YYYY-MM-DD'). */
  _turningAge(birthDate, daysUntil, today = null) {
    const target = today ? new Date(`${today}T00:00:00Z`) : new Date();
    target.setUTCDate(target.getUTCDate() + daysUntil);
    return target.getUTCFullYear() - new Date(birthDate).getUTCFullYear();
  }

  _fullNameOf(m) {
    return [m.first_name, m.middle_name, m.last_name, m.second_last_name].filter(Boolean).join(' ');
  }

  _dateLabel(birthDate) {
    const date = new Date(birthDate);
    return `${date.getUTCDate()} de ${MONTHS[date.getUTCMonth()]}`;
  }

  /** Compone la imagen de la plantilla de cumpleaños del club (si tiene una diseñada, ver
   * getTemplate/saveTemplate) con los datos reales de `member` — devuelve la ruta relativa
   * ("/uploads/birthday-notifications/...") para adjuntarla a la notificación/correo, o `null`
   * si el club todavía no diseñó ninguna plantilla (no hay nada que componer). Nunca lanza: un
   * error al generar la imagen no debe impedir que la notificación de todos modos se envíe (sin
   * imagen) — ver _notifyBirthdays. */
  async _generateBirthdayImage(clubId, member, daysUntil, today = null) {
    try {
      const template = await this.getTemplate(clubId, 'story');
      if (!template || !template.elements.length) return null;
      const data = {
        name: this._fullNameOf(member),
        age: this._turningAge(member.birth_date, daysUntil, today),
        dateLabel: this._dateLabel(member.birth_date),
        photoUrl: member.birthday_photo_url || null,
      };
      const buffer = await renderBirthdayTemplateToBuffer(template, data);
      return saveBirthdayNotificationImage(buffer);
    } catch (error) {
      logger.error('[birthdays] Error generando imagen de plantilla', { clubId, memberId: member.id, error: error.message });
      return null;
    }
  }

  /**
   * Crea una notificación (con la imagen de la plantilla adjunta si el club tiene una diseñada)
   * por cada cumpleaños de `daysUntilMin`..`daysUntilMax` días desde hoy que le corresponden a
   * `userId`: los que puede ver (su alcance de miembros) o, si no tiene acceso a Miembros pero se
   * la asignaron, todos los del club; en ambos casos solo de los grupos elegidos en `settings`.
   * Devuelve cuántas creó. `imageCache` es opcional — un Map compartido entre varios usuarios del
   * mismo club (ver sendDailyDigests) para no recomponer la misma imagen una vez por cada uno.
   * `today` ('YYYY-MM-DD'): el día en la zona horaria de quien recibe (ver _todayFor).
   */
  async _notifyBirthdays({ userId, clubId, daysUntilMin, daysUntilMax, imageCache, settings, today }) {
    const club = await clubsRepository.findActiveById(clubId);
    const user = await usersRepository.findById(userId);
    if (!club || !user) return 0;

    const authContext = await permissionService.buildAuthorizationContext(userId, clubId);
    const canView = permissionService.hasAnyFunction(authContext, VIEW_FUNCTIONS);
    if (!canView && !settings?.assignedBy) return 0;
    // Asignada por otra persona: los cumpleaños de los grupos que esa persona eligió, aunque su
    // propio acceso a Miembros sea acotado (VIEW_MEMBERS_SCOPED) o no tenga.
    const access = canView && !settings?.assignedBy ? await membersService.resolveAccessForController(authContext, userId, clubId) : { full: true };
    const groupFilter = settings ? { groupIds: settings.groupIds, noGroup: settings.noGroup } : null;

    const rows = (await membersRepository.findUpcomingBirthdays(clubId, daysUntilMax, access.full ? null : access.memberIds, { groupFilter, today })).filter(
      (m) => Number(m.days_until) >= daysUntilMin
    );
    if (!rows.length) return 0;

    for (const m of rows) {
      const days = Number(m.days_until);
      const name = this._fullNameOf(m);
      const when = days === 0 ? 'hoy' : days === 1 ? 'mañana' : `en ${days} días`;
      const age = this._turningAge(m.birth_date, days, today);
      const title = `🎂 Cumpleaños de ${name}`;
      const message = `Recuerda que el cumpleaños de ${name} es ${when} (${this._dateLabel(m.birth_date)})${
        age !== null ? `, cumple ${age} años` : ''
      }.`;

      const cacheKey = `${clubId}:${m.id}`;
      let imageUrl = imageCache?.get(cacheKey);
      if (imageUrl === undefined) {
        // eslint-disable-next-line no-await-in-loop -- una plantilla a la vez, ver comentario de más abajo.
        imageUrl = await this._generateBirthdayImage(clubId, m, days, today);
        imageCache?.set(cacheKey, imageUrl);
      }

      // eslint-disable-next-line no-await-in-loop -- notifyUser dispara el correo sin esperarlo
      // (best-effort); lo que sí se espera acá es solo la inserción/push de la notificación.
      await notificationsService.notifyUser({
        userId,
        clubId,
        type: NOTIFICATION_TYPE.BIRTHDAY,
        category: 'birthday',
        title,
        message,
        // Sin acceso a Miembros la lista de cumpleaños no se le abre: la notificación queda sola.
        link: canView ? '/members/birthdays' : null,
        imageUrl,
      });
    }
    return rows.length;
  }

  /** "Enviarme ahora": notifica al propio usuario los cumpleaños de los próximos `days` días (de
   * los grupos que eligió). */
  async sendMeNow(userId, clubId, days = 7) {
    const count = await this._notifyBirthdays({
      today: await this._todayFor(userId, clubId),
      userId,
      clubId,
      daysUntilMin: 0,
      daysUntilMax: Math.min(Math.max(Number(days) || 7, 0), 60),
      imageCache: new Map(),
      settings: await this._readSettings(userId, clubId),
    });
    if (count === 0) throw AppError.conflict('No hay cumpleaños en ese período — no se envió ninguna notificación.');
    return { sent: count };
  }

  /** Hoy ('YYYY-MM-DD') en la zona horaria del usuario, o si no la del club. */
  async _todayFor(userId, clubId) {
    const [user, club] = await Promise.all([usersRepository.findById(userId), clubsRepository.findActiveById(clubId)]);
    return nowIn(user?.timezone || club?.timezone || 'UTC').date;
  }

  /** Último envío de cada aviso (`{ clave: día }`). El formato viejo (un día suelto) era del único aviso. */
  _parseLastSent(raw, settings) {
    if (!raw) return {};
    if (raw.startsWith('{')) {
      try {
        return JSON.parse(raw) || {};
      } catch {
        return {};
      }
    }
    return { [reminderKey(settings.reminders[0])]: raw };
  }

  /** Cron (cada pocos minutos): a cada usuario suscrito le llega cada uno de sus avisos UNA vez al
   * día, a partir de la hora de ese aviso (en su zona horaria o si no la del club), por el/los
   * cumpleaños que caen exactamente en los días de anticipación de ese aviso (0 = hoy). Si el
   * servidor estuvo caído a esa hora, se envía en la primera pasada después (en vez de saltarse
   * el día). */
  async sendDailyDigests() {
    const subscriptions = await userSettingsRepository.findAllByKey(SETTING_KEY);
    const lastSentRows = await userSettingsRepository.findAllByKey(LAST_SENT_KEY);
    const lastSentRaw = new Map(lastSentRows.map((r) => [`${r.user_id}:${r.club_id}`, r.setting_value]));
    const tzCache = new Map();
    const timezoneFor = async (userId, clubId) => {
      const key = `${userId}:${clubId}`;
      if (!tzCache.has(key)) {
        const [user, club] = await Promise.all([usersRepository.findById(userId), clubsRepository.findActiveById(clubId)]);
        tzCache.set(key, user?.timezone || club?.timezone || 'UTC');
      }
      return tzCache.get(key);
    };
    let sent = 0;
    // Compartido entre todos los suscriptores de este run: varios usuarios del mismo club ven
    // (parte de) los mismos cumpleaños, no tiene sentido componer la misma imagen una vez por
    // cada uno.
    const imageCache = new Map();
    for (const sub of subscriptions) {
      const settings = this._parseSettings(sub.setting_value);
      if (!settings.enabled) continue;
      // eslint-disable-next-line no-await-in-loop
      const local = nowIn(await timezoneFor(sub.user_id, sub.club_id));
      const subKey = `${sub.user_id}:${sub.club_id}`;
      const lastSent = this._parseLastSent(lastSentRaw.get(subKey), settings);
      const due = settings.reminders.filter((r) => local.time >= r.sendTime && lastSent[reminderKey(r)] !== local.date);
      if (!due.length) continue;

      // Solo miembros activos del club: un usuario retirado/suspendido deja de recibir la notificación.
      // eslint-disable-next-line no-await-in-loop
      const membership = await usersRepository.findMembership(sub.user_id, sub.club_id);
      if (!membership || membership.status !== USER_CLUB_STATUS.ACTIVE) continue;

      for (const reminder of due) {
        const key = reminderKey(reminder);
        // Aviso recién agregado (sin registro) cuya hora de hoy pasó hace rato: se da el día por
        // enviado en vez de mandar ahora un aviso a destiempo (antes de llevar este registro el
        // envío era fijo a las 08:00 y tampoco se guardaba).
        if (!(key in lastSent) && minutesBetween(reminder.sendTime, local.time) > 60) {
          lastSent[key] = local.date;
          continue;
        }
        try {
          // eslint-disable-next-line no-await-in-loop
          sent += await this._notifyBirthdays({
            userId: sub.user_id,
            clubId: sub.club_id,
            daysUntilMin: reminder.daysBefore,
            daysUntilMax: reminder.daysBefore,
            imageCache,
            settings,
            today: local.date,
          });
          lastSent[key] = local.date;
        } catch (error) {
          logger.error('[cron] Error enviando notificaciones de cumpleaños', { userId: sub.user_id, clubId: sub.club_id, error: error.message });
        }
      }
      // Solo se guardan los avisos que siguen configurados.
      const keep = Object.fromEntries(settings.reminders.map(reminderKey).filter((k) => lastSent[k]).map((k) => [k, lastSent[k]]));
      // eslint-disable-next-line no-await-in-loop
      await userSettingsRepository.upsertMany(sub.user_id, sub.club_id, { [LAST_SENT_KEY]: JSON.stringify(keep) });
    }
    return sent;
  }
}

module.exports = new BirthdaysService();
