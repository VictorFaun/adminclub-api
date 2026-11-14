const settingsRepository = require('../repositories/settings.repository');
const memberFormsRepository = require('../repositories/memberForms.repository');
const membersRepository = require('../repositories/members.repository');
const auditRepository = require('../repositories/audit.repository');
const memberFieldsService = require('./memberFields.service');
const memberFormsService = require('./memberForms.service');
const permissionService = require('./permission.service');
const AppError = require('../helpers/AppError');
const { toAbsoluteMediaUrl } = require('../helpers/mediaUrl');
const { parseSettings, imageList } = require('../helpers/memberFieldTypes');
const { FUNCTIONS } = require('../config/constants');

/** Claves en `club_settings` (ver sql/076_public_page.sql). */
const KEYS = {
  enabled: 'public_page_enabled',
  treasury: 'public_payments_enabled',
  attendance: 'public_payments_show_attendance',
  formIds: 'public_page_form_ids',
};
/** Tope de fichas publicadas (una pestaña cada una). */
const MAX_PUBLIC_FORMS = 10;

const parseIds = (raw) => {
  try {
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? [...new Set(list.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [];
  } catch {
    return [];
  }
};

/**
 * Página pública del club (`/pay/<código-del-club>`): la persona se identifica con su RUT (o el
 * identificador del club) y ve, en pestañas, solo lo que el club activó: Tesorería (lo que debe y
 * enviar comprobantes), Asistencia y las fichas elegidas (solo sus datos de esas fichas).
 * Los datos de pagos y asistencia los sigue armando paymentProofs.service.js#lookup.
 */
class PublicPageService {
  /** Configuración guardada (sin importar si la página está encendida). */
  settingsFromRaw(settings) {
    return {
      enabled: settings[KEYS.enabled] === '1',
      treasury: settings[KEYS.treasury] === '1',
      attendance: settings[KEYS.attendance] === '1',
      formIds: parseIds(settings[KEYS.formIds]),
    };
  }

  async getSettings(clubId) {
    return this.settingsFromRaw(await settingsRepository.findAllByClub(clubId));
  }

  /** ¿Se puede enlazar a la sección de pagos? (correos de recordatorio, avisos de pago, etc.) */
  treasuryLinkOn(rawSettings) {
    const s = this.settingsFromRaw(rawSettings);
    return s.enabled && s.treasury;
  }

  /** Secciones que de verdad se muestran: con la página apagada, ninguna. */
  async activeSections(clubId) {
    const s = await this.getSettings(clubId);
    if (!s.enabled) return { treasury: false, attendance: false, formIds: [], any: false };
    const formIds = await this._existingFormIds(clubId, s.formIds);
    return { treasury: s.treasury, attendance: s.attendance, formIds, any: s.treasury || s.attendance || formIds.length > 0 };
  }

  async _existingFormIds(clubId, ids) {
    if (!ids.length) return [];
    const forms = await memberFormsRepository.findByClub(clubId);
    const valid = new Set(forms.map((f) => f.id));
    return ids.filter((id) => valid.has(id));
  }

  /** Configuración + las fichas del club (para elegir cuáles publicar). */
  async getSettingsForAdmin(clubId) {
    const [settings, forms] = await Promise.all([this.getSettings(clubId), memberFormsRepository.findByClub(clubId)]);
    const valid = new Set(forms.map((f) => f.id));
    return {
      ...settings,
      formIds: settings.formIds.filter((id) => valid.has(id)),
      forms: forms.map((f) => ({ id: f.id, name: f.name })),
    };
  }

  /**
   * Cambia lo que llegue. Publicar fichas expone datos de los miembros: solo quien administra el
   * club o las fichas puede cambiar `formIds` (el resto se ignora si no tiene ese permiso).
   */
  async updateSettings(clubId, data, actorId, authContext) {
    const updates = {};
    for (const key of ['enabled', 'treasury', 'attendance']) {
      if (data[key] !== undefined) updates[KEYS[key]] = data[key] ? '1' : '0';
    }
    if (data.formIds !== undefined) {
      if (!permissionService.hasAnyFunction(authContext, [FUNCTIONS.EDIT_CLUB, FUNCTIONS.EDIT_MEMBER_FIELDS])) {
        throw AppError.forbidden('Solo quien administra el club o las fichas puede elegir qué fichas se publican.');
      }
      const ids = await this._existingFormIds(clubId, parseIds(JSON.stringify(data.formIds)));
      if (ids.length > MAX_PUBLIC_FORMS) throw AppError.badRequest(`Puedes publicar hasta ${MAX_PUBLIC_FORMS} fichas.`);
      updates[KEYS.formIds] = JSON.stringify(ids);
    }
    if (Object.keys(updates).length) await settingsRepository.upsertMany(clubId, updates);
    await auditRepository.logAction({ userId: actorId, clubId, action: 'PUBLIC_PAGE_UPDATED', entityType: 'club_settings', entityId: clubId, changes: data });
    return this.getSettingsForAdmin(clubId);
  }

  /**
   * Fichas publicadas que el miembro responde, con sus datos: `[{ id, name, fields, values }]`.
   * `fields` con la misma forma que GET /members/fields (para pintarlos igual que la ficha de la
   * app). Sin archivos (son privados) ni campos sensibles.
   */
  async formsForMember(clubId, memberId, publishedIds) {
    if (!publishedIds.length) return [];
    const [assigned, forms, rawValues] = await Promise.all([
      memberFormsRepository.formIdsForMember(memberId),
      memberFormsRepository.findByClub(clubId),
      membersRepository.getFieldValues(memberId),
    ]);
    const mine = new Set(assigned);
    const valueByField = new Map(rawValues.map((v) => [v.field_id, v.value]));
    const out = [];
    for (const form of forms) {
      if (!publishedIds.includes(form.id) || !mine.has(form.id)) continue;
      // Nunca en la página pública: archivos (privados) ni campos marcados como sensibles (ej. salud).
      const rows = (await memberFormsService.fieldsOf(clubId, [form.id])).filter((f) => f.field_type !== 'file' && !parseSettings(f).sensitive);
      const values = {};
      for (const f of rows) values[f.code] = this._valueDto(f, valueByField.get(f.id));
      out.push({ id: form.id, name: form.name, fields: rows.map((f) => memberFieldsService.toDto(f)), values });
    }
    return out;
  }

  /** Mismo criterio que members.service.js#_fieldValueDto. */
  _valueDto(field, value) {
    if (value === null || value === undefined) return null;
    if (field.field_type === 'multiselect') {
      try {
        return JSON.parse(value);
      } catch {
        return [];
      }
    }
    if (field.field_type === 'image') {
      const urls = imageList(value).map((u) => toAbsoluteMediaUrl(u));
      return parseSettings(field).multiple ? urls : urls[0] ?? null;
    }
    return value;
  }
}

module.exports = new PublicPageService();
module.exports.PUBLIC_PAGE_KEYS = KEYS;
