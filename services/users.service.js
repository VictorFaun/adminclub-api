const usersRepository = require('../repositories/users.repository');
const rolesRepository = require('../repositories/roles.repository');
const membersRepository = require('../repositories/members.repository');
const auditRepository = require('../repositories/audit.repository');
const AppError = require('../helpers/AppError');
const { parsePagination, buildMeta } = require('../helpers/pagination');
const { withTransaction, pool } = require('../config/database');
const { USER_STATUS, USER_CLUB_STATUS, FUNCTIONS } = require('../config/constants');
const authService = require('./auth.service');
const permissionService = require('./permission.service');
const membersService = require('./members.service');
const clubUserInvitationsService = require('./clubUserInvitations.service');
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

  /**
   * Búsqueda por correo de la vista Usuarios, para invitar a esa persona al club (ver
   * clubUserInvitations.service.js). Solo revela los datos del usuario (nombre, correo, foto)
   * si el actor tiene CREATE_USERS ("Invitar usuarios") — sin ella solo se confirma que el
   * correo está ocupado. Un retirado del club se puede volver a invitar.
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
      alreadyInClub: !!membership && membership.status !== USER_CLUB_STATUS.WITHDRAWN,
      pendingInvitation: await clubUserInvitationsService.findPending(clubId, user.id),
      user: { id: sanitized.id, username: sanitized.username, email: sanitized.email, avatarUrl: sanitized.avatarUrl },
    };
  }

  async getDetail(userId, clubId) {
    const user = await usersRepository.findById(userId);
    if (!user) throw AppError.notFound('Usuario no encontrado.');

    const membership = clubId ? await usersRepository.findMembership(userId, clubId) : null;
    if (clubId && !membership) throw AppError.notFound('El usuario no pertenece a este club.');

    const [roles, clubs, member] = await Promise.all([
      clubId ? rolesRepository.findRolesForUser(userId, clubId) : [],
      usersRepository.findClubsForUser(userId),
      clubId ? membersRepository.findByUserId(userId, clubId) : null,
    ]);

    return {
      ...this.sanitize(user),
      membership: membership ? { status: membership.status, isDefault: !!membership.is_default, joinedAt: membership.joined_at } : null,
      roles: roles.map((r) => ({ id: r.id, name: r.name, color: r.color })),
      // Ficha de miembro vinculada a la cuenta en este club (lo único del club "sobre" la persona,
      // junto con sus roles: sus datos personales solo los edita ella desde su perfil).
      member: member ? { id: member.id, fullName: membersService._fullName(member), status: member.status } : null,
      clubs: clubs.map((c) => ({ id: c.id, name: c.name, status: c.membership_status, isDefault: !!c.is_default })),
    };
  }

  async updateStatusInClub(userId, clubId, status, actorId) {
    if (userId === actorId) throw AppError.badRequest('No puedes cambiar tu propio estado.');
    const membership = await usersRepository.findMembership(userId, clubId);
    if (!membership) throw AppError.notFound('El usuario no pertenece a este club.');
    // Un retirado ya no está en el club: volver es decisión suya, aceptando una invitación (ver
    // clubUserInvitations.service.js#accept, que también reactiva su ficha).
    if (membership.status === USER_CLUB_STATUS.WITHDRAWN) {
      throw AppError.conflict('Este usuario fue retirado del club. Para que vuelva, envíale una invitación.');
    }

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

  /**
   * "Eliminar" a un usuario de un club NO borra nada: su membresía pasa a 'withdrawn' (retirado) —
   * el club deja de aparecerle en su lista y no puede entrar, pero conserva su historial, sus
   * roles y su ficha. Para que vuelva hay que invitarlo (clubUserInvitations.service.js). `memberAction` decide qué pasa con su
   * ficha de miembro: 'keep' (queda como está), 'deactivate' (pasa a inactivo/archivado: se le
   * saltan cobros y asistencias hasta reactivarlo) o 'delete' (se elimina la ficha).
   */
  async removeFromClub(userId, clubId, actorId, memberAction = 'keep') {
    if (userId === actorId) throw AppError.badRequest('No puedes retirarte a ti mismo del club.');
    const membership = await usersRepository.findMembership(userId, clubId);
    if (!membership) throw AppError.notFound('El usuario no pertenece a este club.');
    if (membership.status === USER_CLUB_STATUS.WITHDRAWN) throw AppError.conflict('Este usuario ya fue retirado del club.');

    const member = await membersRepository.findByUserId(userId, clubId);
    const previousRoles = await rolesRepository.findRolesForUser(userId, clubId);

    await withTransaction(async (conn) => {
      await usersRepository.setMembershipStatus(userId, clubId, USER_CLUB_STATUS.WITHDRAWN, conn);
      // La ficha pendiente era de la invitación con la que entró: si vuelve, lo decide la nueva.
      await usersRepository.setRequiresProfileCompletion(userId, clubId, false, conn);
      await conn.query('UPDATE user_clubs SET is_default = 0 WHERE user_id = ? AND club_id = ?', [userId, clubId]);
      await conn.query('UPDATE users SET default_club_id = NULL WHERE id = ? AND default_club_id = ?', [userId, clubId]);

      if (member && memberAction === 'deactivate') {
        await membersService.applyStatus(member, 'inactive', actorId, conn);
      } else if (member && memberAction === 'delete') {
        await membersRepository.softDelete(member.id, conn);
        // Se desvincula para no bloquear uk_members_club_user si la persona vuelve a unirse.
        await membersRepository.updateById(member.id, { user_id: null }, conn);
      }
    });

    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'USER_REMOVED_FROM_CLUB',
      entityType: 'user',
      entityId: userId,
      changes: {
        memberAction: member ? memberAction : null,
        ...(previousRoles.length ? { roles: previousRoles.map((r) => r.name) } : {}),
      },
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

  /** Listado de TODOS los usuarios de la plataforma, sin importar club (VIEW_ALL_USERS). */
  async listAllPlatform(query) {
    const { limit, offset, sortBy, sortOrder, page } = parsePagination(query, SORTABLE);
    const { rows, total } = await usersRepository.paginate({
      limit,
      offset,
      sortBy,
      sortOrder,
      search: query.search,
      status: query.status,
      clubId: null,
    });
    // A diferencia de listForClub, acá no hay un club activo del que listar roles, pero sí
    // tiene sentido mostrar a qué clubes pertenece cada cuenta (vista de plataforma).
    const userIds = rows.map((r) => r.id);
    const [clubsByUser, globalRolesByUser] = await Promise.all([
      usersRepository.findClubsForUsers(userIds),
      usersRepository.findGlobalRoleCodesForUsers(userIds),
    ]);
    // El frontend usa esto solo para ocultar/deshabilitar los botones de editar/desactivar/
    // eliminar sobre un Super Admin (cosmético) — la barrera real son los guards agregados en
    // updateGlobal/updateStatusGlobal/removeGlobal de este mismo archivo.
    return {
      items: rows.map((r) => ({
        ...this.sanitize(r),
        clubs: clubsByUser[r.id] || [],
        isSuperAdmin: permissionService.isSuperAdmin(globalRolesByUser[r.id] || []),
      })),
      meta: buildMeta({ page, limit, total }),
    };
  }

  /** Un Super Admin no se puede editar/suspender/eliminar desde la vista de plataforma — evita
   * que un admin con EDIT_ALL_USERS/SUSPEND_ALL_USERS (funcionalidades bastante más comunes que
   * ser Super Admin) le quite acceso a la cuenta que administra la plataforma entera, sea por
   * error o a propósito. Mismo criterio de ubicación que el resto de estos guards (arriba del
   * método, service layer, `AppError.badRequest`). */
  async _assertTargetNotSuperAdmin(userId, message) {
    const globalRoleCodes = await permissionService.getGlobalRoleCodes(userId);
    if (permissionService.isSuperAdmin(globalRoleCodes)) throw AppError.badRequest(message);
  }

  /** Edita datos básicos de cualquier usuario de la plataforma (EDIT_ALL_USERS), sin depender de membresía a un club. */
  async updateGlobal(userId, data, actorId) {
    const user = await usersRepository.findById(userId);
    if (!user) throw AppError.notFound('Usuario no encontrado.');
    await this._assertTargetNotSuperAdmin(userId, 'No puedes editar a un Super Admin.');

    if (data.email !== undefined && data.email !== user.email) {
      const exists = await usersRepository.emailExists(data.email, userId);
      if (exists) throw AppError.conflict('Ya existe una cuenta registrada con este correo electrónico.');
    }
    const updates = {};
    if (data.username !== undefined) updates.username = data.username;
    if (data.phone !== undefined) updates.phone = data.phone;
    if (data.email !== undefined) updates.email = data.email;

    if (Object.keys(updates).length) {
      await usersRepository.updateById(userId, updates);
    }

    const changes = buildDiff({
      username: diffValue(user.username, data.username !== undefined ? data.username : user.username),
      phone: diffValue(user.phone, data.phone !== undefined ? data.phone : user.phone),
      email: diffValue(user.email, data.email !== undefined ? data.email : user.email),
    });
    if (changes) {
      await auditRepository.logAction({
        userId: actorId,
        clubId: null,
        action: 'PLATFORM_USER_UPDATED',
        entityType: 'user',
        entityId: userId,
        changes,
      });
    }

    const updated = await usersRepository.findById(userId);
    return this.sanitize(updated);
  }

  /** Suspende/reactiva la CUENTA global de un usuario (SUSPEND_ALL_USERS), a diferencia de updateStatusInClub que solo toca la membresía a un club puntual. */
  async updateStatusGlobal(userId, status, actorId) {
    if (userId === actorId) throw AppError.badRequest('No puedes cambiar tu propio estado.');
    const user = await usersRepository.findById(userId);
    if (!user) throw AppError.notFound('Usuario no encontrado.');
    await this._assertTargetNotSuperAdmin(userId, 'No puedes cambiar el estado de un Super Admin.');

    await usersRepository.updateById(userId, { status });
    const changes = buildDiff({ status: diffValue(user.status, status) });
    if (changes) {
      await auditRepository.logAction({
        userId: actorId,
        clubId: null,
        action: status === 'suspended' ? 'PLATFORM_USER_SUSPENDED' : 'PLATFORM_USER_REACTIVATED',
        entityType: 'user',
        entityId: userId,
        changes,
      });
    }

    const updated = await usersRepository.findById(userId);
    return this.sanitize(updated);
  }

  /** Elimina (soft-delete) la cuenta de un usuario de plataforma — solo si ya está
   * suspendida/bloqueada (mismo criterio pedido para mostrar el botón en la UI): no tiene
   * sentido eliminar de un tirón una cuenta que todavía puede operar con normalidad, sin pasar
   * primero por la suspensión. No hace falta tocar `user_clubs`/`user_roles`: `authMiddleware`
   * ya corta cualquier request con `user.deleted_at` seteado, así que una sesión activa deja de
   * funcionar de inmediato. */
  async removeGlobal(userId, actorId) {
    if (userId === actorId) throw AppError.badRequest('No puedes eliminar tu propia cuenta.');
    const user = await usersRepository.findById(userId);
    if (!user || user.deleted_at) throw AppError.notFound('Usuario no encontrado.');
    // No debería poder llegar acá igual (para eliminar primero hay que suspenderlo, y eso ya
    // está bloqueado para un Super Admin) — se deja igual como segunda barrera, mismo criterio
    // que el resto de la app ("cosmético en el frontend, la barrera real es siempre el backend").
    await this._assertTargetNotSuperAdmin(userId, 'No puedes eliminar a un Super Admin.');
    if (![USER_STATUS.SUSPENDED, USER_STATUS.BLOCKED].includes(user.status)) {
      throw AppError.conflict('Solo se pueden eliminar cuentas ya suspendidas o bloqueadas.');
    }

    await withTransaction(async (conn) => {
      // Sin esto, cualquier miembro vinculado a esta cuenta quedaría "vinculado" para siempre a
      // una cuenta fantasma (_assertUserLinkable rechaza vincular un miembro que ya tiene
      // user_id, sin filtrar eliminados).
      await membersRepository.unlinkFromAllMembers(userId, conn);
      await usersRepository.softDelete(userId, conn);
    });

    await auditRepository.logAction({
      userId: actorId,
      clubId: null,
      action: 'PLATFORM_USER_DELETED',
      entityType: 'user',
      entityId: userId,
      changes: { email: user.email, status: user.status },
    });
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
