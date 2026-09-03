const clubsRepository = require('../repositories/clubs.repository');
const usersRepository = require('../repositories/users.repository');
const rolesRepository = require('../repositories/roles.repository');
const settingsRepository = require('../repositories/settings.repository');
const joinRequestsRepository = require('../repositories/joinRequests.repository');
const invitationsRepository = require('../repositories/invitations.repository');
const auditRepository = require('../repositories/audit.repository');
const rolesService = require('./roles.service');
const AppError = require('../helpers/AppError');
const { withTransaction } = require('../config/database');
const { parsePagination, buildMeta } = require('../helpers/pagination');
const { generateShortCode } = require('../helpers/tokenUtils');
const slugify = require('../utils/slugify');
const { toAbsoluteMediaUrl } = require('../helpers/mediaUrl');
const { CLUB_STATUS, USER_CLUB_STATUS, JOIN_REQUEST_STATUS } = require('../config/constants');
const { diffValue, buildDiff } = require('../helpers/auditDiff');
const platformSettingsRepository = require('../repositories/platformSettings.repository');

const SORTABLE = ['created_at', 'name', 'status'];

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
      inviteCode: club.invite_code,
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

  async create({ name, description, primaryColor, secondaryColor, theme, isPublic, timezone }, creatorId) {
    const publicCode = await this._generateUniquePublicCode(name);
    const inviteCode = generateShortCode(8);
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
          inviteCode,
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
    return this.toDto(club);
  }

  async update(clubId, data, actorId) {
    const club = await clubsRepository.findActiveById(clubId);
    if (!club) throw AppError.notFound('Club no encontrado.');

    const updates = {};
    if (data.name !== undefined && data.name !== club.name) {
      updates.name = data.name;
      updates.public_code = await this._generateUniquePublicCode(data.name, clubId);
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

    const changes = buildDiff({
      name: updates.name !== undefined ? diffValue(club.name, updates.name) : undefined,
      description: updates.description !== undefined ? diffValue(club.description, updates.description) : undefined,
      primaryColor: updates.primary_color !== undefined ? diffValue(club.primary_color, updates.primary_color) : undefined,
      secondaryColor: updates.secondary_color !== undefined ? diffValue(club.secondary_color, updates.secondary_color) : undefined,
      theme: updates.theme !== undefined ? diffValue(club.theme, updates.theme) : undefined,
      timezone: updates.timezone !== undefined ? diffValue(club.timezone, updates.timezone) : undefined,
      isPublic: updates.is_public !== undefined ? diffValue(!!club.is_public, !!updates.is_public) : undefined,
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

  async regenerateInviteCode(clubId, actorId) {
    const club = await clubsRepository.findActiveById(clubId);
    if (!club) throw AppError.notFound('Club no encontrado.');
    const inviteCode = generateShortCode(8);
    await clubsRepository.regenerateInviteCode(clubId, inviteCode);
    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'CLUB_INVITE_CODE_REGENERATED',
      entityType: 'club',
      entityId: clubId,
      changes: buildDiff({ code: diffValue(club.invite_code, inviteCode) }),
    });
    return inviteCode;
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

  async getStats(clubId) {
    const [usersCount, rolesCount, invitationsCount, recentActivity] = await Promise.all([
      clubsRepository.countUsers(clubId),
      clubsRepository.countRoles(clubId),
      clubsRepository.countActiveInvitations(clubId),
      auditRepository.recentActivity(clubId, 10),
    ]);
    return {
      usersCount,
      rolesCount,
      invitationsCount,
      recentActivity: recentActivity.map((entry) => ({ ...entry, avatar_url: toAbsoluteMediaUrl(entry.avatar_url) })),
    };
  }

  /**
   * Une a un usuario a un club usando ya sea una invitación puntual (tabla
   * `invitations`, con expiración/usos limitados) o el código permanente del
   * propio club (`clubs.invite_code`). Se prueba primero la invitación puntual.
   */
  async joinByCode(rawCode, userId) {
    const code = rawCode.trim().toUpperCase();
    const invitation = await invitationsRepository.findByCode(code);

    let club;
    let roleIdToAssign = null;

    if (invitation) {
      if (invitation.status !== 'active') throw AppError.badRequest('Esta invitación ya no está activa.');
      if (invitation.expires_at && new Date(invitation.expires_at) < new Date()) {
        await invitationsRepository.setStatus(invitation.id, 'expired');
        throw AppError.badRequest('Esta invitación ha expirado.');
      }
      if (invitation.max_uses && invitation.uses_count >= invitation.max_uses) {
        await invitationsRepository.setStatus(invitation.id, 'exhausted');
        throw AppError.badRequest('Esta invitación ya alcanzó su límite de usos.');
      }
      club = await clubsRepository.findActiveById(invitation.club_id);
      roleIdToAssign = invitation.default_role_id;
    } else {
      club = await clubsRepository.findByInviteCode(code);
    }

    if (!club) throw AppError.notFound('Código de invitación inválido.');
    if (club.status !== CLUB_STATUS.ACTIVE) throw AppError.forbidden('Este club no está activo.');

    const existing = await usersRepository.findMembership(userId, club.id);
    if (existing && existing.status === USER_CLUB_STATUS.ACTIVE) {
      throw AppError.conflict('Ya perteneces a este club.');
    }

    // Sin fallback a "Socio": si la invitación (o el código permanente) no trae un
    // rol explícito, quien se une entra sin roles hasta que un admin se los asigne.
    const clubsCountBefore = await usersRepository.countClubsForUser(userId);

    await withTransaction(async (conn) => {
      // La validación de "¿tiene usos disponibles?" de más arriba se hizo con datos leídos
      // ANTES de esta transacción — bajo concurrencia (dos usuarios canjeando el mismo código
      // de un solo uso al mismo tiempo) ambos podían pasarla. `claimUse` repite la validación
      // de forma atómica contra el estado real al momento de escribir; si pierde la carrera,
      // aborta toda la operación (incluida la membresía) en vez de sumar un miembro de más.
      if (invitation) {
        const claimed = await invitationsRepository.claimUse(invitation.id, conn);
        if (!claimed) {
          // `claimUse` puede fallar por dos motivos distintos (agotó sus usos, o alguien más la
          // revocó/expiró en el instante entre la lectura de arriba y este punto) — se relee el
          // estado real para no decirle siempre "sin usos disponibles" cuando la causa fue otra.
          const current = await invitationsRepository.findByCode(code, conn);
          const reason =
            current?.status === 'active' || !current?.status
              ? 'ya no tiene usos disponibles'
              : 'ya no está activa';
          throw AppError.badRequest(`Esta invitación ${reason}.`);
        }
      }

      await usersRepository.addToClub({ userId, clubId: club.id, status: USER_CLUB_STATUS.ACTIVE, isDefault: clubsCountBefore === 0 }, conn);
      if (roleIdToAssign) {
        await rolesRepository.assignToUser({ userId, roleId: roleIdToAssign, clubId: club.id, assignedBy: userId }, conn);
      }
      if (clubsCountBefore === 0) await usersRepository.setDefaultClub(userId, club.id, conn);
      if (invitation) {
        await invitationsRepository.recordUse({ invitationId: invitation.id, userId }, conn);
      }
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
