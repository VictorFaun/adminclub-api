const memberApplicationsRepository = require('../repositories/memberApplications.repository');
const { showLogoOnBanner } = require('../helpers/clubBranding');
const clubsRepository = require('../repositories/clubs.repository');
const settingsRepository = require('../repositories/settings.repository');
const memberGroupsRepository = require('../repositories/memberGroups.repository');
const memberFieldsRepository = require('../repositories/memberFields.repository');
const auditRepository = require('../repositories/audit.repository');
const membersService = require('./members.service');
const memberFieldsService = require('./memberFields.service');
const notificationsService = require('./notifications.service');
const emailService = require('./email.service');
const { renderClubEmail } = require('../helpers/emailTemplate');
const AppError = require('../helpers/AppError');
const logger = require('../helpers/logger');
const { toAbsoluteMediaUrl } = require('../helpers/mediaUrl');
const { toDateOnly } = require('../helpers/membership');
const { normalizeIdentifier } = require('../helpers/memberFieldTypes');
const { collectUploads, discard } = require('../helpers/memberUploads');
const { resolvePrivatePath, deletePrivateFile } = require('../middlewares/privateUpload.middleware');
const { CLUB_STATUS, FUNCTIONS } = require('../config/constants');

const PUBLIC_FORM_KEY = 'public_member_form_enabled';
/** Categorías (grupos) que se ofrecen en el formulario: { mode: 'off'|'optional'|'required', groupIds }. */
const PUBLIC_GROUPS_KEY = 'public_member_form_groups';
const DUPLICATE_MESSAGE = 'Ya tenemos una ficha o una solicitud con estos datos. Si crees que es un error, contacta directamente al club.';

/**
 * Inscripción pública de miembros (`/inscripcion/<código-del-club>`): la persona llena la ficha
 * (los campos marcados "en el formulario público", ver member_fields.in_public_form) sin cuenta y
 * queda como solicitud pendiente; alguien con permiso la acepta (se crea la ficha con los grupos y
 * la fecha de ingreso que elija) o la rechaza. Solo responde si el club activó el formulario.
 */
class MemberApplicationsService {
  // ------------------------------------------------------------------ configuración

