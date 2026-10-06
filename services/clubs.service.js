const clubsRepository = require('../repositories/clubs.repository');
const usersRepository = require('../repositories/users.repository');
const membersRepository = require('../repositories/members.repository');
const rolesRepository = require('../repositories/roles.repository');
const settingsRepository = require('../repositories/settings.repository');
const joinRequestsRepository = require('../repositories/joinRequests.repository');
const invitationsRepository = require('../repositories/invitations.repository');
const auditRepository = require('../repositories/audit.repository');
const rolesService = require('./roles.service');
const membersService = require('./members.service');
const AppError = require('../helpers/AppError');
const { withTransaction } = require('../config/database');
const { parsePagination, buildMeta } = require('../helpers/pagination');
const slugify = require('../utils/slugify');
const { toAbsoluteMediaUrl } = require('../helpers/mediaUrl');
const { CLUB_STATUS, USER_CLUB_STATUS, JOIN_REQUEST_STATUS } = require('../config/constants');
const { diffValue, buildDiff } = require('../helpers/auditDiff');

const PUBLIC_CODE_REGEX = /^[A-Za-z0-9](?:[A-Za-z0-9-]{1,38})[A-Za-z0-9]$/;
const platformSettingsRepository = require('../repositories/platformSettings.repository');
const treasuryAccountsRepository = require('../repositories/treasuryAccounts.repository');
const memberFieldsService = require('./memberFields.service');
const { DEFAULT_TREASURY_ACCOUNT_NAME } = require('../helpers/paymentAccount');
const { showLogoOnBanner, setShowLogoOnBanner } = require('../helpers/clubBranding');

const SORTABLE = ['created_at', 'name', 'status'];
const permissionService = require('./permission.service');
const { FUNCTIONS } = require('../config/constants');

const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CL')}`;
const amountOf = (changes) => {
  const v = changes && typeof changes === 'object' ? changes.amount : null;
  const n = v && typeof v === 'object' ? v.to ?? v.value : v;
  return Number(n) > 0 ? ` de ${clp(n)}` : '';
};
/** Frase (sin el autor delante) y tipo de cada evento de la actividad del dashboard. */
const ACTIVITY_TEXT = {
  PAYMENT_CREATED: (name, ch) => ['payment', `registró un pago${amountOf(ch)}${name ? ` de ${name}` : ''}`],
  PAYMENT_PROOF_SUBMITTED: () => ['proof', 'Llegó un comprobante de pago por revisar'],
  PAYMENT_PROOF_APPROVED: () => ['proof', 'aprobó un comprobante de pago'],
  MEMBER_CREATED: (name) => ['member', `agregó a ${name ?? 'un miembro'}`],
  MEMBER_APPLICATION_SUBMITTED: (name) => ['application', `Nueva solicitud de inscripción${name ? ` de ${name}` : ''}`],
  MEMBER_APPLICATION_APPROVED: (name) => ['application', `aceptó la solicitud${name ? ` de ${name}` : ''}`],
  EXPENSE_PAYMENT_CREATED: (name) => ['expense', `pagó el gasto ${name ?? ''}`.trim()],
  CHARGE_CREATED: (name) => ['charge', `creó el cobro ${name ?? ''}`.trim()],
};

class ClubsService {
  toDto(club) {
    return {
      id: club.id,
      uuid: club.uuid,
      name: club.name,
      publicCode: club.public_code,
      description: club.description,
      logoUrl: toAbsoluteMediaUrl(club.logo_url),
      bannerUrl: toAbsoluteMediaUrl(club.banner_url),
      primaryColor: club.primary_color,
      secondaryColor: club.secondary_color,
      theme: club.theme,
      timezone: club.timezone,
      status: club.status,
      isPublic: !!club.is_public,
      createdAt: club.created_at,
    };
  }

