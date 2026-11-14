const memberApplicationsRepository = require('../repositories/memberApplications.repository');
const { showLogoOnBanner } = require('../helpers/clubBranding');
const clubsRepository = require('../repositories/clubs.repository');
const settingsRepository = require('../repositories/settings.repository');
const memberGroupsRepository = require('../repositories/memberGroups.repository');
const memberFieldsRepository = require('../repositories/memberFields.repository');
const membersRepository = require('../repositories/members.repository');
const usersRepository = require('../repositories/users.repository');
const auditRepository = require('../repositories/audit.repository');
const invitationsRepository = require('../repositories/invitations.repository');
const memberFormsRepository = require('../repositories/memberForms.repository');
const memberFormVersionsRepository = require('../repositories/memberFormVersions.repository');
const membersService = require('./members.service');
const memberFieldsService = require('./memberFields.service');
const memberFormsService = require('./memberForms.service');
const invitationsService = require('./invitations.service');
const { withTransaction } = require('../config/database');
const notificationsService = require('./notifications.service');
const publicFormConsentsService = require('./publicFormConsents.service');
const invitationFormSettingsService = require('./invitationFormSettings.service');
const emailService = require('./email.service');
const { renderClubEmail } = require('../helpers/emailTemplate');
const AppError = require('../helpers/AppError');
const logger = require('../helpers/logger');
const { toAbsoluteMediaUrl } = require('../helpers/mediaUrl');
const { toDateOnly } = require('../helpers/membership');
const { UPLOAD_TYPES } = require('../helpers/memberFieldTypes');
const { collectUploads, discard, splitGuardianFiles } = require('../helpers/memberUploads');
const memberGuardiansRepository = require('../repositories/memberGuardians.repository');
const { resolvePrivatePath, deletePrivateFile } = require('../middlewares/privateUpload.middleware');
const { CLUB_STATUS, FUNCTIONS, USER_CLUB_STATUS } = require('../config/constants');

/** Invitación en la que se convirtió el viejo enlace del club `/inscripcion/<código-del-club>`. */
const LEGACY_INVITATION_KEY = 'public_member_form_invitation_id';
/** Categorías (grupos) que se ofrecen en el formulario: { mode: 'off'|'optional'|'required', groupIds }. */
const PUBLIC_GROUPS_KEY = 'public_member_form_groups';
/** Pedir (o no) el "Mensaje para el club" en el formulario. Sin valor guardado = sí (como siempre). */
const PUBLIC_MESSAGE_KEY = 'public_member_form_ask_message';
const DUPLICATE_MESSAGE = 'Ya tenemos una ficha o una solicitud con estos datos. Si crees que es un error, contacta directamente al club.';

/** Ids de fichas guardados como texto JSON. */
const parseIds = (raw) => {
  try {
    const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(list) ? list.map(Number).filter(Boolean) : [];
  } catch {
    return [];
  }
};

/**
 * Fichas enviadas para revisión. Dos orígenes:
 *  - **Enlace público de una invitación sin cuenta** (`/inscripcion/<código>`): la persona responde
 *    las fichas que pide la invitación (sus campos marcados "en el formulario público", ver
 *    member_fields.in_public_form) sin sesión; cada envío consume un uso de la invitación.
 *  - **Cuenta** que entró con una invitación que pide fichas (`/inscripcion`, con sesión).
 * Quedan pendientes hasta que alguien con permiso las acepta (se crea la ficha, o se suma al
 * miembro existente con el mismo identificador, para no duplicarlo) o las rechaza.
 */
class MemberApplicationsService {
  // ------------------------------------------------------------------ configuración

  /** ¿Recibe fichas? = tiene alguna invitación activa que las pida (ya no hay un interruptor aparte). */
  async isEnabled(clubId) {
    return invitationsRepository.clubHasFormInvitations(clubId);
  }

  async _groupsSetting(clubId) {
    const settings = await settingsRepository.findAllByClub(clubId);
    let raw = null;
    try {
      raw = JSON.parse(settings[PUBLIC_GROUPS_KEY] || 'null');
    } catch {
      raw = null;
    }
    const mode = ['off', 'optional', 'required'].includes(raw?.mode) ? raw.mode : 'off';
    const groupIds = Array.isArray(raw?.groupIds) ? raw.groupIds.map(Number).filter(Boolean) : [];
    return { mode, groupIds };
  }

  async _askMessage(clubId) {
    const settings = await settingsRepository.findAllByClub(clubId);
    return settings[PUBLIC_MESSAGE_KEY] !== '0';
  }

  async getSetting(clubId) {
    return { enabled: await this.isEnabled(clubId), groups: await this._groupsSetting(clubId), askMessage: await this._askMessage(clubId) };
  }

  /** Opciones de los formularios públicos (de todas las invitaciones sin cuenta). `enabled` ya no
   * se guarda: el enlace público se habilita o deshabilita desde cada invitación. */
  async setSetting(clubId, { enabled, groups, askMessage } = {}, actorId) {
    const updates = {};
    if (askMessage !== undefined) updates[PUBLIC_MESSAGE_KEY] = askMessage ? '1' : '0';
    if (groups && typeof groups === 'object') {
      const mode = ['off', 'optional', 'required'].includes(groups.mode) ? groups.mode : 'off';
      const ids = Array.isArray(groups.groupIds) ? groups.groupIds.map(Number).filter(Boolean) : [];
      const valid = ids.length ? (await memberGroupsRepository.findByIds(ids, clubId)).map((g) => g.id) : [];
      if (mode !== 'off' && !valid.length) throw AppError.badRequest('Elige al menos un grupo para ofrecer en el formulario.');
      updates[PUBLIC_GROUPS_KEY] = JSON.stringify({ mode, groupIds: valid });
    }
    if (Object.keys(updates).length) await settingsRepository.upsertMany(clubId, updates);
    await auditRepository.logAction({ userId: actorId, clubId, action: 'PUBLIC_MEMBER_FORM_UPDATED', entityType: 'club_settings', entityId: clubId, changes: { enabled, groups, askMessage } });
    return this.getSetting(clubId);
  }

  /** Grupos que se ofrecen en el formulario público (id, nombre, color). `opts`: opciones de la invitación. */
  async _offeredGroups(clubId, opts) {
    const { mode, groupIds } = opts.groups;
    if (mode === 'off' || !groupIds.length) return { mode: 'off', groups: [] };
    const groups = (await memberGroupsRepository.findOptions(clubId)).filter((g) => groupIds.includes(g.id));
    return { mode: groups.length ? mode : 'off', groups };
  }

  // ------------------------------------------------------------------ público (sin sesión)

