const invitationsRepository = require('../repositories/invitations.repository');
const rolesRepository = require('../repositories/roles.repository');
const auditRepository = require('../repositories/audit.repository');
const memberFormsService = require('./memberForms.service');
const AppError = require('../helpers/AppError');
const { parsePagination, buildMeta } = require('../helpers/pagination');
const { generateShortCode } = require('../helpers/tokenUtils');
const env = require('../config/env');
const permissionService = require('./permission.service');
const { FUNCTIONS } = require('../config/constants');

const SORTABLE = ['created_at', 'expires_at', 'uses_count', 'status'];

/**
 * Invitaciones del club (sql/072). Cada una configura por separado:
 *  - `requiresAccount`: exige crear una cuenta / iniciar sesión e ingresar al club (el flujo de
 *    siempre: código en "Unirse a un club" o su enlace `/join?code=`).
 *  - `formIds`: fichas que pide completar. Con cuenta, quedan pendientes al entrar (como el viejo
 *    "exigir ficha"); sin cuenta, se responden directo en su enlace público `/inscripcion/<código>`
 *    sin sesión y quedan como solicitud (memberApplications.service.js#submit).
 * Al menos una de las dos (una invitación sin cuenta ni fichas no serviría para nada). El límite de
 * usos y la expiración aplican igual a ambos tipos: un uso = una cuenta que entra o una solicitud.
 */
class InvitationsService {
  toDto(row, forms = []) {
    const requiresAccount = row.requires_account === undefined ? true : !!row.requires_account;
    return {
      id: row.id,
      uuid: row.uuid,
      clubId: row.club_id,
      code: row.code,
      maxUses: row.max_uses,
      usesCount: row.uses_count,
      expiresAt: row.expires_at,
      status: row.status,
      defaultRoleId: row.default_role_id,
      requiresAccount,
      formIds: forms.map((f) => f.id),
      forms,
      requiresMemberProfile: forms.length > 0,
      note: row.note,
      createdBy: row.created_by,
      creatorName: row.creator_username ?? null,
      createdAt: row.created_at,
      // Con cuenta: el flujo de ingreso al club. Sin cuenta: el formulario público de las fichas.
      shareUrl: requiresAccount ? `${env.clientUrl}/join?code=${row.code}` : `${env.clientUrl}/inscripcion/${row.code}`,
    };
  }

  async _dto(id) {
    const row = await invitationsRepository.findById(id);
    return this.toDto(row, (await invitationsRepository.findFormsFor([id]))[id] || []);
  }

  /**
   * ¿Se puede usar ahora? Lanza el motivo (y deja el estado al día si expiró o se agotó). La usan
   * el ingreso por código (clubs.service.js#joinByCode) y el enlace público. El chequeo de usos
   * se repite de forma atómica al consumir el uso (`claimUse`).
   */
  async assertUsable(invitation) {
    if (!invitation) throw AppError.notFound('Código de invitación inválido.');
    if (invitation.status === 'revoked') throw AppError.badRequest('Esta invitación fue deshabilitada por el club.');
    if (invitation.status === 'exhausted') throw AppError.badRequest('Esta invitación ya alcanzó su límite de usos.');
    if (invitation.status === 'expired') throw AppError.badRequest('Esta invitación ha expirado.');
    if (invitation.status !== 'active') throw AppError.badRequest('Esta invitación ya no está activa.');
    if (invitation.expires_at && new Date(invitation.expires_at) < new Date()) {
      await invitationsRepository.setStatus(invitation.id, 'expired');
      throw AppError.badRequest('Esta invitación ha expirado.');
    }
    if (invitation.max_uses && invitation.uses_count >= invitation.max_uses) {
      await invitationsRepository.setStatus(invitation.id, 'exhausted');
      throw AppError.badRequest('Esta invitación ya alcanzó su límite de usos.');
    }
  }

  /** Elegir el rol con el que entrará quien use la invitación es, en la práctica, asignar un
   * rol: exige ASSIGN_USER_ROLES. Devuelve el rol ya validado, o `fallback` si el actor no lo tiene
   * (se ignora lo que haya mandado el cliente en vez de confiar en que el frontend ocultó el selector). */
  async _resolveDefaultRole(clubId, actorId, requestedRoleId, fallback = null) {
    const authContext = await permissionService.buildAuthorizationContext(actorId, clubId);
    if (!permissionService.hasFunction(authContext, FUNCTIONS.ASSIGN_USER_ROLES)) return fallback;
    if (!requestedRoleId) return null;
    const role = await rolesRepository.findById(requestedRoleId);
    if (!role || role.club_id !== clubId) throw AppError.badRequest('El rol predeterminado no pertenece a este club.');
    return requestedRoleId;
  }

