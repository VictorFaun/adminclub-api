const usersRepository = require('../repositories/users.repository');
const rolesRepository = require('../repositories/roles.repository');
const auditRepository = require('../repositories/audit.repository');
const AppError = require('../helpers/AppError');
const { parsePagination, buildMeta } = require('../helpers/pagination');
const { withTransaction, pool } = require('../config/database');
const { hashPassword, isStrongPassword } = require('../helpers/passwordUtils');
const { USER_STATUS, USER_CLUB_STATUS, FUNCTIONS } = require('../config/constants');
const authService = require('./auth.service');
const permissionService = require('./permission.service');
const { diffValue, diffArray, buildDiff } = require('../helpers/auditDiff');

const SORTABLE = ['created_at', 'username', 'email', 'status'];

class UsersService {
  sanitize(user) {
    return authService.sanitizeUser(user);
  }

  async listForClub(clubId, query) {
    const { limit, offset, sortBy, sortOrder, page } = parsePagination(query, SORTABLE);
    const { rows, total } = await usersRepository.paginate({
      limit,
      offset,
      sortBy,
      sortOrder,
      search: query.search,
      status: query.status,
      clubId,
    });
    // El listado muestra los roles de cada miembro (badges); sin esto el
    // frontend recibe `roles: undefined` y rompe al intentar recorrerlo.
    const rolesByUser = await rolesRepository.findRolesForUsers(rows.map((r) => r.id), clubId);
    return {
      items: rows.map((r) => ({
        ...this.sanitize(r),
        // El listado es "por club": el estado que se muestra (y que el botón
        // suspender/reactivar controla) es la membresía, no la cuenta global.
        status: r.membership_status || r.status,
        roles: rolesByUser[r.id] || [],
      })),
      meta: buildMeta({ page, limit, total }),
    };
  }