  /**
   * Invitación y club de un enlace público `/inscripcion/<código>`: el código de la invitación o,
   * por compatibilidad, el código público del club (su viejo enlace, que ahora es una invitación,
   * ver sql/072). Lanza el motivo si no se puede usar (no existe, deshabilitada, vencida, sin usos).
   */
  async _publicInvitation(code) {
    const raw = String(code || '').trim().slice(0, 40);
    let invitation = raw ? await invitationsRepository.findByCode(raw.toUpperCase()) : null;
    if (!invitation && raw) {
      const legacyClub = await clubsRepository.findByPublicCode(raw);
      const settings = legacyClub ? await settingsRepository.findAllByClub(legacyClub.id) : {};
      if (settings[LEGACY_INVITATION_KEY]) invitation = await invitationsRepository.findById(Number(settings[LEGACY_INVITATION_KEY]));
    }
    if (!invitation) throw AppError.notFound('Este formulario no existe. Revisa el enlace o consulta directamente con el club.');
    const club = await clubsRepository.findActiveById(invitation.club_id);
    if (!club || club.status !== CLUB_STATUS.ACTIVE) throw AppError.notFound('Este formulario no está disponible.');
    await invitationsService.assertUsable(invitation);
    // Con la ficha del Identificador aunque la invitación sea anterior a esa regla (sql/079).
    const formIds = await memberFormsService.withIdentifierForm(club.id, await invitationsRepository.findFormIds(invitation.id));
    return { club, invitation, formIds };
  }

  /** Club del formulario público (lanza si no está disponible) — también para descargar los PDFs
   * de sus consentimientos sin sesión (publicFormConsents.controller.js). */
  async publicClub(code) {
    return (await this._publicInvitation(code)).club;
  }

  /** Fichas (nombre + campos en orden) para armar el formulario por bloques. */
  async _formsInfo(clubId, formIds) {
    const [forms, byForm] = await Promise.all([memberFormsRepository.findByIds(clubId, formIds), memberFormsRepository.fieldIdsByForm(clubId)]);
    return forms.map((f) => ({ id: f.id, name: f.name, description: f.description ?? null, fieldIds: byForm[f.id] || [] }));
  }

  /** Campos de las fichas `formIds` (sin repetir), como DTO. `publicOnly`: solo los del formulario público. */
  async _formFields(clubId, formIds, { publicOnly = false } = {}) {
    const rows = await memberFormsService.fieldsOf(clubId, formIds);
    return rows.filter((f) => !publicOnly || f.in_public_form).map((f) => memberFieldsService.toDto(f));
  }

  // ------------------------------------------------------------------ apoderado (sql/082)

  /** Fichas y campos del apoderado que pide la invitación, o null. `publicOnly`: solo los del formulario público. */
  async _guardianForm(clubId, opts, { publicOnly = false } = {}) {
    if (!opts?.guardian?.enabled) return null;
    const chosen = opts.guardian.formIds?.length ? opts.guardian.formIds : await memberFormsRepository.findDefaultIds(clubId);
    const valid = (await memberFormsRepository.findByIds(clubId, chosen)).map((f) => f.id);
    const formIds = await memberFormsService.withIdentifierForm(clubId, valid);
    return { formIds, forms: await this._formsInfo(clubId, formIds), fields: await this._formFields(clubId, formIds, { publicOnly }) };
  }

  /** Lo que ve el formulario de la sección del apoderado. */
  async _guardianFormDto(clubId, opts, { publicOnly = false } = {}) {
    const form = await this._guardianForm(clubId, opts, { publicOnly });
    return form ? { forms: form.forms, fields: form.fields } : null;
  }

  /**
   * Valida los datos del apoderado que llegan junto con la ficha (`guardianFields` + archivos
   * `gfile_<id>`): las fichas que pide la invitación, que sea otra persona (otro identificador) y,
   * si ya es miembro del club (mismo identificador), a qué registro se suma. Sin apoderado en la
   * invitación, lo que llegue se ignora. Devuelve null o `{ fields, formIds, uploads, target, relation }`.
   */
  async _prepareGuardian(clubId, opts, body, files, mainFields, { publicOnly = false } = {}) {
    const form = await this._guardianForm(clubId, opts, { publicOnly });
    if (!form) {
      discard(files);
      return null;
    }
    const fields = body.guardianFields && typeof body.guardianFields === 'object' ? body.guardianFields : null;
    if (!fields) throw AppError.badRequest('Faltan los datos del apoderado.');
    const catalog = (await memberFormsService.fieldsOf(clubId, form.formIds)).filter((f) => !publicOnly || f.in_public_form);
    const uploads = collectUploads(catalog, files, { requireAll: true, prefix: 'gfile' });
    const [mine, theirs] = await Promise.all([membersService.identifierFrom(clubId, mainFields), membersService.identifierFrom(clubId, fields)]);
    if (mine.value && theirs.value && mine.value === theirs.value) {
      throw AppError.badRequest(`El apoderado debe ser otra persona: tiene el mismo ${theirs.field.label}.`);
    }
    const target = await membersService.findByIdentifier(clubId, fields);
    try {
      await membersService.validateFields(clubId, fields, { publicOnly, formIds: form.formIds, memberId: target?.id ?? null });
    } catch (error) {
      if (error instanceof AppError) throw new AppError(`Datos del apoderado: ${error.message}`, error.statusCode, error.details);
      throw error;
    }
    const relation = body.guardianRelation ? String(body.guardianRelation).trim().slice(0, 40) || null : null;
    return { fields, formIds: form.formIds, uploads, target, relation };
  }

  /** Guarda la solicitud del apoderado enlazada a la suya (en la misma transacción). */
  async _createGuardianApp(clubId, appId, guardian, invitationId, conn) {
    return memberApplicationsRepository.create(
      { clubId, fields: guardian.fields, message: null, invitationId, formIds: guardian.formIds, targetMemberId: guardian.target?.id ?? null, guardianOfId: appId, guardianRelation: guardian.relation },
      conn
    );
  }

  /** Solicitud del apoderado de una solicitud (o null). */
  async _guardianAppOf(appId) {
    return (await memberApplicationsRepository.findGuardiansOf([appId]))[0] || null;
  }

  /** Invitación con la que entró una cuenta (para sus opciones: mensaje, grupo, consentimientos, apoderado). */
  async _accountInvitation(clubId, userId) {
    const id = await invitationsRepository.findLatestUseFor(userId, clubId);
    const invitation = id ? await invitationsRepository.findById(id) : null;
    return invitation && invitation.club_id === clubId ? invitation : null;
  }

  /** Opciones del formulario de una cuenta: las de su invitación (sin invitación, no se pregunta nada más). */
  async _accountOptions(clubId, userId) {
    const invitation = await this._accountInvitation(clubId, userId);
    if (!invitation) return { invitation: null, opts: { askMessage: false, groups: { mode: 'off', groupIds: [] }, consentIds: [], guardian: { enabled: false, formIds: [] } } };
    return { invitation, opts: await invitationFormSettingsService.effective(invitation) };
  }