  /** `excludeClubId`: al regenerar por un cambio de nombre, el propio código viejo del club
   * no debe contar como "ocupado" (si no, un club nunca podría volver a un slug que ya tenía
   * antes de un cambio de nombre previo, ni renombrarse a algo que solo difiere en mayúsculas). */
  async _generateUniquePublicCode(name, excludeClubId = null) {
    const base = slugify(name) || 'club';
    let candidate = base;
    let suffix = 1;
    // eslint-disable-next-line no-await-in-loop
    while (await clubsRepository.publicCodeExists(candidate, excludeClubId)) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }
    return candidate;
  }

  /**
   * Código público personalizado (el de `/pay/<código>`): 3 a 40 caracteres, letras, números y
   * guiones (sin guion al inicio/fin). Se guarda tal cual se escribe, pero la unicidad no distingue
   * mayúsculas (la columna es case-insensitive: "Trawen" y "trawen" serían el mismo enlace).
   */
  _assertPublicCodeFormat(code) {
    if (!PUBLIC_CODE_REGEX.test(code)) {
      throw AppError.badRequest('El código debe tener entre 3 y 40 caracteres: letras, números y guiones (sin guion al inicio ni al final).');
    }
  }

  /** ¿Está libre este código? (para validar mientras se escribe). `excludeClubId`: el propio club. */
  async checkPublicCode(code, excludeClubId) {
    const value = String(code ?? '').trim();
    if (!PUBLIC_CODE_REGEX.test(value)) return { code: value, valid: false, available: false };
    return { code: value, valid: true, available: !(await clubsRepository.publicCodeExists(value, excludeClubId)) };
  }

  async create({ name, description, primaryColor, secondaryColor, theme, isPublic, timezone }, creatorId) {
    const publicCode = await this._generateUniquePublicCode(name);
    // El frontend manda la zona horaria detectada del DISPOSITIVO de quien crea el club
    // (Intl.DateTimeFormat().resolvedOptions().timeZone) — si por lo que sea no llega (llamada
    // directa a la API, frontend viejo, o el navegador no pudo detectarla), se cae a la zona
    // configurada a nivel de plataforma en vez de un UTC a secas sin criterio.
    const resolvedTimezone = timezone || (await platformSettingsRepository.get())?.timezone || 'UTC';

    const clubId = await withTransaction(async (conn) => {
      const id = await clubsRepository.createClub(
        {
          name,
          publicCode,
          description: description || null,
          primaryColor: primaryColor || '#4F46E5',
          secondaryColor: secondaryColor || '#22C55E',
          theme: theme || 'auto',
          timezone: resolvedTimezone,
          status: CLUB_STATUS.ACTIVE,
          isPublic: isPublic === false ? 0 : 1,
          createdBy: creatorId,
        },
        conn
      );

      const adminRoleId = await rolesService.seedDefaultRolesForClub(id, conn);
      // Todo club parte con una cuenta de Tesorería (sin datos) — ver treasuryAccounts.service.js.
      await treasuryAccountsRepository.create(id, { name: DEFAULT_TREASURY_ACCOUNT_NAME, bankName: null, accountType: null, accountNumber: null, holderName: null, holderRut: null, email: null, notes: null }, conn);
      // Ficha de miembro precargada con los campos sugeridos (100% editable desde Configuración).
      await memberFieldsService.addSuggested(id, null, conn);
      await usersRepository.clearDefaultClub(creatorId, conn);
      await usersRepository.addToClub({ userId: creatorId, clubId: id, status: USER_CLUB_STATUS.ACTIVE, isDefault: true }, conn);
      if (adminRoleId) {
        await rolesRepository.assignToUser({ userId: creatorId, roleId: adminRoleId, clubId: id, assignedBy: creatorId }, conn);
      }
      await usersRepository.setDefaultClub(creatorId, id, conn);

      return id;
    });

    await auditRepository.logAction({ userId: creatorId, clubId, action: 'CLUB_CREATED', entityType: 'club', entityId: clubId, changes: { name } });

    return this.toDto(await clubsRepository.findActiveById(clubId));
  }

  async getById(clubId) {
    const club = await clubsRepository.findActiveById(clubId);
    if (!club) throw AppError.notFound('Club no encontrado.');
    return { ...this.toDto(club), showLogoOnBanner: await showLogoOnBanner(clubId) };
  }

  async update(clubId, data, actorId) {
    const club = await clubsRepository.findActiveById(clubId);
    if (!club) throw AppError.notFound('Club no encontrado.');

    const updates = {};
    if (data.name !== undefined && data.name !== club.name) {
      updates.name = data.name;
    }
    if (data.publicCode !== undefined) {
      const code = String(data.publicCode).trim();
      if (code !== club.public_code) {
        this._assertPublicCodeFormat(code);
        if (await clubsRepository.publicCodeExists(code, clubId)) {
          throw AppError.conflict(`El código "${code}" ya está en uso por otro club. Elige uno distinto.`);
        }
        updates.public_code = code;
      }
    }
    if (data.description !== undefined) updates.description = data.description;
    if (data.primaryColor !== undefined) updates.primary_color = data.primaryColor;
    if (data.secondaryColor !== undefined) updates.secondary_color = data.secondaryColor;
    if (data.theme !== undefined) updates.theme = data.theme;
    if (data.timezone !== undefined) updates.timezone = data.timezone;
    if (data.isPublic !== undefined) updates.is_public = data.isPublic ? 1 : 0;
    if (data.logoUrl !== undefined) updates.logo_url = data.logoUrl;
    if (data.bannerUrl !== undefined) updates.banner_url = data.bannerUrl;

    if (Object.keys(updates).length) {
      await clubsRepository.updateById(clubId, updates);
    }
    let logoChange;
    if (data.showLogoOnBanner !== undefined) {
      const before = await showLogoOnBanner(clubId);
      if (before !== !!data.showLogoOnBanner) {
        await setShowLogoOnBanner(clubId, !!data.showLogoOnBanner);
        logoChange = diffValue(before, !!data.showLogoOnBanner);
      }
    }

    const changes = buildDiff({
      name: updates.name !== undefined ? diffValue(club.name, updates.name) : undefined,
      publicCode: updates.public_code !== undefined ? diffValue(club.public_code, updates.public_code) : undefined,
      description: updates.description !== undefined ? diffValue(club.description, updates.description) : undefined,
      primaryColor: updates.primary_color !== undefined ? diffValue(club.primary_color, updates.primary_color) : undefined,
      secondaryColor: updates.secondary_color !== undefined ? diffValue(club.secondary_color, updates.secondary_color) : undefined,
      theme: updates.theme !== undefined ? diffValue(club.theme, updates.theme) : undefined,
      timezone: updates.timezone !== undefined ? diffValue(club.timezone, updates.timezone) : undefined,
      isPublic: updates.is_public !== undefined ? diffValue(!!club.is_public, !!updates.is_public) : undefined,
      showLogoOnBanner: logoChange,
    });
    // Si se envió el formulario sin cambiar nada, no queda nada que auditar — evita
    // ensuciar el historial con "Actualizó la información del club" sin ningún detalle.
    if (changes) {
      await auditRepository.logAction({ userId: actorId, clubId, action: 'CLUB_UPDATED', entityType: 'club', entityId: clubId, changes });
    }

    return this.getById(clubId);
  }

  async remove(clubId, actorId) {
    const club = await clubsRepository.findActiveById(clubId);
    if (!club) throw AppError.notFound('Club no encontrado.');
    await clubsRepository.softDelete(clubId);
    await auditRepository.logAction({ userId: actorId, clubId, action: 'CLUB_DELETED', entityType: 'club', entityId: clubId, changes: { name: club.name } });
  }

  async listPublic(query) {
    const { limit, offset, page } = parsePagination(query, ['name']);
    const { rows, total } = await clubsRepository.paginatePublic({ limit, offset, search: query.search });
    return {
      items: rows.map((r) => ({
        id: r.id,
        uuid: r.uuid,
        name: r.name,
        publicCode: r.public_code,
        description: r.description,
        logoUrl: toAbsoluteMediaUrl(r.logo_url),
        bannerUrl: toAbsoluteMediaUrl(r.banner_url),
        primaryColor: r.primary_color,
        secondaryColor: r.secondary_color,
      })),
      meta: buildMeta({ page, limit, total }),
    };
  }

  async listAll(query) {
    const { limit, offset, sortBy, sortOrder, page } = parsePagination(query, SORTABLE);
    const { rows, total } = await clubsRepository.paginateAll({ limit, offset, sortBy, sortOrder, search: query.search, status: query.status });
    return { items: rows.map((r) => this.toDto(r)), meta: buildMeta({ page, limit, total }) };
  }

  async getStats(clubId, authContext = null) {
    const [usersCount, activeMembersCount, invitationsCount, joins, events] = await Promise.all([
      clubsRepository.countUsers(clubId),
      membersRepository.countByClubAndStatus(clubId, 'active'),
      clubsRepository.countActiveInvitations(clubId),
      auditRepository.recentActivity(clubId, 10),
      this._activityEvents(clubId, authContext),
    ]);
    // Actividad = uniones al club (activity_logs) + lo que pasa en el día a día (pagos,
    // comprobantes, solicitudes, altas), lo más reciente primero.
    const recentActivity = [...joins.map((j) => ({ ...j, kind: 'join' })), ...events]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 10)
      .map((entry) => ({ ...entry, avatar_url: toAbsoluteMediaUrl(entry.avatar_url) }));
    return { usersCount, activeMembersCount, invitationsCount, recentActivity };
  }

  /** Eventos de audit_logs para la actividad del dashboard, solo de los módulos que el actor puede ver. */
  async _activityEvents(clubId, authContext) {
    const can = (codes) => !authContext || permissionService.hasAnyFunction(authContext, codes);
    const actions = [];
    if (can([FUNCTIONS.VIEW_PAYMENTS])) actions.push('PAYMENT_CREATED', 'PAYMENT_PROOF_SUBMITTED', 'PAYMENT_PROOF_APPROVED');
    if (can([FUNCTIONS.VIEW_MEMBERS])) actions.push('MEMBER_CREATED', 'MEMBER_APPLICATION_SUBMITTED', 'MEMBER_APPLICATION_APPROVED');
    if (can([FUNCTIONS.VIEW_EXPENSES])) actions.push('EXPENSE_PAYMENT_CREATED');
    if (can([FUNCTIONS.VIEW_CHARGES])) actions.push('CHARGE_CREATED');
    if (!actions.length) return [];
    const rows = await auditRepository.recentByActions(clubId, actions, 10);
    return rows.map((r) => {
      const [kind, description] = ACTIVITY_TEXT[r.action](r.entity_name, r.changes);
      return { id: `a${r.id}`, user_id: r.user_id, username: r.username, avatar_url: r.avatar_url, description, created_at: r.created_at, kind };
    });
  }

  /**
   * Une a un usuario a un club usando una invitación (tabla `invitations`). Una invitación
   * creada sin `maxUses` ni `expiresAt` es, en la práctica, un código "permanente" (uso
   * ilimitado, nunca expira — ver `claimUse`/`expireOutdated` en `invitations.repository.js`,
   * que solo actúan cuando esos campos no son NULL): no hace falta un mecanismo aparte para eso.
   */
  async joinByCode(rawCode, userId) {
    const code = rawCode.trim().toUpperCase();
    const invitation = await invitationsRepository.findByCode(code);
    if (!invitation) throw AppError.notFound('Código de invitación inválido.');
    if (invitation.status !== 'active') throw AppError.badRequest('Esta invitación ya no está activa.');
    if (invitation.expires_at && new Date(invitation.expires_at) < new Date()) {
      await invitationsRepository.setStatus(invitation.id, 'expired');
      throw AppError.badRequest('Esta invitación ha expirado.');
    }
    if (invitation.max_uses && invitation.uses_count >= invitation.max_uses) {
      await invitationsRepository.setStatus(invitation.id, 'exhausted');
      throw AppError.badRequest('Esta invitación ya alcanzó su límite de usos.');
    }

    const club = await clubsRepository.findActiveById(invitation.club_id);
    if (!club) throw AppError.notFound('Código de invitación inválido.');
    if (club.status !== CLUB_STATUS.ACTIVE) throw AppError.forbidden('Este club no está activo.');

    const existing = await usersRepository.findMembership(userId, club.id);
    if (existing && existing.status === USER_CLUB_STATUS.ACTIVE) {
      throw AppError.conflict('Ya perteneces a este club.');
    }

    // Sin fallback a "Socio": si la invitación no trae un rol explícito, quien se une entra sin
    // roles hasta que un admin se los asigne.
    const roleIdToAssign = invitation.default_role_id;
    const clubsCountBefore = await usersRepository.countClubsForUser(userId);

    await withTransaction(async (conn) => {
      // La validación de "¿tiene usos disponibles?" de más arriba se hizo con datos leídos
      // ANTES de esta transacción — bajo concurrencia (dos usuarios canjeando el mismo código
      // de un solo uso al mismo tiempo) ambos podían pasarla. `claimUse` repite la validación
      // de forma atómica contra el estado real al momento de escribir; si pierde la carrera,
      // aborta toda la operación (incluida la membresía) en vez de sumar un miembro de más.
      const claimed = await invitationsRepository.claimUse(invitation.id, conn);
      if (!claimed) {
        // `claimUse` puede fallar por dos motivos distintos (agotó sus usos, o alguien más la
        // revocó/expiró en el instante entre la lectura de arriba y este punto) — se relee el
        // estado real para no decirle siempre "sin usos disponibles" cuando la causa fue otra.
        const current = await invitationsRepository.findByCode(code, conn);
        const reason =
          current?.status === 'active' || !current?.status ? 'ya no tiene usos disponibles' : 'ya no está activa';
        throw AppError.badRequest(`Esta invitación ${reason}.`);
      }

      await usersRepository.addToClub({ userId, clubId: club.id, status: USER_CLUB_STATUS.ACTIVE, isDefault: clubsCountBefore === 0 }, conn);
      // Volver a unirse tras haber sido retirado también reactiva su ficha si el retiro la archivó.
      if (existing?.status === USER_CLUB_STATUS.WITHDRAWN) {
        const member = await membersRepository.findByUserId(userId, club.id, conn);
        if (member) await membersService.applyStatus(member, 'active', userId, conn);
      }
      if (invitation.requires_member_profile) {
        await usersRepository.setRequiresProfileCompletion(userId, club.id, true, conn);
      }
      if (roleIdToAssign) {
        await rolesRepository.assignToUser({ userId, roleId: roleIdToAssign, clubId: club.id, assignedBy: userId }, conn);
      }
      if (clubsCountBefore === 0) await usersRepository.setDefaultClub(userId, club.id, conn);
      await invitationsRepository.recordUse({ invitationId: invitation.id, userId }, conn);
    });

    await auditRepository.logActivity({ userId, clubId: club.id, description: 'Se unió al club mediante código de invitación' });

    return this.toDto(club);
  }

  async requestAccess(clubId, userId, message) {
    const club = await clubsRepository.findActiveById(clubId);
    if (!club) throw AppError.notFound('Club no encontrado.');
    if (!club.is_public) throw AppError.forbidden('Este club no acepta solicitudes públicas de acceso.');

    const membership = await usersRepository.findMembership(userId, clubId);
    if (membership && membership.status === USER_CLUB_STATUS.ACTIVE) throw AppError.conflict('Ya perteneces a este club.');

    const pending = await joinRequestsRepository.findPending(userId, clubId);
    if (pending) throw AppError.conflict('Ya tienes una solicitud pendiente para este club.');

    const id = await joinRequestsRepository.createRequest({ userId, clubId, message });
    await auditRepository.logActivity({ userId, clubId, description: 'Solicitó acceso al club' });
    return { id };
  }

  async listJoinRequests(clubId, query) {
    const { limit, offset, page } = parsePagination(query, ['created_at']);
    const { rows, total } = await joinRequestsRepository.paginateByClub(clubId, { limit, offset, status: query.status, search: query.search });
    return {
      items: rows.map((r) => ({ ...r, avatar_url: toAbsoluteMediaUrl(r.avatar_url) })),
      meta: buildMeta({ page, limit, total }),
    };
  }

  async resolveJoinRequest(clubId, requestId, status, actorId) {
    const request = await joinRequestsRepository.findById(requestId);
    if (!request || request.club_id !== clubId) throw AppError.notFound('Solicitud no encontrada.');
    if (request.status !== JOIN_REQUEST_STATUS.PENDING) throw AppError.conflict('Esta solicitud ya fue resuelta.');

    await withTransaction(async (conn) => {
      await joinRequestsRepository.resolve({ id: requestId, status, reviewedBy: actorId }, conn);
      if (status === JOIN_REQUEST_STATUS.APPROVED) {
        // Mismo criterio que joinByCode: sin rol por defecto ("Socio" no existe en el seed de
        // ningún club, ver defaultClubRoles.js) — entra sin roles hasta que un admin se los asigne.
        await usersRepository.addToClub({ userId: request.user_id, clubId, status: USER_CLUB_STATUS.ACTIVE, isDefault: false }, conn);
      }
    });

    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: `JOIN_REQUEST_${status.toUpperCase()}`,
      entityType: 'join_request',
      entityId: requestId,
      changes: request.message ? { message: request.message } : null,
    });
  }

  async getSettings(clubId) {
    return settingsRepository.findAllByClub(clubId);
  }

  async updateSettings(clubId, settings, actorId) {
    const previous = await settingsRepository.findAllByClub(clubId);
    await settingsRepository.upsertMany(clubId, settings);

    const changes = buildDiff(
      Object.fromEntries(Object.keys(settings).map((key) => [key, diffValue(previous[key] ?? null, String(settings[key]))]))
    );
    if (changes) {
      await auditRepository.logAction({ userId: actorId, clubId, action: 'CLUB_SETTINGS_UPDATED', entityType: 'club_settings', entityId: clubId, changes });
    }
    return this.getSettings(clubId);
  }
}

module.exports = new ClubsService();