  async createInClub(clubId, data, actorId) {
    const exists = await usersRepository.emailExists(data.email);
    if (exists) throw AppError.conflict('Ya existe una cuenta registrada con este correo electrónico.');
    if (!isStrongPassword(data.password)) {
      throw AppError.badRequest('La contraseña no cumple con los requisitos de seguridad.');
    }

    // Crear usuarios (CREATE_USERS) y asignarles roles (ASSIGN_USER_ROLES) son
    // permisos distintos: si el actor no tiene el segundo, se ignora cualquier
    // roleIds que haya mandado el cliente en vez de confiar en lo que oculta el frontend.
    const authContext = await permissionService.buildAuthorizationContext(actorId, clubId);
    const canAssignRoles = permissionService.hasFunction(authContext, FUNCTIONS.ASSIGN_USER_ROLES);
    const roleIds = canAssignRoles ? data.roleIds || [] : [];
    if (roleIds.length) {
      const clubRoles = await rolesRepository.findClubRoles(clubId);
      const validIds = new Set(clubRoles.map((r) => r.id));
      const invalid = roleIds.filter((id) => !validIds.has(id));
      if (invalid.length) throw AppError.badRequest('Uno o más roles no pertenecen a este club.');
    }

    const passwordHash = await hashPassword(data.password);
    const userId = await withTransaction(async (conn) => {
      const id = await usersRepository.createUser(
        {
          username: data.username,
          email: data.email,
          passwordHash,
          status: USER_STATUS.ACTIVE,
          // El teléfono ya no se pide al crear la cuenta (queda para la futura ficha de
          // miembro) — sigue siendo editable después desde el perfil del usuario.
          phone: null,
        },
        conn
      );
      // El admin da de alta la cuenta a mano y vale por la identidad de la persona,
      // así que el correo queda verificado de entrada (no tiene sentido bloquearla
      // esperando que confirme un correo al que quizás ni siquiera tenga acceso aún).
      await usersRepository.setEmailVerified(id, conn);
      await usersRepository.addToClub({ userId: id, clubId, status: USER_CLUB_STATUS.ACTIVE, isDefault: true }, conn);
      for (const roleId of roleIds) {
        await rolesRepository.assignToUser({ userId: id, roleId, clubId, assignedBy: actorId }, conn);
      }
      return id;
    });

    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'USER_CREATED',
      entityType: 'user',
      entityId: userId,
      changes: { username: data.username, email: data.email },
    });

    return this.getDetail(userId, clubId);
  }

  /**
   * Usado tanto por la búsqueda manual por correo (vista Usuarios) como por la
   * validación en vivo del modal de alta: reutilizan el mismo endpoint para no
   * duplicar la lógica de qué tan revelador puede ser el resultado.
   * Solo revela los datos del usuario (nombre, correo, foto) si el actor tiene
   * CREATE_USERS — es la misma capacidad de "agregar directamente" que ya exige
   * el endpoint para invitarlo, así que sin ella solo se confirma que el correo
   * está ocupado.
   */
  async lookupByEmail(clubId, email, actorId) {
    const user = await usersRepository.findByEmail(email);
    if (!user) return { found: false };

    const authContext = await permissionService.buildAuthorizationContext(actorId, clubId);
    const canInvite = permissionService.hasFunction(authContext, FUNCTIONS.CREATE_USERS);
    if (!canInvite) return { found: true, canInvite: false };

    const membership = await usersRepository.findMembership(user.id, clubId);
    const sanitized = this.sanitize(user);
    return {
      found: true,
      canInvite: true,
      alreadyInClub: !!membership,
      user: { id: sanitized.id, username: sanitized.username, email: sanitized.email, avatarUrl: sanitized.avatarUrl },
    };
  }

  /** Agrega al club a un usuario que ya tiene cuenta en la plataforma (p.ej. de otro club), sin crear una cuenta nueva. */
  async addExistingUserToClub(clubId, userId, roleIds, actorId) {
    const user = await usersRepository.findById(userId);
    if (!user) throw AppError.notFound('Usuario no encontrado.');

    const existingMembership = await usersRepository.findMembership(userId, clubId);
    if (existingMembership) throw AppError.conflict('El usuario ya pertenece a este club.');

    const authContext = await permissionService.buildAuthorizationContext(actorId, clubId);
    const canAssignRoles = permissionService.hasFunction(authContext, FUNCTIONS.ASSIGN_USER_ROLES);
    const finalRoleIds = canAssignRoles ? roleIds || [] : [];
    if (finalRoleIds.length) {
      const clubRoles = await rolesRepository.findClubRoles(clubId);
      const validIds = new Set(clubRoles.map((r) => r.id));
      const invalid = finalRoleIds.filter((id) => !validIds.has(id));
      if (invalid.length) throw AppError.badRequest('Uno o más roles no pertenecen a este club.');
    }

    await withTransaction(async (conn) => {
      // isDefault: false — a diferencia de createInClub, este usuario ya tiene una cuenta
      // (y probablemente un club default propio); no tiene sentido reasignárselo aquí.
      await usersRepository.addToClub({ userId, clubId, status: USER_CLUB_STATUS.ACTIVE, isDefault: false }, conn);
      for (const roleId of finalRoleIds) {
        await rolesRepository.assignToUser({ userId, roleId, clubId, assignedBy: actorId }, conn);
      }
    });

    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'USER_ADDED_TO_CLUB',
      entityType: 'user',
      entityId: userId,
      changes: { username: user.username, email: user.email },
    });

    return this.getDetail(userId, clubId);
  }

  async getDetail(userId, clubId) {
    const user = await usersRepository.findById(userId);
    if (!user) throw AppError.notFound('Usuario no encontrado.');

    const membership = clubId ? await usersRepository.findMembership(userId, clubId) : null;
    if (clubId && !membership) throw AppError.notFound('El usuario no pertenece a este club.');

    const [roles, clubs] = await Promise.all([
      clubId ? rolesRepository.findRolesForUser(userId, clubId) : [],
      usersRepository.findClubsForUser(userId),
    ]);

    return {
      ...this.sanitize(user),
      membership: membership ? { status: membership.status, isDefault: !!membership.is_default, joinedAt: membership.joined_at } : null,
      roles: roles.map((r) => ({ id: r.id, name: r.name, color: r.color })),
      clubs: clubs.map((c) => ({ id: c.id, name: c.name, status: c.membership_status, isDefault: !!c.is_default })),
    };
  }

  async update(userId, clubId, data, actorId) {
    const user = await usersRepository.findById(userId);
    if (!user) throw AppError.notFound('Usuario no encontrado.');
    // Sin esto, cualquier admin con EDIT_USERS en SU club podía editar a un usuario que
    // solo pertenece a otro club, adivinando el id (IDOR) — igual que updateStatusInClub /
    // removeFromClub, hay que confirmar que el usuario es miembro de este club antes de tocarlo.
    const membership = await usersRepository.findMembership(userId, clubId);
    if (!membership) throw AppError.notFound('El usuario no pertenece a este club.');

    const updates = {};
    if (data.username !== undefined) updates.username = data.username;
    if (data.phone !== undefined) updates.phone = data.phone;

    if (Object.keys(updates).length) {
      await usersRepository.updateById(userId, updates);
    }

    const changes = buildDiff({
      username: diffValue(user.username, data.username !== undefined ? data.username : user.username),
      phone: diffValue(user.phone, data.phone !== undefined ? data.phone : user.phone),
    });
    if (changes) {
      await auditRepository.logActivity({
        userId: actorId,
        clubId,
        description: `Actualizó el perfil de ${user.username}`,
      });
    }

    return this.getDetail(userId, clubId);
  }

  async updateStatusInClub(userId, clubId, status, actorId) {
    if (userId === actorId) throw AppError.badRequest('No puedes cambiar tu propio estado.');
    const membership = await usersRepository.findMembership(userId, clubId);
    if (!membership) throw AppError.notFound('El usuario no pertenece a este club.');

    await usersRepository.setMembershipStatus(userId, clubId, status);
    const changes = buildDiff({ status: diffValue(membership.status, status) });
    if (changes) {
      await auditRepository.logAction({
        userId: actorId,
        clubId,
        action: status === 'suspended' ? 'USER_SUSPENDED' : 'USER_REACTIVATED',
        entityType: 'user',
        entityId: userId,
        changes,
      });
    }

    return this.getDetail(userId, clubId);
  }

  async removeFromClub(userId, clubId, actorId) {
    if (userId === actorId) throw AppError.badRequest('No puedes eliminarte a ti mismo del club.');
    const membership = await usersRepository.findMembership(userId, clubId);
    if (!membership) throw AppError.notFound('El usuario no pertenece a este club.');
    // Se pide antes de borrar: después de la transacción ya no queda registro de qué
    // roles tenía, y sin esto el detalle de auditoría no podría mostrarlos.
    const previousRoles = await rolesRepository.findRolesForUser(userId, clubId);

    await withTransaction(async (conn) => {
      await conn.query('DELETE FROM user_clubs WHERE user_id = ? AND club_id = ?', [userId, clubId]);
      await conn.query('DELETE FROM user_roles WHERE user_id = ? AND club_id = ?', [userId, clubId]);
    });

    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'USER_REMOVED_FROM_CLUB',
      entityType: 'user',
      entityId: userId,
      changes: previousRoles.length ? { removedRoles: previousRoles.map((r) => r.name) } : null,
    });
  }

  async updateRolesInClub(userId, clubId, roleIds, actorId) {
    const membership = await usersRepository.findMembership(userId, clubId);
    if (!membership) throw AppError.notFound('El usuario no pertenece a este club.');

    const clubRoles = await rolesRepository.findClubRoles(clubId);
    if (roleIds.length) {
      const validIds = new Set(clubRoles.map((r) => r.id));
      const invalid = roleIds.filter((id) => !validIds.has(id));
      if (invalid.length) throw AppError.badRequest('Uno o más roles no pertenecen a este club.');
    }

    // Nombres, no ids: un id de rol no le dice nada a quien lee la auditoría después.
    const previousRoleNames = (await rolesRepository.findRolesForUser(userId, clubId)).map((r) => r.name);
    const newRoleNames = clubRoles.filter((r) => roleIds.includes(r.id)).map((r) => r.name);

    await withTransaction(async (conn) => {
      await conn.query('DELETE FROM user_roles WHERE user_id = ? AND club_id = ?', [userId, clubId]);
      if (roleIds.length) {
        const values = roleIds.map((roleId) => [userId, roleId, clubId, actorId, new Date()]);
        await conn.query(
          'INSERT INTO user_roles (user_id, role_id, club_id, assigned_by, assigned_at) VALUES ?',
          [values]
        );
      }
    });

    const changes = buildDiff({ roles: diffArray(previousRoleNames, newRoleNames) });
    if (changes) {
      await auditRepository.logAction({
        userId: actorId,
        clubId,
        action: 'USER_ROLES_UPDATED',
        entityType: 'user',
        entityId: userId,
        changes,
      });
    }

    return this.getDetail(userId, clubId);
  }

  async getActivity(userId, clubId, limit = 20) {
    const membership = await usersRepository.findMembership(userId, clubId);
    if (!membership) throw AppError.notFound('El usuario no pertenece a este club.');

    const [rows] = await pool.query(
      `SELECT * FROM audit_logs WHERE user_id = ? AND club_id <=> ? ORDER BY created_at DESC LIMIT ?`,
      [userId, clubId, limit]
    );
    return rows;
  }
}

module.exports = new UsersService();
