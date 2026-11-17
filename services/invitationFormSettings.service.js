const settingsRepository = require('../repositories/settings.repository');
const memberGroupsRepository = require('../repositories/memberGroups.repository');
const publicFormConsentsRepository = require('../repositories/publicFormConsents.repository');
const memberFormsRepository = require('../repositories/memberForms.repository');
const AppError = require('../helpers/AppError');

/** Opciones que tenía el club antes de sql/077 (fallback de las invitaciones sin `form_settings`). */
const LEGACY_GROUPS_KEY = 'public_member_form_groups';
const LEGACY_MESSAGE_KEY = 'public_member_form_ask_message';
const GROUP_MODES = ['off', 'optional', 'required'];

const ids = (list) => (Array.isArray(list) ? [...new Set(list.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : []);

/**
 * Opciones del formulario de cada invitación que pide fichas, con o sin cuenta (sql/077): qué se
 * pregunta además de las fichas.
 *  - `askMessage`: cuadro "Mensaje para el club" — ya no se pregunta (siempre false).
 *  - `groups`: grupo al que postula ({ mode: off|optional|required, groupIds }).
 *  - `consentIds`: consentimientos que se piden (del listado del club, Códigos de invitación).
 *  - `guardian`: fichas de un apoderado ({ enabled, formIds, rolePriority }, sql/082): quien
 *    responde completa también los datos de otra persona, que queda como miembro aparte y
 *    apoderado del primero. Si se activa, hay que elegir al menos una ficha (no hay por defecto).
 *  - `rolePriority`: si las fichas elegidas repiten un dato especial (ej. dos con "Foto para
 *    cumpleaños"), en qué orden usarlas: { role: [formId, ...] } (sql/086). Al aceptar la
 *    solicitud se guarda en el miembro (member_role_priority).
 * Una invitación sin opciones guardadas (anterior a sql/077) usa las que tenía el club.
 */
class InvitationFormSettingsService {
  _parse(raw) {
    if (!raw) return null;
    try {
      const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return v && typeof v === 'object' ? v : null;
    } catch {
      return null;
    }
  }

  _shape(v) {
    const mode = GROUP_MODES.includes(v?.groups?.mode) ? v.groups.mode : 'off';
    return {
      // El "Mensaje para el club" ya no se pide (se quitó del modal de la invitación).
      askMessage: false,
      groups: { mode, groupIds: ids(v?.groups?.groupIds) },
      consentIds: ids(v?.consentIds),
      guardian: { enabled: !!v?.guardian?.enabled, formIds: ids(v?.guardian?.formIds), rolePriority: this._priority(v?.guardian?.rolePriority) },
      rolePriority: this._priority(v?.rolePriority),
    };
  }

  /** `{ role: [formId, ...] }` con ids válidos. */
  _priority(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).map(([role, list]) => [String(role).slice(0, 40), ids(list)]).filter(([, list]) => list.length));
  }

  /** Opciones del club previas a sql/077: el mensaje, la categoría y todos los consentimientos activos. */
  async clubDefaults(clubId) {
    const [settings, consents] = await Promise.all([settingsRepository.findAllByClub(clubId), publicFormConsentsRepository.listByClub(clubId, { activeOnly: true })]);
    return this._shape({
      askMessage: settings[LEGACY_MESSAGE_KEY] !== '0',
      groups: this._parse(settings[LEGACY_GROUPS_KEY]),
      consentIds: consents.map((c) => c.id),
    });
  }

  /** Opciones en efecto de una invitación (fila de `invitations`). `defaults`: ya calculadas para el club. */
  async effective(invitation, defaults = null) {
    const own = this._parse(invitation.form_settings);
    if (own) return this._shape(own);
    return defaults || this.clubDefaults(invitation.club_id);
  }

  /**
   * Valida lo que llega de la vista del código y lo deja listo para guardar (texto JSON).
   * `memberFormIds`: fichas que pide para quien se inscribe (para su `rolePriority`).
   */
  async normalize(clubId, data, memberFormIds = []) {
    const memberFormsService = require('./memberForms.service');
    const v = this._shape(data);
    const [groups, consents] = await Promise.all([memberGroupsRepository.findOptions(clubId), publicFormConsentsRepository.listByClub(clubId)]);
    const validGroups = new Set(groups.map((g) => g.id));
    const validConsents = new Set(consents.map((c) => c.id));
    v.groups.groupIds = v.groups.groupIds.filter((id) => validGroups.has(id));
    if (v.groups.mode !== 'off' && !v.groups.groupIds.length) throw AppError.badRequest('Elige al menos un grupo para ofrecer en el formulario.');
    if (v.groups.mode === 'off') v.groups.groupIds = [];
    v.consentIds = v.consentIds.filter((id) => validConsents.has(id));
    // Datos especiales repetidos entre las fichas de quien se inscribe: hay que elegir el orden.
    v.rolePriority = await memberFormsService.normalizePriority(clubId, memberFormIds, v.rolePriority, { label: 'Las fichas que se piden' });
    // Fichas del apoderado: las del club, al menos una (no hay fichas por defecto).
    if (v.guardian.enabled) {
      const valid = new Set((await memberFormsRepository.findByClub(clubId)).map((f) => f.id));
      v.guardian.formIds = v.guardian.formIds.filter((id) => valid.has(id));
      if (!v.guardian.formIds.length) throw AppError.badRequest('Elige al menos una ficha para el apoderado (o desactiva «Incluir fichas para apoderado»).');
      v.guardian.rolePriority = await memberFormsService.normalizePriority(clubId, v.guardian.formIds, v.guardian.rolePriority, { label: 'Las fichas del apoderado' });
    } else {
      v.guardian.formIds = [];
      v.guardian.rolePriority = {};
    }
    return JSON.stringify(v);
  }

  /** Listas para elegir en el modal de la invitación (sin exigir los permisos de Grupos o Fichas). */
  async options(clubId) {
    const [groups, consents] = await Promise.all([memberGroupsRepository.findOptions(clubId), publicFormConsentsRepository.listByClub(clubId)]);
    return {
      groups: groups.map((g) => ({ id: g.id, name: g.name, color: g.color })),
      consents: consents.map((c) => ({ id: c.id, title: c.title, isRequired: !!c.is_required, isActive: !!c.is_active })),
    };
  }
}

module.exports = new InvitationFormSettingsService();