  /** Fichas pendientes de una cuenta (las que pidió su invitación; antes de sql/072, las por defecto). */
  async _pendingFormIds(clubId, membership) {
    const ids = parseIds(membership?.pending_form_ids);
    const valid = ids.length ? (await memberFormsRepository.findByIds(clubId, ids)).map((f) => f.id) : [];
    return valid.length ? valid : memberFormsRepository.findDefaultIds(clubId);
  }

  async _clubBranding(club) {
    return {
      name: club.name,
      description: club.description,
      logoUrl: toAbsoluteMediaUrl(club.logo_url),
      bannerUrl: toAbsoluteMediaUrl(club.banner_url),
      showLogoOnBanner: await showLogoOnBanner(club.id),
      primaryColor: club.primary_color,
      secondaryColor: club.secondary_color,
    };
  }

  /**
   * Enlace público de una invitación. Si exige cuenta, no se responde acá: se avisa
   * (`requiresAccount`) para que el frontend lleve al flujo de ingreso al club con el código.
   */
  async getPublicForm(code) {
    const { club, invitation, formIds } = await this._publicInvitation(code);
    const opts = await invitationFormSettingsService.effective(invitation);
    if (invitation.requires_account) {
      return { requiresAccount: true, code: invitation.code, club: await this._clubBranding(club), fields: [], forms: [], groupChoice: { mode: 'off', groups: [] }, consents: [] };
    }
    return {
      requiresAccount: false,
      club: await this._clubBranding(club),
      forms: await this._formsInfo(club.id, formIds),
      fields: await this._formFields(club.id, formIds, { publicOnly: true }),
      // Grupo al que postula (si el club lo pide): opcional u obligatorio.
      groupChoice: await this._offeredGroups(club.id, opts),
      askMessage: opts.askMessage,
      // Consentimientos y documentos activos (uso de imagen, términos, reglamento...).
      consents: await publicFormConsentsService.listActive(club.id, opts.consentIds),
      // Fichas del apoderado (otra persona, que queda como miembro aparte), sql/082.
      guardian: await this._guardianFormDto(club.id, opts, { publicOnly: true }),
    };
  }

  /**
   * Ficha exigida por una invitación (`GET /members/me/form`; en el frontend es la misma página
   * `/inscripcion/<código>`). Independiente de si el formulario público está activo: solo exige
   * sesión y que la membresía siga marcada `requires_profile_completion`. Es la ficha completa
   * del club (lo que valida un alta manual) con lo demás que pida su invitación: mensaje, grupo,
   * consentimientos y las fichas del apoderado.
   */
  async getInvitationForm(club, membership) {
    if (!membership?.requires_profile_completion) throw AppError.notFound('No tienes una ficha pendiente por completar.');
    // Las fichas que pidió la invitación con la que entró (completas, como un alta manual).
    const formIds = await this._pendingFormIds(club.id, membership);
    const { invitation, opts } = await this._accountOptions(club.id, membership.user_id);
    return {
      // Código de su invitación: para abrir los PDF de los consentimientos (ruta pública).
      consentCode: invitation?.code ?? null,
      club: await this._clubBranding(club),
      forms: await this._formsInfo(club.id, formIds),
      fields: await this._formFields(club.id, formIds),
      groupChoice: await this._offeredGroups(club.id, opts),
      askMessage: opts.askMessage,
      consents: await publicFormConsentsService.listActive(club.id, opts.consentIds),
      guardian: await this._guardianFormDto(club.id, opts),
      review: await this._accountReview(club.id, membership.user_id),
    };
  }

  /**
   * En qué va la ficha que envió esa cuenta: `null` = todavía no envía ninguna (o la última ya se
   * aceptó); `pending` = esperando revisión (no puede hacer nada en el club); `rejected` = con el
   * motivo, sus datos (para precargar el formulario) y los archivos que se reutilizan si no sube
   * otros.
   */
  async _accountReview(clubId, userId) {
    const app = userId ? await memberApplicationsRepository.findLatestForUser(clubId, userId) : null;
    if (!app || app.status === 'approved') return null;
    const files = app.status === 'rejected' ? await memberApplicationsRepository.findFiles([app.id]) : [];
    const guardian = app.status === 'rejected' ? await this._guardianAppOf(app.id) : null;
    return {
      status: app.status,
      submittedAt: app.created_at,
      reviewedAt: app.reviewed_at,
      reviewNote: app.review_note,
      fields: app.status === 'rejected' ? this._parseFields(app) : {},
      files: files.map((f) => this._fileDto(f)),
      // Para precargar el resto del formulario (sus archivos de apoderado se vuelven a subir).
      message: app.status === 'rejected' ? app.message : null,
      groupId: app.status === 'rejected' ? app.group_id : null,
      guardian: guardian ? { fields: this._parseFields(guardian), relation: guardian.guardian_relation ?? null } : null,
    };
  }

  /**
   * Ficha enviada por una CUENTA a la que el código de invitación le exige completarla (POST
   * /members/me): queda como solicitud pendiente ligada a la cuenta, junto a las del formulario
   * público. Mientras no se acepte, la membresía sigue marcada `requires_profile_completion` (no
   * puede hacer nada en el club). Es la ficha completa del club (como un alta manual). Si la
   * anterior fue rechazada, los archivos que envió se reutilizan en los campos donde no sube otros.
   */
  /**
   * Lo demás que pide la invitación además de las fichas: grupo al que postula (validado),
   * mensaje para el club (se ignora si no se pide) y los consentimientos (sin los obligatorios
   * marcados no se envía). `meta`: IP y navegador, respaldo de lo aceptado.
   */
  async _extras(clubId, opts, body, meta = {}) {
    const choice = await this._offeredGroups(clubId, opts);
    const groupId = body.groupId ? Number(body.groupId) : null;
    if (choice.mode === 'required' && !groupId) throw AppError.badRequest('Elige el grupo al que postulas.');
    if (groupId && !choice.groups.some((g) => g.id === groupId)) throw AppError.badRequest('El grupo elegido no está disponible.');
    const message = body.message && opts.askMessage ? String(body.message).trim().slice(0, 500) || null : null;
    const consents = await publicFormConsentsService.resolveAcceptance(clubId, this._parseConsentIds(body.consents), meta, opts.consentIds);
    return { groupId: groupId || null, message, consents };
  }