  async isEnabled(clubId) {
    const settings = await settingsRepository.findAllByClub(clubId);
    return settings[PUBLIC_FORM_KEY] === '1';
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

  async getSetting(clubId) {
    return { enabled: await this.isEnabled(clubId), groups: await this._groupsSetting(clubId) };
  }

  async setSetting(clubId, { enabled, groups } = {}, actorId) {
    const updates = {};
    if (enabled !== undefined) updates[PUBLIC_FORM_KEY] = enabled ? '1' : '0';
    if (groups && typeof groups === 'object') {
      const mode = ['off', 'optional', 'required'].includes(groups.mode) ? groups.mode : 'off';
      const ids = Array.isArray(groups.groupIds) ? groups.groupIds.map(Number).filter(Boolean) : [];
      const valid = ids.length ? (await memberGroupsRepository.findByIds(ids, clubId)).map((g) => g.id) : [];
      if (mode !== 'off' && !valid.length) throw AppError.badRequest('Elige al menos un grupo para ofrecer en el formulario.');
      updates[PUBLIC_GROUPS_KEY] = JSON.stringify({ mode, groupIds: valid });
    }
    if (Object.keys(updates).length) await settingsRepository.upsertMany(clubId, updates);
    await auditRepository.logAction({ userId: actorId, clubId, action: 'PUBLIC_MEMBER_FORM_UPDATED', entityType: 'club_settings', entityId: clubId, changes: { enabled, groups } });
    return this.getSetting(clubId);
  }

  /** Grupos que se ofrecen en el formulario público (id, nombre, color). */
  async _offeredGroups(clubId) {
    const { mode, groupIds } = await this._groupsSetting(clubId);
    if (mode === 'off' || !groupIds.length) return { mode: 'off', groups: [] };
    const groups = (await memberGroupsRepository.findOptions(clubId)).filter((g) => groupIds.includes(g.id));
    return { mode: groups.length ? mode : 'off', groups };
  }

  // ------------------------------------------------------------------ público (sin sesión)

  async _publicClub(code) {
    const club = await clubsRepository.findByPublicCode(String(code || '').slice(0, 40));
    if (!club || club.status !== CLUB_STATUS.ACTIVE || !(await this.isEnabled(club.id))) {
      throw AppError.notFound('Este formulario de inscripción no está disponible.');
    }
    return club;
  }

  /** Campos que van en el formulario público (los marcados para él, de cualquier tipo). */
  async _publicFields(clubId) {
    return (await memberFieldsService.listForClub(clubId)).filter((f) => f.inPublicForm);
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

  async getPublicForm(code) {
    const club = await this._publicClub(code);
    return {
      club: await this._clubBranding(club),
      fields: await this._publicFields(club.id),
      // Categoría a la que postula (si el club la pide): opcional u obligatoria.
      groupChoice: await this._offeredGroups(club.id),
    };
  }

  /**
   * Ficha exigida por una invitación (`GET /members/me/form`; en el frontend es la misma página
   * `/inscripcion/<código>`). Independiente de si el formulario público está activo: solo exige
   * sesión y que la membresía siga marcada `requires_profile_completion`. Es la ficha completa
   * del club (lo que valida members.service.js#createSelf) y sin categoría: los grupos los asigna
   * el club.
   */
  async getInvitationForm(club, membership) {
    if (!membership?.requires_profile_completion) throw AppError.notFound('No tienes una ficha pendiente por completar.');
    return {
      club: await this._clubBranding(club),
      fields: await memberFieldsService.listForClub(club.id),
      groupChoice: { mode: 'off', groups: [] },
    };
  }

  async submit(code, body, files = []) {
    let club;
    try {
      club = await this._publicClub(code);
    } catch (error) {
      discard(files);
      throw error;
    }
    const fields = body.fields && typeof body.fields === 'object' ? body.fields : {};
    // Imágenes y archivos: mismas reglas que los demás campos (solo los del formulario público).
    const catalog = (await memberFieldsRepository.findByClub(club.id)).filter((f) => f.in_public_form);
    const uploads = collectUploads(catalog, files, { requireAll: true });
    let id;
    try {
      // Mismas reglas que la ficha interna (tipos, obligatorios, identificador no repetido). Si la
      // persona ya es socia o ya tiene una solicitud, el mensaje es genérico: el formulario es
      // público y no debe confirmar quién es socio del club.
      try {
        await membersService.validateFields(club.id, fields, { publicOnly: true });
        await this._assertIdentifierNotPending(club.id, fields);
      } catch (error) {
        if (error.statusCode === 409) throw AppError.conflict(DUPLICATE_MESSAGE);
        throw error;
      }
      // Categoría elegida.
      const choice = await this._offeredGroups(club.id);
      const groupId = body.groupId ? Number(body.groupId) : null;
      if (choice.mode === 'required' && !groupId) throw AppError.badRequest('Elige la categoría a la que postulas.');
      if (groupId && !choice.groups.some((g) => g.id === groupId)) throw AppError.badRequest('La categoría elegida no está disponible.');
      const message = body.message ? String(body.message).trim().slice(0, 500) || null : null;
      id = await memberApplicationsRepository.create({ clubId: club.id, fields, message, groupId: groupId || null });
      for (const { field, files: list } of uploads) await memberApplicationsRepository.addFiles(id, field.id, list);
    } catch (error) {
      discard(files);
      throw error;
    }
    const name = await this._nameFromFields(club.id, fields);
    await auditRepository.logAction({ userId: null, clubId: club.id, action: 'MEMBER_APPLICATION_SUBMITTED', entityType: 'member_application', entityId: id, changes: { name } });
    this._notifyReviewers(club.id, name);
    return { id };
  }

  /** Una misma persona no puede tener dos solicitudes pendientes (por su identificador). */
  async _assertIdentifierNotPending(clubId, fields) {
    const field = await memberFieldsRepository.findByRole(clubId, 'identifier');
    if (!field || !fields[field.code]) return;
    const wanted = String(normalizeIdentifier(field, fields[field.code]) ?? '').toUpperCase();
    if (!wanted) return;
    const pending = await memberApplicationsRepository.listByClub(clubId, 'pending');
    for (const app of pending) {
      const value = this._parseFields(app)[field.code];
      if (value && String(normalizeIdentifier(field, value) ?? '').toUpperCase() === wanted) {
        throw AppError.conflict(`Ya hay una solicitud con este ${field.label} esperando revisión. El club te contactará.`);
      }
    }
  }

  async _nameFromFields(clubId, fields) {
    const catalog = await memberFieldsRepository.findByClub(clubId);
    const byRole = (role) => {
      const f = catalog.find((x) => x.role === role);
      return f ? fields[f.code] : null;
    };
    return [byRole('first_name'), byRole('middle_name'), byRole('last_name'), byRole('second_last_name')].filter(Boolean).join(' ') || 'Sin nombre';
  }

  /** Aviso a quienes pueden aceptar solicitudes (mejor esfuerzo: nunca hace fallar el envío). */
  _notifyReviewers(clubId, name) {
    memberApplicationsRepository
      .findReviewerUserIds(clubId, FUNCTIONS.CREATE_MEMBERS)
      .then((userIds) =>
        Promise.all(
          userIds.map((userId) =>
            notificationsService.notifyUser({
              userId,
              clubId,
              type: 'info',
              title: 'Nueva solicitud de inscripción',
              message: `${name} llenó el formulario de inscripción y espera tu revisión.`,
              link: '/members/applications',
            })
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

  async _toDtos(clubId, rows) {
    const catalog = await memberFieldsRepository.findByClub(clubId);
    const files = await memberApplicationsRepository.findFiles(rows.map((r) => r.id));
    const codeOf = (role) => catalog.find((x) => x.role === role)?.code;
    const nameCodes = ['first_name', 'middle_name', 'last_name', 'second_last_name'].map(codeOf).filter(Boolean);
    return rows.map((row) => {
      const fields = this._parseFields(row);
      return {
        id: row.id,
        status: row.status,
        fullName: nameCodes.map((c) => fields[c]).filter(Boolean).join(' ') || 'Sin nombre',
        fields,
        message: row.message,
        reviewedByUsername: row.reviewed_by_username ?? null,
        reviewedAt: row.reviewed_at,
        reviewNote: row.review_note,
        memberId: row.member_id,
        groupId: row.group_id ?? null,
        groupName: row.group_name ?? null,
        createdAt: row.created_at,
        // Imágenes y archivos enviados (solo mientras está pendiente: al revisarla pasan a la ficha o se borran).
        files: files.filter((f) => f.application_id === row.id).map((f) => this._fileDto(f)),
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

  async list(clubId, status) {
    return this._toDtos(clubId, await memberApplicationsRepository.listByClub(clubId, status || null));
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
   * manual) + los grupos y la fecha de ingreso que elige quien revisa. */
  async approve(clubId, id, { groupIds = [], joinedOn = null } = {}, actorId) {
    const app = await this._pending(clubId, id);
    if (groupIds.length) {
      const found = await memberGroupsRepository.findByIds(groupIds, clubId);
      if (found.length !== groupIds.length) throw AppError.badRequest('Uno o más grupos no pertenecen a este club.');
    }
    const member = await membersService.create(
      clubId,
      { fields: this._parseFields(app), status: 'active', groupIds, joinedOn: joinedOn || toDateOnly(new Date()) },
      actorId,
      { publicOnly: true }
    );
    // Las imágenes y archivos enviados pasan a la ficha recién creada.
    await membersService.attachUploads(clubId, member.id, await this._uploadsOf(clubId, id), actorId);
    await memberApplicationsRepository.deleteFiles(id);
    await memberApplicationsRepository.markReviewed(id, { status: 'approved', reviewedBy: actorId, memberId: member.id });
    await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_APPLICATION_APPROVED', entityType: 'member_application', entityId: id, changes: { memberId: member.id } });
    this._notifyApplicant(clubId, app, 'approved');
    return { memberId: member.id };
  }

  async reject(clubId, id, { reason } = {}, actorId) {
    const app = await this._pending(clubId, id);
    // Datos personales de alguien que no entra al club: los archivos se borran.
    for (const f of await memberApplicationsRepository.findFiles([id])) deletePrivateFile(f.file_path);
    await memberApplicationsRepository.deleteFiles(id);
    await memberApplicationsRepository.markReviewed(id, { status: 'rejected', reviewedBy: actorId, reviewNote: reason ? String(reason).slice(0, 255) : null });
    await auditRepository.logAction({ userId: actorId, clubId, action: 'MEMBER_APPLICATION_REJECTED', entityType: 'member_application', entityId: id, changes: reason ? { reason } : null });
    this._notifyApplicant(clubId, app, 'rejected', reason);
  }

  /**
   * Correo a quien postuló avisando si fue aceptada o no (si dejó un correo en el campo con uso
   * "correo"). Mejor esfuerzo: nunca hace fallar la revisión.
   */
  _notifyApplicant(clubId, app, outcome, reason = null) {
    (async () => {
      const catalog = await memberFieldsRepository.findByClub(clubId);
      const emailField = catalog.find((f) => f.role === 'email');
      const fields = this._parseFields(app);
      const to = emailField ? String(fields[emailField.code] || '').trim() : '';
      if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return;
      const firstName = fields[catalog.find((f) => f.role === 'first_name')?.code] || '';
      const club = await clubsRepository.findById(clubId);
      const brand = { name: club.name, primaryColor: club.primary_color, logoUrl: toAbsoluteMediaUrl(club.logo_url) };
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
      const hello = firstName ? `Hola ${esc(firstName)},` : 'Hola,';
      if (outcome === 'approved') {
        await emailService.send({
          to,
          subject: `¡Bienvenido/a a ${club.name}!`,
          html: renderClubEmail({
            club: brand,
            title: `¡Tu inscripción en ${club.name} fue aceptada!`,
            bodyHtml: `<p>${hello}</p><p>Revisamos tu solicitud y ya eres parte de <strong>${esc(club.name)}</strong>. Pronto te contactaremos con los próximos pasos.</p>`,
          }),
        });
      } else {
        await emailService.send({
          to,
          subject: `Tu solicitud de inscripción en ${club.name}`,
          html: renderClubEmail({
            club: brand,
            title: 'Sobre tu solicitud de inscripción',
            bodyHtml: `<p>${hello}</p><p>Revisamos tu solicitud para <strong>${esc(club.name)}</strong> y por ahora no pudimos aceptarla.</p>${reason ? `<p><strong>Motivo:</strong> ${esc(reason)}</p>` : ''}<p>Si tienes dudas, contacta directamente al club.</p>`,
          }),
        });
      }
    })().catch((error) => logger.error(`[memberApplications] correo al postulante: ${error.message}`));
  }
}

module.exports = new MemberApplicationsService();
