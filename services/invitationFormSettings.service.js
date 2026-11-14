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
 *  - `guardian`: fichas de un apoderado ({ enabled, formIds }, sql/082): quien responde completa
 *    también los datos de otra persona, que queda como miembro aparte y apoderado del primero.
 *    Siempre con la ficha del identificador; sin fichas elegidas, las por defecto.
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
      guardian: { enabled: !!v?.guardian?.enabled, formIds: ids(v?.guardian?.formIds) },
    };
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

  /** Valida lo que llega del modal de la invitación y lo deja listo para guardar (texto JSON). */
  async normalize(clubId, data) {
    const v = this._shape(data);
    const [groups, consents] = await Promise.all([memberGroupsRepository.findOptions(clubId), publicFormConsentsRepository.listByClub(clubId)]);
    const validGroups = new Set(groups.map((g) => g.id));
    const validConsents = new Set(consents.map((c) => c.id));
    v.groups.groupIds = v.groups.groupIds.filter((id) => validGroups.has(id));
    if (v.groups.mode !== 'off' && !v.groups.groupIds.length) throw AppError.badRequest('Elige al menos un grupo para ofrecer en el formulario.');
    if (v.groups.mode === 'off') v.groups.groupIds = [];
    v.consentIds = v.consentIds.filter((id) => validConsents.has(id));
    // Fichas del apoderado: las del club; sin elegir, las por defecto. La del identificador siempre.
    if (v.guardian.enabled) {
      const memberFormsService = require('./memberForms.service');
      const valid = new Set((await memberFormsRepository.findByClub(clubId)).map((f) => f.id));
      const chosen = v.guardian.formIds.filter((id) => valid.has(id));
      v.guardian.formIds = await memberFormsService.withIdentifierForm(clubId, chosen.length ? chosen : await memberFormsRepository.findDefaultIds(clubId));
    } else {
      v.guardian.formIds = [];
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