  async submitForAccount(clubId, userId, body, allFiles = [], meta = {}) {
    // Los archivos del apoderado (`gfile_<id>`) van aparte (sql/082).
    const { own: files, guardian: guardianFiles } = splitGuardianFiles(allFiles);
    const membership = await usersRepository.findMembership(userId, clubId);
    if (!membership?.requires_profile_completion) {
      discard(allFiles);
      throw AppError.conflict('No tienes una ficha pendiente por completar.');
    }
    // La directiva pudo vincularle una ficha mientras tanto: ya no hay nada que revisar.
    if (await membersRepository.findByUserId(userId, clubId)) {
      discard(allFiles);
      await usersRepository.setRequiresProfileCompletion(userId, clubId, false);
      return { status: 'approved' };
    }
    const previous = await memberApplicationsRepository.findLatestForUser(clubId, userId);
    if (previous?.status === 'pending') {
      discard(allFiles);
      throw AppError.conflict('Tu ficha ya fue enviada y está en revisión.');
    }
    const reusable = previous?.status === 'rejected' ? await memberApplicationsRepository.findFiles([previous.id]) : [];

    const fields = body.fields && typeof body.fields === 'object' ? body.fields : {};
    // Solo las fichas que pidió su invitación.
    const formIds = await this._pendingFormIds(clubId, membership);
    const catalog = await memberFormsService.fieldsOf(clubId, formIds);
    // Los obligatorios de imagen/archivo se cumplen con lo nuevo o con lo de la ficha rechazada.
    let uploads;
    try {
      uploads = collectUploads(catalog, files, { requireAll: false });
    } catch (error) {
      discard(allFiles);
      throw error;
    }
    const sent = new Set(uploads.map((u) => u.field.id));
    const kept = new Set(reusable.map((f) => f.field_id));
    const missing = catalog.filter((f) => UPLOAD_TYPES.includes(f.field_type) && f.is_required && !sent.has(f.id) && !kept.has(f.id));
    let id;
    let extras;
    try {
      if (missing.length) throw AppError.badRequest(`Faltan campos obligatorios: ${missing.map((f) => f.label).join(', ')}.`);
      // Lo demás que pide su invitación: grupo, mensaje, consentimientos y el apoderado.
      const { opts } = await this._accountOptions(clubId, userId);
      extras = await this._extras(clubId, opts, body, meta);
      const guardian = await this._prepareGuardian(clubId, opts, body, guardianFiles, fields);
      // ¿Ya era miembro (mismo identificador) y sin cuenta? Al aceptarla, la cuenta se vincula a ese
      // registro en vez de crear otro.
      const existing = await membersService.findByIdentifier(clubId, fields);
      const target = existing && !existing.user_id ? existing : null;
      try {
        await membersService.validateFields(clubId, fields, { formIds, memberId: target?.id ?? null });
      } catch (error) {
        if (error.statusCode === 409 && /Ya existe un miembro/.test(error.message)) {
          throw AppError.conflict(`${error.message.replace(/\.$/, '')}: probablemente ya tienes una ficha. Pide a la directiva que la vincule a tu cuenta.`);
        }
        throw error;
      }
      await this._assertIdentifierNotPending(clubId, fields);
      if (guardian && target && guardian.target?.id === target.id) throw AppError.badRequest('El apoderado debe ser otra persona.');
      const invitationId = previous?.invitation_id ?? (await invitationsRepository.findLatestUseFor(userId, clubId));
      let guardianId = null;
      id = await withTransaction(async (conn) => {
        const appId = await memberApplicationsRepository.create(
          { clubId, userId, fields, message: extras.message, groupId: extras.groupId, invitationId, formIds, targetMemberId: target?.id ?? null },
          conn
        );
        if (guardian) guardianId = await this._createGuardianApp(clubId, appId, guardian, invitationId, conn);
        return appId;
      });
      for (const { field, files: list } of uploads) await memberApplicationsRepository.addFiles(id, field.id, list);
      if (guardian) for (const { field, files: list } of guardian.uploads) await memberApplicationsRepository.addFiles(guardianId, field.id, list);
      if (extras.consents.length) await publicFormConsentsService.saveAcceptance(id, extras.consents);
    } catch (error) {
      discard(allFiles);
      throw error;
    }
    if (reusable.length) {
      const dropped = await memberApplicationsRepository.moveFiles(previous.id, id, [...sent]);
      for (const f of dropped) deletePrivateFile(f.file_path);
    }
    const name = await this._nameFromFields(clubId, fields);
    await auditRepository.logAction({ userId, clubId, action: 'MEMBER_APPLICATION_SUBMITTED', entityType: 'member_application', entityId: id, changes: { name, account: true } });
    const user = await usersRepository.findById(userId);
    this._notifyReviewers(clubId, name, { username: user?.username, resubmitted: previous?.status === 'rejected' });
    return { status: 'pending', id };
  }

  /** `meta`: IP y navegador de quien envía, para el respaldo de los consentimientos aceptados. */
  /**
   * Envío del enlace público de una invitación SIN cuenta: valida las fichas que pide (solo sus
   * campos del formulario público), consume un uso de la invitación de forma atómica junto con la
   * creación de la solicitud (límite de usos) y la deja pendiente de revisión. Si el identificador
   * coincide con un miembro existente, la solicitud apunta a ese registro (al aceptarla se le suman
   * las respuestas, sin duplicarlo); la respuesta al público es la misma en ambos casos.
   * `meta`: IP y navegador de quien envía, para el respaldo de los consentimientos aceptados.
   */
  async submit(code, body, allFiles = [], meta = {}) {
    // Los archivos del apoderado (`gfile_<id>`) van aparte (sql/082).
    const { own: files, guardian: guardianFiles } = splitGuardianFiles(allFiles);
    let club;
    let invitation;
    let formIds;
    try {
      ({ club, invitation, formIds } = await this._publicInvitation(code));
      if (invitation.requires_account) throw AppError.badRequest('Esta invitación requiere una cuenta: inicia sesión o regístrate para usarla.');
    } catch (error) {
      discard(allFiles);
      throw error;
    }
    const fields = body.fields && typeof body.fields === 'object' ? body.fields : {};
    // Imágenes y archivos: mismas reglas que los demás campos (solo los del formulario público).
    const catalog = (await memberFormsService.fieldsOf(club.id, formIds)).filter((f) => f.in_public_form);
    let id;
    try {
      const uploads = collectUploads(catalog, files, { requireAll: true });
      // Mismas reglas que la ficha interna (tipos, obligatorios). Si la persona ya tiene una
      // solicitud pendiente, el mensaje es genérico: el formulario es público y no debe confirmar
      // quién es socio del club.
      const target = await membersService.findByIdentifier(club.id, fields);
      try {
        await membersService.validateFields(club.id, fields, { publicOnly: true, formIds, memberId: target?.id ?? null });
        await this._assertIdentifierNotPending(club.id, fields);
      } catch (error) {
        if (error.statusCode === 409) throw AppError.conflict(DUPLICATE_MESSAGE);
        throw error;
      }
      // Grupo elegido, mensaje y consentimientos (sin los obligatorios marcados no se envía).
      const opts = await invitationFormSettingsService.effective(invitation);
      const { groupId, message, consents } = await this._extras(club.id, opts, body, meta);
      // Datos del apoderado (si la invitación los pide): otra persona, otro registro.
      const guardian = await this._prepareGuardian(club.id, opts, body, guardianFiles, fields, { publicOnly: true });
      if (guardian && target && guardian.target?.id === target.id) throw AppError.badRequest('El apoderado debe ser otra persona.');
      // El uso se reclama en la misma transacción que crea la solicitud: con el último uso
      // disponible, de dos envíos simultáneos solo uno queda (ver invitations.repository.js#claimUse).
      let guardianId = null;
      id = await withTransaction(async (conn) => {
        if (!(await invitationsRepository.claimUse(invitation.id, conn))) {
          throw AppError.badRequest('Esta invitación ya alcanzó su límite de usos o dejó de estar activa.');
        }
        const appId = await memberApplicationsRepository.create(
          { clubId: club.id, fields, message, groupId, invitationId: invitation.id, formIds, targetMemberId: target?.id ?? null },
          conn
        );
        if (guardian) guardianId = await this._createGuardianApp(club.id, appId, guardian, invitation.id, conn);
        await invitationsRepository.recordUse({ invitationId: invitation.id, applicationId: appId }, conn);
        return appId;
      });
      if (consents.length) await publicFormConsentsService.saveAcceptance(id, consents);
      for (const { field, files: list } of uploads) await memberApplicationsRepository.addFiles(id, field.id, list);
      if (guardian) for (const { field, files: list } of guardian.uploads) await memberApplicationsRepository.addFiles(guardianId, field.id, list);
    } catch (error) {
      discard(allFiles);
      throw error;
    }
    const name = await this._nameFromFields(club.id, fields);
    await auditRepository.logAction({ userId: null, clubId: club.id, action: 'MEMBER_APPLICATION_SUBMITTED', entityType: 'member_application', entityId: id, changes: { name } });
    this._notifyReviewers(club.id, name);
    return { id };
  }