  /**
   * Cuenta + fichas ya validadas. `formIds` sin indicar: se respeta el viejo `requiresMemberProfile`
   * (→ las fichas por defecto) o, al editar, las que ya pedía. Caso inválido: ni cuenta ni fichas.
   */
  async _resolveConfig(clubId, { requiresAccount, formIds, requiresMemberProfile }, current = null) {
    const account = requiresAccount === undefined ? (current ? !!current.requires_account : true) : !!requiresAccount;
    let forms = await memberFormsService.resolveIds(clubId, formIds);
    if (forms === null) {
      if (requiresMemberProfile !== undefined) forms = requiresMemberProfile ? await memberFormsService.defaultIds(clubId) : [];
      else forms = current ? await invitationsRepository.findFormIds(current.id) : [];
    }
    if (!account && !forms.length) {
      throw AppError.unprocessable('La invitación debe pedir crear una cuenta, completar al menos una ficha, o ambas cosas.');
    }
    return { account, forms };
  }

  async update(clubId, invitationId, { maxUses, expiresAt, defaultRoleId, note, requiresAccount, formIds, requiresMemberProfile }, actorId) {
    const invitation = await invitationsRepository.findById(invitationId);
    if (!invitation || invitation.club_id !== clubId) throw AppError.notFound('Invitación no encontrada.');

    const newMaxUses = maxUses || null;
    const newExpiresAt = expiresAt ? new Date(expiresAt) : null;
    if (newMaxUses !== null && newMaxUses < invitation.uses_count) {
      throw AppError.unprocessable(`Los usos máximos no pueden ser menores a los ya realizados (${invitation.uses_count}).`);
    }
    const { account, forms } = await this._resolveConfig(clubId, { requiresAccount, formIds, requiresMemberProfile }, invitation);
    const previousForms = await invitationsRepository.findFormIds(invitationId);

    // Si el actor no puede asignar roles, el rol de la invitación se conserva tal cual. Sin cuenta
    // no hay a quién asignárselo.
    const newRoleId = account ? await this._resolveDefaultRole(clubId, actorId, defaultRoleId, invitation.default_role_id) : null;

    // 'revoked' es una decisión explícita (solo se cambia con reactivate). Para el resto, el
    // estado se recalcula con los nuevos límites: p. ej. subir `maxUses` de una agotada la
    // reactiva, y bajar la expiración al pasado la marca 'expired'.
    let status = invitation.status;
    if (status !== 'revoked') {
      if (newExpiresAt && newExpiresAt < new Date()) status = 'expired';
      else if (newMaxUses !== null && invitation.uses_count >= newMaxUses) status = 'exhausted';
      else status = 'active';
    }

    await invitationsRepository.updateFields(invitationId, {
      maxUses: newMaxUses,
      expiresAt: newExpiresAt,
      defaultRoleId: newRoleId,
      requiresAccount: account ? 1 : 0,
      requiresMemberProfile: forms.length ? 1 : 0,
      note: note || null,
      status,
    });
    await invitationsRepository.setForms(invitationId, forms);

    // Quienes ya entraron con este código y aún no completan sus fichas pasan a tener pendientes
    // las nuevas (o ninguna, si dejó de pedirlas). La marca vive en su membresía (clubEntry.service.js).
    if (previousForms.join(',') !== forms.join(',')) await invitationsRepository.syncPendingForms(invitationId, clubId, forms);

    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'INVITATION_UPDATED',
      entityType: 'invitation',
      entityId: invitationId,
      changes: {
        maxUses: { from: invitation.max_uses, to: newMaxUses },
        expiresAt: { from: invitation.expires_at, to: newExpiresAt },
        ...(account !== !!invitation.requires_account ? { requiresAccount: { from: !!invitation.requires_account, to: account } } : {}),
        ...(previousForms.join(',') !== forms.join(',') ? { forms: { from: previousForms.length, to: forms.length } } : {}),
        ...(status !== invitation.status ? { status: { from: invitation.status, to: status } } : {}),
      },
    });

    return this._dto(invitationId);
  }

  async create(clubId, { maxUses, expiresAt, defaultRoleId, note, requiresAccount, formIds, requiresMemberProfile }, actorId) {
    const { account, forms } = await this._resolveConfig(clubId, { requiresAccount, formIds, requiresMemberProfile });
    // Elegir el rol con el que entrará quien use la invitación es, en la práctica,
    // asignar un rol: exige el mismo permiso (ASSIGN_USER_ROLES) que hacerlo a mano
    // desde el perfil de un usuario. Si el actor no lo tiene, se ignora lo que haya
    // mandado el cliente en vez de confiar en que el frontend ocultó el selector.
    defaultRoleId = account ? await this._resolveDefaultRole(clubId, actorId, defaultRoleId) : null;

    let code;
    do {
      code = generateShortCode(10);
      // eslint-disable-next-line no-await-in-loop
    } while (await invitationsRepository.findByCode(code));

    const id = await invitationsRepository.createInvitation({
      clubId,
      code,
      createdBy: actorId,
      maxUses: maxUses || null,
      expiresAt: expiresAt || null,
      status: 'active',
      defaultRoleId: defaultRoleId || null,
      requiresAccount: account ? 1 : 0,
      requiresMemberProfile: forms.length ? 1 : 0,
      note: note || null,
    });
    await invitationsRepository.setForms(id, forms);

    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'INVITATION_CREATED',
      entityType: 'invitation',
      entityId: id,
      changes: { maxUses: maxUses || null, expiresAt: expiresAt || null, requiresAccount: account, forms: forms.length },
    });

    return this._dto(id);
  }

  async listForClub(clubId, query) {
    const { limit, offset, sortBy, sortOrder, page } = parsePagination(query, SORTABLE);
    await invitationsRepository.expireOutdated();
    const { rows, total } = await invitationsRepository.paginateByClub(clubId, { limit, offset, sortBy, sortOrder, status: query.status });
    const forms = await invitationsRepository.findFormsFor(rows.map((r) => r.id));
    return { items: rows.map((r) => this.toDto(r, forms[r.id] || [])), meta: buildMeta({ page, limit, total }) };
  }

  async revoke(clubId, invitationId, actorId) {
    const invitation = await invitationsRepository.findById(invitationId);
    if (!invitation || invitation.club_id !== clubId) throw AppError.notFound('Invitación no encontrada.');
    if (invitation.status !== 'active') throw AppError.conflict('Esta invitación ya no está activa.');

    await invitationsRepository.setStatus(invitationId, 'revoked');
    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'INVITATION_REVOKED',
      entityType: 'invitation',
      entityId: invitationId,
      changes: { status: { from: invitation.status, to: 'revoked' } },
    });
  }

  async reactivate(clubId, invitationId, actorId) {
    const invitation = await invitationsRepository.findById(invitationId);
    if (!invitation || invitation.club_id !== clubId) throw AppError.notFound('Invitación no encontrada.');
    if (invitation.status !== 'revoked') throw AppError.conflict('Solo se puede reactivar una invitación revocada.');
    if (invitation.expires_at && new Date(invitation.expires_at) < new Date()) {
      throw AppError.conflict('Esta invitación ya expiró; crea una nueva en su lugar.');
    }

    await invitationsRepository.setStatus(invitationId, 'active');
    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'INVITATION_REACTIVATED',
      entityType: 'invitation',
      entityId: invitationId,
      changes: { status: { from: 'revoked', to: 'active' } },
    });
  }

  async remove(clubId, invitationId, actorId) {
    const invitation = await invitationsRepository.findById(invitationId);
    if (!invitation || invitation.club_id !== clubId) throw AppError.notFound('Invitación no encontrada.');
    // Una invitación activa se revoca primero (mismo criterio que `revoke()` a la inversa): no
    // se permite borrar de un tirón algo que todavía se puede estar usando para unirse al club.
    if (invitation.status === 'active') throw AppError.conflict('Revoca la invitación antes de eliminarla.');

    await invitationsRepository.deleteById(invitationId);
    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'INVITATION_DELETED',
      entityType: 'invitation',
      entityId: invitationId,
      changes: { status: invitation.status },
    });
  }
}

module.exports = new InvitationsService();
