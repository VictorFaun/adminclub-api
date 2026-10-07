const membersRepository = require('../repositories/members.repository');
const clubsRepository = require('../repositories/clubs.repository');
const usersRepository = require('../repositories/users.repository');
const userSettingsRepository = require('../repositories/userSettings.repository');
const settingsRepository = require('../repositories/settings.repository');
const permissionService = require('./permission.service');
const membersService = require('./members.service');
const notificationsService = require('./notifications.service');
const { renderBirthdayTemplateToBuffer, saveBirthdayNotificationImage } = require('../utils/birthdayTemplateRenderer');
const AppError = require('../helpers/AppError');
const logger = require('../helpers/logger');
const { FUNCTIONS, USER_CLUB_STATUS, NOTIFICATION_TYPE } = require('../config/constants');

/** Preferencia por usuario y club (user_settings) — quién recibe la notificación de cumpleaños y
 * con cuántos días de anticipación (0 = el mismo día). Antes mandaba un correo directo (ver
 * historial); ahora crea una notificación en la app, que a su vez siempre dispara un correo con
 * el mismo contenido (ver notifications.service.js#notifyUser) — a pedido explícito de dejar de
 * tener un envío de correo separado solo para cumpleaños. */
const SETTING_KEY = 'birthday_notification';
/** Día (local) del último envío automático a ese usuario/club — evita repetirlo en el mismo día. */
const LAST_SENT_KEY = 'birthday_notification_last';
const DEFAULT_SETTINGS = { enabled: false, daysBefore: 0, sendTime: '08:00' };
const SEND_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

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
  _parseSettings(raw) {
    if (!raw) return { ...DEFAULT_SETTINGS };
    try {
      const parsed = JSON.parse(raw);
      return {
        enabled: !!parsed.enabled,
        daysBefore: Math.min(Math.max(Number(parsed.daysBefore) || 0, 0), 30),
        sendTime: SEND_TIME_RE.test(parsed.sendTime) ? parsed.sendTime : DEFAULT_SETTINGS.sendTime,
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  async getMySettings(userId, clubId) {
    const all = await userSettingsRepository.findAllForUser(userId, clubId);
    return this._parseSettings(all[SETTING_KEY]);
  }

  async updateMySettings(userId, clubId, { enabled, daysBefore, sendTime }) {
    const settings = {
      enabled: !!enabled,
      daysBefore: Math.min(Math.max(Number(daysBefore) || 0, 0), 30),
      sendTime: SEND_TIME_RE.test(sendTime) ? sendTime : DEFAULT_SETTINGS.sendTime,
    };
    await userSettingsRepository.upsertMany(userId, clubId, { [SETTING_KEY]: JSON.stringify(settings) });
    return settings;
  }

  // ---------------------------------------------------------------- plantilla (club_settings)

  /** Valida/normaliza un elemento del diseño — nunca confía en lo que llega del cliente, ya que
   * se guarda tal cual y se vuelve a servir a cualquiera con VIEW_MEMBERS/_SCOPED. Un elemento
   * que no calza con ningún tipo conocido se descarta en vez de guardarse a medias. */
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
    };
    if (el.type === 'image') {
      if (typeof el.url !== 'string' || !el.url.trim()) return null;
      return { ...base, type: 'image', url: el.url.trim().slice(0, 500), lockAspectRatio: !!el.lockAspectRatio };
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
    return { ...base, type: 'photo' };
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

  /** Edad que cumple en la próxima celebración (`daysUntil` días desde hoy). */
  _turningAge(birthDate, daysUntil) {
    const target = new Date();
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
  async _generateBirthdayImage(clubId, member, daysUntil) {
    try {
      const template = await this.getTemplate(clubId, 'story');
      if (!template || !template.elements.length) return null;
      const data = {
        name: this._fullNameOf(member),
        age: this._turningAge(member.birth_date, daysUntil),
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
   * por cada cumpleaños de `daysUntilMin`..`daysUntilMax` días desde hoy que `userId` puede ver
   * (respeta su alcance de miembros). Devuelve cuántas notificaciones creó. `imageCache` es
   * opcional — un Map compartido entre varios usuarios del mismo club (ver sendDailyDigests) para
   * no recomponer la misma imagen una vez por cada suscriptor.
   */
  async _notifyBirthdays({ userId, clubId, daysUntilMin, daysUntilMax, imageCache }) {
    const club = await clubsRepository.findActiveById(clubId);
    const user = await usersRepository.findById(userId);
    if (!club || !user) return 0;

    const authContext = await permissionService.buildAuthorizationContext(userId, clubId);
    if (!permissionService.hasAnyFunction(authContext, VIEW_FUNCTIONS)) return 0;
    const access = await membersService.resolveAccessForController(authContext, userId, clubId);

    const rows = (await membersRepository.findUpcomingBirthdays(clubId, daysUntilMax, access.full ? null : access.memberIds)).filter(
      (m) => Number(m.days_until) >= daysUntilMin
    );
    if (!rows.length) return 0;

    for (const m of rows) {
      const days = Number(m.days_until);
      const name = this._fullNameOf(m);
      const when = days === 0 ? 'hoy' : days === 1 ? 'mañana' : `en ${days} días`;
      const age = this._turningAge(m.birth_date, days);
      const title = `🎂 Cumpleaños de ${name}`;
      const message = `Recuerda que el cumpleaños de ${name} es ${when} (${this._dateLabel(m.birth_date)})${
        age !== null ? `, cumple ${age} años` : ''
      }.`;

      const cacheKey = `${clubId}:${m.id}`;
      let imageUrl = imageCache?.get(cacheKey);
      if (imageUrl === undefined) {
        // eslint-disable-next-line no-await-in-loop -- una plantilla a la vez, ver comentario de más abajo.
        imageUrl = await this._generateBirthdayImage(clubId, m, days);
        imageCache?.set(cacheKey, imageUrl);
      }

      // eslint-disable-next-line no-await-in-loop -- notifyUser dispara el correo sin esperarlo
      // (best-effort); lo que sí se espera acá es solo la inserción/push de la notificación.
      await notificationsService.notifyUser({
        userId,
        clubId,
        type: NOTIFICATION_TYPE.BIRTHDAY,
        title,
        message,
        link: '/members/birthdays',
        imageUrl,
      });
    }
    return rows.length;
  }

  /** "Enviarme ahora": notifica al propio usuario los cumpleaños de los próximos `days` días. */
  async sendMeNow(userId, clubId, days = 7) {
    const count = await this._notifyBirthdays({
      userId,
      clubId,
      daysUntilMin: 0,
      daysUntilMax: Math.min(Math.max(Number(days) || 7, 0), 60),
      imageCache: new Map(),
    });
    if (count === 0) throw AppError.conflict('No hay cumpleaños en ese período — no se envió ninguna notificación.');
    return { sent: count };
  }

  /** Cron (cada pocos minutos): a cada usuario suscrito le llega, UNA vez al día y a partir de la
   * hora que eligió (`sendTime`, en su zona horaria o si no la del club), la notificación por
   * el/los cumpleaños que caen exactamente en `daysBefore` días (0 = hoy). Si el servidor estuvo
   * caído a esa hora, se envía en la primera pasada después (en vez de saltarse el día). */
  async sendDailyDigests() {
    const subscriptions = await userSettingsRepository.findAllByKey(SETTING_KEY);
    const lastSentRows = await userSettingsRepository.findAllByKey(LAST_SENT_KEY);
    const lastSent = new Map(lastSentRows.map((r) => [`${r.user_id}:${r.club_id}`, r.setting_value]));
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
      if (local.time < settings.sendTime || lastSent.get(subKey) === local.date) continue;
      // Primera pasada tras activar la hora elegible: si ya pasó hace rato la hora de hoy y no hay
      // registro previo (antes el envío era fijo a las 08:00 y no se registraba), se marca el día
      // como enviado en vez de mandar ahora un aviso que probablemente ya le llegó.
      if (!lastSent.has(subKey) && minutesBetween(settings.sendTime, local.time) > 60) {
        // eslint-disable-next-line no-await-in-loop
        await userSettingsRepository.upsertMany(sub.user_id, sub.club_id, { [LAST_SENT_KEY]: local.date });
        continue;
      }
      // Solo miembros activos del club: un usuario retirado/suspendido deja de recibir la notificación.
      // eslint-disable-next-line no-await-in-loop
      const membership = await usersRepository.findMembership(sub.user_id, sub.club_id);
      if (!membership || membership.status !== USER_CLUB_STATUS.ACTIVE) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        const count = await this._notifyBirthdays({
          userId: sub.user_id,
          clubId: sub.club_id,
          daysUntilMin: settings.daysBefore,
          daysUntilMax: settings.daysBefore,
          imageCache,
        });
        sent += count;
        // eslint-disable-next-line no-await-in-loop
        await userSettingsRepository.upsertMany(sub.user_id, sub.club_id, { [LAST_SENT_KEY]: local.date });
      } catch (error) {
        logger.error('[cron] Error enviando notificaciones de cumpleaños', { userId: sub.user_id, clubId: sub.club_id, error: error.message });
      }
    }
    return sent;
  }
}

module.exports = new BirthdaysService();