  /** Ids de consentimientos marcados: en multipart llegan como texto JSON ("[1,2]"). */
  _parseConsentIds(raw) {
    if (Array.isArray(raw)) return raw;
    if (typeof raw !== 'string' || !raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /** Una misma persona no puede tener dos solicitudes pendientes (por su identificador). */
  async _assertIdentifierNotPending(clubId, fields) {
    // Con el mismo respaldo que al reconocer a un miembro (el RUT de otra ficha, sql/079).
    const { field, value: wanted } = await membersService.identifierFrom(clubId, fields);
    if (!wanted) return;
    const pending = await memberApplicationsRepository.listByClub(clubId, 'pending');
    for (const app of pending) {
      const { value } = await membersService.identifierFrom(clubId, this._parseFields(app));
      if (value && value === wanted) {
        throw AppError.conflict(`Ya hay una solicitud con este ${field.label} esperando revisión. El club te contactará.`);
      }
    }
  }

  async _nameFromFields(clubId, fields) {
    const catalog = await memberFieldsRepository.findByClub(clubId);
    // El nombre está en una sola ficha (sql/079): si se respondió otra, sirve su campo del mismo nombre.
    const byRole = (role) => {
      const f = catalog.find((x) => x.role === role);
      if (!f) return null;
      return fields[f.code] || catalog.filter((x) => x.id !== f.id && x.label.trim().toLowerCase() === f.label.trim().toLowerCase()).map((x) => fields[x.code]).find(Boolean) || null;
    };
    return [byRole('first_name'), byRole('middle_name'), byRole('last_name'), byRole('second_last_name')].filter(Boolean).join(' ') || 'Sin nombre';
  }

  /** Aviso (en la app, push y correo — ver notificationsService.notifyUser) a quienes pueden
   * aceptar solicitudes. `account`: la envió una cuenta (código de invitación). Mejor esfuerzo:
   * nunca hace fallar el envío. */
  _notifyReviewers(clubId, name, account = null) {
    const title = account ? (account.resubmitted ? 'Ficha corregida para revisar' : 'Nueva ficha para revisar') : 'Nueva solicitud de inscripción';
    const message = account
      ? `${name}${account.username ? ` (cuenta ${account.username})` : ''} ${account.resubmitted ? 'corrigió su ficha' : 'completó su ficha'} y espera tu aprobación para entrar al club.`
      : `${name} llenó el formulario de inscripción y espera tu revisión.`;
    memberApplicationsRepository
      .findReviewerUserIds(clubId, FUNCTIONS.CREATE_MEMBERS)
      .then((userIds) =>
        Promise.all(
          userIds.map((userId) =>
            notificationsService.notifyUser({ userId, clubId, type: 'info', category: 'members', title, message, link: '/requests?kind=fichas' })
          )
        )
      )
      .catch((error) => logger.error(`[memberApplications] aviso a revisores: ${error.message}`));
  }

  // ------------------------------------------------------------------ revisión

  _parseFields(row) {
    try {
      return typeof row.fields === 'string' ? JSON.parse(row.fields) : row.fields || {};
    } catch {
      return {};
    }
  }

  _fileDto(f) {
    return { id: f.id, fieldId: f.field_id, name: f.name, mimeType: f.mime_type, sizeBytes: f.size_bytes };
  }

  /** `nested`: son las del apoderado (van dentro de la suya, sql/082). */
  async _toDtos(clubId, rows, { nested = false } = {}) {
    // La del apoderado de cada una (con sus datos, fichas, archivos y a qué miembro se sumaría).
    const guardianRows = nested ? [] : await memberApplicationsRepository.findGuardiansOf(rows.map((r) => r.id));
    const guardianDtos = guardianRows.length ? await this._toDtos(clubId, guardianRows, { nested: true }) : [];
    const guardianOf = new Map(guardianRows.map((r, i) => [r.guardian_of_id, guardianDtos[i]]));
    const catalog = await memberFieldsRepository.findByClub(clubId);
    const files = await memberApplicationsRepository.findFiles(rows.map((r) => r.id));
    const consents = await publicFormConsentsService.acceptanceByApplication(rows.map((r) => r.id));
    const codeOf = (role) => catalog.find((x) => x.role === role)?.code;
    const nameCodes = ['first_name', 'middle_name', 'last_name', 'second_last_name'].map(codeOf).filter(Boolean);
    // Primer nombre + primer apellido: para títulos y espacios angostos, donde el completo se corta.
    const shortCodes = ['first_name', 'last_name'].map(codeOf).filter(Boolean);
    const forms = new Map((await memberFormsRepository.findByClub(clubId)).map((f) => [f.id, f.name]));
    // Miembro con el mismo identificador: el que se guardó al enviarla o, si la solicitud sigue
    // pendiente y no tenía, el que coincida ahora (igual que al aceptarla).
    const targetOf = new Map(rows.map((r) => [r.id, r.target_member_id || null]));
    for (const r of rows) {
      if (r.status !== 'pending' || targetOf.get(r.id)) continue;
      const found = await membersService.findByIdentifier(clubId, this._parseFields(r));
      if (found && !(r.user_id && found.user_id)) targetOf.set(r.id, found.id);
    }
    const targetIds = [...new Set([...targetOf.values()].filter(Boolean))];
    const targets = new Map((await membersRepository.findNamesByIds(targetIds, clubId)).map((m) => [m.id, membersService._fullName(m)]));
    const [targetForms, versionCounts] = await Promise.all([memberFormsRepository.formIdsByMembers(targetIds), memberFormVersionsRepository.countsByMembers(targetIds)]);
    const identifierField = catalog.find((f) => f.role === 'identifier');
    /** Qué pasa con cada ficha respondida si se acepta: versión nueva (ya la tenía) o se le agrega. */
    const planFor = (memberId, formIds) =>
      formIds.map((id) => {
        const has = (targetForms[memberId] || []).includes(id);
        return { formId: id, name: forms.get(id), hasForm: has, nextVersion: has ? (versionCounts[memberId]?.[id] ?? 1) + 1 : 1 };
      });
    return rows.map((row) => {
      const fields = this._parseFields(row);
      const formIds = parseIds(row.form_ids).filter((id) => forms.has(id));
      return {
        id: row.id,
        status: row.status,
        fullName: nameCodes.map((c) => fields[c]).filter(Boolean).join(' ') || 'Sin nombre',
        shortName: shortCodes.map((c) => fields[c]).filter(Boolean).join(' ') || nameCodes.map((c) => fields[c]).filter(Boolean).join(' ') || 'Sin nombre',
        fields,
        // Fichas que responde y de qué invitación viene.
        formIds,
        forms: formIds.map((id) => ({ id, name: forms.get(id) })),
        invitation: row.invitation_id ? { id: row.invitation_id, code: row.invitation_code ?? null, note: row.invitation_note ?? null } : null,
        // Mismo identificador que un miembro existente: al aceptarla se suma a su registro.
        // Al aceptarla se suma a ese registro: cada ficha que ya tenía queda con una versión nueva.
        targetMember:
          targetOf.get(row.id) && targets.has(targetOf.get(row.id))
            ? { id: targetOf.get(row.id), fullName: targets.get(targetOf.get(row.id)), identifierLabel: identifierField?.label ?? 'identificador', forms: planFor(targetOf.get(row.id), formIds) }
            : null,
        message: row.message,
        reviewedByUsername: row.reviewed_by_username ?? null,
        reviewedAt: row.reviewed_at,
        reviewNote: row.review_note,
        memberId: row.member_id,
        groupId: row.group_id ?? null,
        groupName: row.group_name ?? null,
        createdAt: row.created_at,
        // Ficha enviada por una cuenta del club (código de invitación): al aceptarla queda
        // vinculada a esa cuenta, que mientras tanto no puede hacer nada en el club.
        source: row.user_id ? 'account' : 'public',
        account: row.user_id
          ? { userId: row.user_id, username: row.account_username ?? null, email: row.account_email ?? null, avatarUrl: toAbsoluteMediaUrl(row.account_avatar_url) }
          : null,
        // Imágenes y archivos enviados (solo mientras está pendiente: al revisarla pasan a la ficha o se borran).
        files: files.filter((f) => f.application_id === row.id).map((f) => this._fileDto(f)),
        // Copia de los consentimientos tal como estaban al enviar (qué aceptó, cuándo y desde qué IP).
        consents: consents.get(row.id) || [],
        // Apoderado que se presenta junto con esta solicitud (se revisan juntas), o su parentesco
        // si esta ES la del apoderado.
        ...(nested ? { relation: row.guardian_relation ?? null } : { guardian: guardianOf.get(row.id) ?? null }),
      };
    });
  }

  /** Archivo adjunto de una solicitud, para descargarlo / verlo al revisarla. */
  async getFile(clubId, applicationId, fileId) {
    const app = await memberApplicationsRepository.findInClub(clubId, applicationId);
    const file = app && (await memberApplicationsRepository.findFiles([app.id])).find((f) => f.id === fileId);
    const absolutePath = file && resolvePrivatePath(file.file_path);
    if (!absolutePath) throw AppError.notFound('Archivo no encontrado.');
    return { absolutePath, name: file.name, mimeType: file.mime_type };
  }

  /** Agrupa los archivos guardados de una solicitud por campo (formato de members.service#attachUploads). */
  async _uploadsOf(clubId, appId) {
    const catalog = await memberFieldsRepository.findByClub(clubId);
    const rows = await memberApplicationsRepository.findFiles([appId]);
    const result = [];
    for (const field of catalog) {
      const list = rows.filter((r) => r.field_id === field.id);
      if (list.length) result.push({ field, files: list });
    }
    // Archivos de un campo que ya no existe: se descartan.
    for (const r of rows) if (!catalog.some((f) => f.id === r.field_id)) deletePrivateFile(r.file_path);
    return result;
  }

  async list(clubId, status, { archived = false } = {}) {
    return this._toDtos(clubId, await memberApplicationsRepository.listByClub(clubId, status || null, { archived }));
  }

  /** Archiva (o desarchiva) solicitudes ya revisadas: salen de Aceptadas/Rechazadas. */
  async archive(clubId, ids, archived, actorId) {
    const changed = await memberApplicationsRepository.setArchived(clubId, ids.map(Number), archived, actorId);
    if (changed) {
      await auditRepository.logAction({
        userId: actorId,
        clubId,
        action: archived ? 'MEMBER_APPLICATIONS_ARCHIVED' : 'MEMBER_APPLICATIONS_UNARCHIVED',
        entityType: 'member_application',
        entityId: null,
        changes: { ids: ids.map(Number), count: changed },
      });
    }
    return { changed };
  }

  async countPending(clubId) {
    return { pending: await memberApplicationsRepository.countPending(clubId) };
  }

  async _pending(clubId, id) {
    const app = await memberApplicationsRepository.findInClub(clubId, id);
    if (!app) throw AppError.notFound('Solicitud no encontrada.');
    if (app.status !== 'pending') throw AppError.conflict('Esta solicitud ya fue revisada.');
    return app;
  }

  /** Acepta: crea la ficha con los datos de la solicitud (validada de nuevo, igual que un alta
   * manual) + los grupos y la fecha de ingreso que elige quien revisa. Si la envió una cuenta, la
   * ficha queda vinculada a ella y la cuenta ya puede usar el club. */
  async approve(clubId, id, { groupIds = [], joinedOn = null } = {}, actorId) {
    const app = await this._pending(clubId, id);
    if (app.guardian_of_id) throw AppError.badRequest('Esta solicitud se revisa junto con la de la persona a la que apodera.');
    // Con apoderado (sql/082): se aceptan juntas. Sus datos se revisan antes de crear nada.
    const guardianApp = await this._guardianAppOf(id);
    const guardianPlan = guardianApp?.status === 'pending' ? await this._checkGuardian(clubId, app, guardianApp) : null;
    const result = await this._approveMain(clubId, app, { groupIds, joinedOn }, actorId);
    if (guardianPlan) {
      result.guardianMemberId = await this._approveGuardian(clubId, app, guardianApp, guardianPlan, result.memberId, joinedOn, actorId);
    }
    return result;
  }

  /** Datos del apoderado listos para aceptar: validados de nuevo y con el miembro al que se sumarían. */
  async _checkGuardian(clubId, app, guardianApp) {
    const fields = this._parseFields(guardianApp);
    const formIds = await this._appFormIds(clubId, guardianApp);
    let target = guardianApp.target_member_id ? await membersRepository.findActiveById(guardianApp.target_member_id) : null;
    if (target && target.club_id !== clubId) target = null;
    if (!target) target = await membersService.findByIdentifier(clubId, fields);
    try {
      await membersService.validateFields(clubId, fields, { publicOnly: !app.user_id, formIds, memberId: target?.id ?? null });
    } catch (error) {
      if (error instanceof AppError) throw new AppError(`Datos del apoderado: ${error.message}`, error.statusCode, error.details);
      throw error;
    }
    return { fields, formIds, target };
  }

  /**
   * Acepta la del apoderado: crea su registro (o suma las respuestas al miembro que ya tenía ese
   * identificador) y lo deja como apoderado de `memberId`. Devuelve el id del apoderado.
   */
  async _approveGuardian(clubId, app, guardianApp, { fields, formIds, target }, memberId, joinedOn, actorId) {
    const publicOnly = !app.user_id;
    let guardianId;
    if (target && target.id !== memberId) {
      await membersService.applySubmission(clubId, target.id, fields, formIds, actorId, { publicOnly, newVersion: true, source: 'application' });
      await membersService.attachUploads(clubId, target.id, await this._uploadsOf(clubId, guardianApp.id), actorId, { replaceDocs: true });
      guardianId = target.id;
    } else {
      const created = await membersService.create(clubId, { fields, formIds, status: 'active', groupIds: [], joinedOn: joinedOn || toDateOnly(new Date()) }, actorId, { publicOnly });
      await membersService.attachUploads(clubId, created.id, await this._uploadsOf(clubId, guardianApp.id), actorId);
      guardianId = created.id;
    }
    await memberGuardiansRepository.add({ memberId, guardianMemberId: guardianId, relation: guardianApp.guardian_relation ?? null, createdBy: actorId });
    await memberApplicationsRepository.deleteFiles(guardianApp.id);
    await memberApplicationsRepository.markReviewed(guardianApp.id, { status: 'approved', reviewedBy: actorId, memberId: guardianId });
    await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_APPLICATION_APPROVED', entityType: 'member_application', entityId: guardianApp.id, changes: { memberId: guardianId, guardianOf: memberId, merged: !!target } });
    return guardianId;
  }

  /** Acepta la solicitud de la persona (sin su apoderado). */
  async _approveMain(clubId, app, { groupIds = [], joinedOn = null } = {}, actorId) {
    const id = app.id;
    if (groupIds.length) {
      const found = await memberGroupsRepository.findByIds(groupIds, clubId);
      if (found.length !== groupIds.length) throw AppError.badRequest('Uno o más grupos no pertenecen a este club.');
    }
    if (app.user_id) {
      const membership = await usersRepository.findMembership(app.user_id, clubId);
      if (!membership || membership.status !== USER_CLUB_STATUS.ACTIVE) {
        throw AppError.conflict('Esa cuenta ya no pertenece al club: rechaza la solicitud o vuelve a invitarla.');
      }
      // Ya le vincularon una ficha por otro lado: se da por aceptada sin crear otra.
      const linked = await membersRepository.findByUserId(app.user_id, clubId);
      if (linked) {
        for (const f of await memberApplicationsRepository.findFiles([id])) deletePrivateFile(f.file_path);
        await memberApplicationsRepository.deleteFiles(id);
        await memberApplicationsRepository.markReviewed(id, { status: 'approved', reviewedBy: actorId, memberId: linked.id });
        await usersRepository.setRequiresProfileCompletion(app.user_id, clubId, false);
        this._notifyAccount(clubId, app, 'approved');
        return { memberId: linked.id };
      }
    }
    const fields = this._parseFields(app);
    const formIds = await this._appFormIds(clubId, app);
    // ¿Ya es miembro? (el que coincidía al enviarla o, si apareció después, el que coincida ahora
    // por identificador). Entonces se le suman las respuestas en vez de crear un registro duplicado.
    let target = app.target_member_id ? await membersRepository.findActiveById(app.target_member_id) : null;
    if (target && target.club_id !== clubId) target = null;
    if (!target) target = await membersService.findByIdentifier(clubId, fields);
    // Una cuenta solo se suma a un registro sin cuenta (o al suyo, que se resolvió arriba).
    if (target && app.user_id && target.user_id) target = null;
    if (target) return this._approveIntoExisting(clubId, app, target, { fields, formIds, groupIds }, actorId);

    const member = await membersService.create(
      clubId,
      { fields, formIds, status: 'active', groupIds, joinedOn: joinedOn || toDateOnly(new Date()), userId: app.user_id || null },
      actorId,
      // La de una cuenta es la ficha completa; la pública, solo los campos del formulario.
      { publicOnly: !app.user_id }
    );
    // Las imágenes y archivos enviados pasan a la ficha recién creada.
    await membersService.attachUploads(clubId, member.id, await this._uploadsOf(clubId, id), actorId);
    await memberApplicationsRepository.deleteFiles(id);
    await memberApplicationsRepository.markReviewed(id, { status: 'approved', reviewedBy: actorId, memberId: member.id });
    await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_APPLICATION_APPROVED', entityType: 'member_application', entityId: id, changes: { memberId: member.id } });
    if (app.user_id) {
      await usersRepository.setRequiresProfileCompletion(app.user_id, clubId, false);
      this._notifyAccount(clubId, app, 'approved');
    } else {
      this._notifyApplicant(clubId, app, 'approved');
    }
    return { memberId: member.id };
  }

  /** Fichas que responde la solicitud (anteriores a sql/072: las por defecto). */
  async _appFormIds(clubId, app) {
    const ids = parseIds(app.form_ids);
    const valid = ids.length ? (await memberFormsRepository.findByIds(clubId, ids)).map((f) => f.id) : [];
    return valid.length ? valid : memberFormsRepository.findDefaultIds(clubId);
  }

  /**
   * Acepta sumando a un miembro existente: guarda lo respondido (validado contra esas fichas), le
   * asigna las fichas, agrega los grupos elegidos y pasa los archivos. Si la envió una cuenta, la
   * cuenta queda vinculada a ese registro (sin crear otro).
   */
  async _approveIntoExisting(clubId, app, target, { fields, formIds, groupIds }, actorId) {
    if (app.user_id) {
      await membersRepository.updateById(target.id, { user_id: app.user_id });
      await usersRepository.setRequiresProfileCompletion(app.user_id, clubId, false);
    }
    // Volvió a responder sus fichas: cada una que ya tenía queda con una versión nueva (sql/078).
    await membersService.applySubmission(clubId, target.id, fields, formIds, actorId, { publicOnly: !app.user_id, newVersion: true, source: 'application' });
    if (groupIds.length) {
      const current = (await membersRepository.getGroupsForMember(target.id)).map((g) => g.id);
      await membersRepository.setGroups(target.id, [...new Set([...current, ...groupIds.map(Number)])]);
    }
    await membersService.attachUploads(clubId, target.id, await this._uploadsOf(clubId, app.id), actorId, { replaceDocs: true });
    await memberApplicationsRepository.deleteFiles(app.id);
    await memberApplicationsRepository.markReviewed(app.id, { status: 'approved', reviewedBy: actorId, memberId: target.id });
    await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_APPLICATION_APPROVED', entityType: 'member_application', entityId: app.id, changes: { memberId: target.id, merged: true } });
    if (app.user_id) this._notifyAccount(clubId, app, 'approved');
    return { memberId: target.id, merged: true };
  }

  /** Rechaza. La de una cuenta exige motivo (se le muestra para que corrija y reenvíe) y conserva
   * sus archivos (se reutilizan si no sube otros); la pública borra los archivos. */
  async reject(clubId, id, { reason } = {}, actorId) {
    const app = await this._pending(clubId, id);
    if (app.guardian_of_id) throw AppError.badRequest('Esta solicitud se revisa junto con la de la persona a la que apodera.');
    const note = reason ? String(reason).trim().slice(0, 255) : '';
    if (app.user_id && !note) throw AppError.badRequest('Indica el motivo del rechazo: se le mostrará a la persona para que corrija su ficha.');
    if (!app.user_id) {
      // Datos personales de alguien que no entra al club: los archivos se borran.
      for (const f of await memberApplicationsRepository.findFiles([id])) deletePrivateFile(f.file_path);
      await memberApplicationsRepository.deleteFiles(id);
    }
    // La del apoderado se rechaza con ella, con la misma observación (sus archivos se borran: se
    // vuelven a subir si la corrige).
    const guardianApp = await this._guardianAppOf(id);
    if (guardianApp?.status === 'pending') {
      for (const f of await memberApplicationsRepository.findFiles([guardianApp.id])) deletePrivateFile(f.file_path);
      await memberApplicationsRepository.deleteFiles(guardianApp.id);
      await memberApplicationsRepository.markReviewed(guardianApp.id, { status: 'rejected', reviewedBy: actorId, reviewNote: note || null });
    }
    await memberApplicationsRepository.markReviewed(id, { status: 'rejected', reviewedBy: actorId, reviewNote: note || null });
    await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_APPLICATION_REJECTED', entityType: 'member_application', entityId: id, changes: note ? { reason: note } : null });
    if (app.user_id) this._notifyAccount(clubId, app, 'rejected', note);
    else this._notifyApplicant(clubId, app, 'rejected', note);
  }

  /** Aviso a la cuenta que envió su ficha (app, push y correo). Mejor esfuerzo. */
  _notifyAccount(clubId, app, outcome, reason = null) {
    (async () => {
      const club = await clubsRepository.findById(clubId);
      await notificationsService.notifyUser({
        userId: app.user_id,
        clubId,
        type: outcome === 'approved' ? 'success' : 'warning',
        category: 'members',
        title: outcome === 'approved' ? `¡Tu ficha en ${club.name} fue aprobada!` : `Tu ficha en ${club.name} necesita cambios`,
        message: outcome === 'approved' ? 'Ya puedes usar el club desde la app.' : `Motivo: ${reason} — Corrígela y vuelve a enviarla.`,
        link: outcome === 'approved' ? '/' : '/inscripcion',
      });
    })().catch((error) => logger.error(`[memberApplications] aviso a la cuenta: ${error.message}`));
  }

  /**
   * Correo a quien postuló avisando si fue aceptada o no (si dejó un correo en el campo con uso
   * "correo"). Mejor esfuerzo: nunca hace fallar la revisión.
   */
  _notifyApplicant(clubId, app, outcome, reason = null) {
    (async () => {
      const catalog = await memberFieldsRepository.findByClub(clubId);
      const fields = this._parseFields(app);
      // Puede haber un correo de contacto por ficha (sql/083): sirve el primero válido.
      const to = catalog
        .filter((f) => f.role === 'email')
        .map((f) => String(fields[f.code] || '').trim())
        .find((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
      if (!to) return;
      const firstName = fields[catalog.find((f) => f.role === 'first_name')?.code] || '';
      const club = await clubsRepository.findById(clubId);
      const brand = { name: club.name, primaryColor: club.primary_color, logoUrl: toAbsoluteMediaUrl(club.logo_url) };
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
      const hello = firstName ? `Hola ${esc(firstName)},` : 'Hola,';
      if (outcome === 'approved') {
        await emailService.send({
          to,
          fromName: club.name,
          subject: 'Tu inscripción fue aceptada',
          html: renderClubEmail({
            club: brand,
            title: `¡Bienvenido/a a ${club.name}!`,
            preheader: 'Ya eres parte del club. Pronto te contactaremos con los próximos pasos.',
            bodyHtml: `<p>${hello}</p><p>Revisamos tu solicitud y ya eres parte de <strong>${esc(club.name)}</strong>. Pronto te contactaremos con los próximos pasos.</p>`,
          }),
        });
      } else {
        await emailService.send({
          to,
          fromName: club.name,
          subject: 'Sobre tu solicitud de inscripción',
          html: renderClubEmail({
            club: brand,
            title: 'Sobre tu solicitud de inscripción',
            preheader: reason ? `Por ahora no pudimos aceptarla. Motivo: ${reason}` : 'Por ahora no pudimos aceptarla.',
            bodyHtml: `<p>${hello}</p><p>Revisamos tu solicitud para <strong>${esc(club.name)}</strong> y por ahora no pudimos aceptarla.</p>${reason ? `<p><strong>Motivo:</strong> ${esc(reason)}</p>` : ''}<p>Si tienes dudas, contacta directamente al club.</p>`,
          }),
        });
      }
    })().catch((error) => logger.error(`[memberApplications] correo al postulante: ${error.message}`));
  }
}

module.exports = new MemberApplicationsService();
