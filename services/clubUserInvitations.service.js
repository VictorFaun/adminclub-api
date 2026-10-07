const clubUserInvitationsRepository = require('../repositories/clubUserInvitations.repository');
const usersRepository = require('../repositories/users.repository');
const rolesRepository = require('../repositories/roles.repository');
const clubsRepository = require('../repositories/clubs.repository');
const membersRepository = require('../repositories/members.repository');
const joinRequestsRepository = require('../repositories/joinRequests.repository');
const auditRepository = require('../repositories/audit.repository');
const permissionService = require('./permission.service');
const membersService = require('./members.service');
const notificationsService = require('./notifications.service');
const AppError = require('../helpers/AppError');
const logger = require('../helpers/logger');
const { withTransaction } = require('../config/database');
const { toAbsoluteMediaUrl } = require('../helpers/mediaUrl');
const { CLUB_STATUS, USER_CLUB_STATUS, FUNCTIONS, JOIN_REQUEST_STATUS } = require('../config/constants');

/** Pestaña del perfil donde la persona ve sus invitaciones (link de la notificación y del correo). */
const PROFILE_INVITATIONS_LINK = '/profile?tab=invitations';

/**
 * Invitaciones del club a una persona que ya tiene cuenta (buscada por correo en Usuarios). Ya no
 * se la agrega directo: le llega una notificación y la acepta o rechaza desde su perfil. Al
 * aceptar entra al club con los roles de la invitación; aceptar o rechazar borra la invitación y
 * se avisa a quien invitó. Distinto de las invitaciones por CÓDIGO (invitations.service.js), que
 * cualquiera con el código canjea.
 */
class ClubUserInvitationsService {
  /** Mismo criterio que el alta directa de antes: sin ASSIGN_USER_ROLES los roles se descartan,
   * y todos deben ser del club. */
  async _allowedRoleIds(clubId, actorId, roleIds) {
    const authContext = await permissionService.buildAuthorizationContext(actorId, clubId);
    if (!permissionService.hasFunction(authContext, FUNCTIONS.ASSIGN_USER_ROLES)) return [];
    const ids = [...new Set((roleIds || []).map(Number).filter(Boolean))];
    if (!ids.length) return [];
    const valid = new Set((await rolesRepository.findClubRoles(clubId)).map((r) => r.id));
    if (ids.some((id) => !valid.has(id))) throw AppError.badRequest('Uno o más roles no pertenecen a este club.');
    return ids;
  }

  async invite(clubId, { userId, message, roleIds }, actorId) {
    const user = await usersRepository.findById(userId);
    if (!user) throw AppError.notFound('Usuario no encontrado.');
    const membership = await usersRepository.findMembership(userId, clubId);
    // Un retirado puede volver a ser invitado; activo/suspendido/pendiente ya está en el club.
    if (membership && membership.status !== USER_CLUB_STATUS.WITHDRAWN) throw AppError.conflict('Esta persona ya pertenece al club.');
    if (await clubUserInvitationsRepository.findByClubAndUser(clubId, userId)) {
      throw AppError.conflict('Esta persona ya tiene una invitación pendiente de este club.');
    }
    const finalRoleIds = await this._allowedRoleIds(clubId, actorId, roleIds);
    const club = await clubsRepository.findActiveById(clubId);

    const cleanMessage = (message || '').trim() || null;
    let id;
    try {
      id = await withTransaction((conn) =>
        clubUserInvitationsRepository.create({ clubId, userId, invitedBy: actorId, message: cleanMessage, roleIds: finalRoleIds }, conn)
      );
    } catch (error) {
      // Dos admins invitando a la misma persona a la vez (uk_club_user_invitations).
      if (error.code === 'ER_DUP_ENTRY') throw AppError.conflict('Esta persona ya tiene una invitación pendiente de este club.');
      throw error;
    }

    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'USER_INVITED',
      entityType: 'user',
      entityId: userId,
      changes: { email: user.email, roles: (await rolesRepository.findClubRoles(clubId)).filter((r) => finalRoleIds.includes(r.id)).map((r) => r.name) },
    });

    // Sin clubId: la persona todavía no es del club (no se podría "abrir" en su contexto); la
    // campana muestra las notificaciones de todos los clubes y las que no tienen club.
    this._notify({
      userId,
      clubId: null,
      type: 'invitation',
      title: `${club.name} te envió una invitación`,
      message: cleanMessage || `Te invitaron a unirte a ${club.name}. Acepta o rechaza la invitación desde tu perfil.`,
      link: PROFILE_INVITATIONS_LINK,
    });

    return { id, pending: true };
  }

  /** El club retira una invitación que aún no se responde. */
  async cancel(clubId, invitationId, actorId) {
    const invitation = await clubUserInvitationsRepository.findById(invitationId);
    if (!invitation || invitation.club_id !== clubId) throw AppError.notFound('Invitación no encontrada.');
    if (!(await clubUserInvitationsRepository.claimDelete(invitationId))) throw AppError.notFound('Invitación no encontrada.');
    await auditRepository.logAction({ userId: actorId, clubId, action: 'USER_INVITATION_CANCELLED', entityType: 'user', entityId: invitation.user_id });
  }

  /** Invitación pendiente del club para un usuario (para la búsqueda por correo). */
  async findPending(clubId, userId) {
    const row = await clubUserInvitationsRepository.findByClubAndUser(clubId, userId);
    return row ? { id: row.id, createdAt: row.created_at } : null;
  }

  // ------------------------------------------------------------------ lado del invitado

  async listMine(userId) {
    const rows = await clubUserInvitationsRepository.findPendingForUser(userId);
    const roles = await clubUserInvitationsRepository.findRoles(rows.map((r) => r.id));
    return rows.map((r) => ({
      id: r.id,
      message: r.message,
      createdAt: r.created_at,
      invitedBy: r.inviter_username || null,
      club: {
        id: r.club_id,
        name: r.club_name,
        description: r.club_description,
        logoUrl: toAbsoluteMediaUrl(r.club_logo_url),
        bannerUrl: toAbsoluteMediaUrl(r.club_banner_url),
        primaryColor: r.club_primary_color,
        secondaryColor: r.club_secondary_color,
      },
      roles: roles.filter((x) => x.invitation_id === r.id).map((x) => ({ id: x.id, name: x.name, color: x.color })),
    }));
  }

  async countMine(userId) {
    return { pending: await clubUserInvitationsRepository.countPendingForUser(userId) };
  }

  async _ownInvitation(userId, invitationId) {
    const invitation = await clubUserInvitationsRepository.findById(invitationId);
    if (!invitation || invitation.user_id !== userId) throw AppError.notFound('Invitación no encontrada.');
    return invitation;
  }

  async accept(userId, invitationId) {
    const invitation = await this._ownInvitation(userId, invitationId);
    const club = await clubsRepository.findActiveById(invitation.club_id);
    if (!club || club.status !== CLUB_STATUS.ACTIVE) throw AppError.badRequest('Este club ya no está disponible.');
    const clubId = club.id;
    const roles = await clubUserInvitationsRepository.findRoles([invitation.id]);
    const existing = await usersRepository.findMembership(userId, clubId);

    if (existing && [USER_CLUB_STATUS.ACTIVE, USER_CLUB_STATUS.SUSPENDED].includes(existing.status)) {
      await clubUserInvitationsRepository.claimDelete(invitation.id);
      throw AppError.conflict('Ya perteneces a este club.');
    }

    const clubsCountBefore = await usersRepository.countClubsForUser(userId);
    await withTransaction(async (conn) => {
      // Solo quien la borra primero sigue (doble clic, aceptar en dos pestañas, el club la cancela).
      if (!(await clubUserInvitationsRepository.claimDelete(invitation.id, conn))) throw AppError.notFound('Invitación no encontrada.');
      await usersRepository.addToClub({ userId, clubId, status: USER_CLUB_STATUS.ACTIVE, isDefault: clubsCountBefore === 0 }, conn);
      // Los roles los define la invitación (también si vuelve tras ser retirado con otros roles).
      await conn.query('DELETE FROM user_roles WHERE user_id = ? AND club_id = ?', [userId, clubId]);
      for (const role of roles) {
        await rolesRepository.assignToUser({ userId, roleId: role.id, clubId, assignedBy: invitation.invited_by }, conn);
      }
      await usersRepository.setRequiresProfileCompletion(userId, clubId, false, conn);
      // Vuelve tras haber sido retirado: se reactiva su ficha si el retiro la archivó.
      if (existing?.status === USER_CLUB_STATUS.WITHDRAWN) {
        const member = await membersRepository.findByUserId(userId, clubId, conn);
        if (member) await membersService.applyStatus(member, 'active', userId, conn);
      }
      // Si además había pedido acceso, esa solicitud queda resuelta.
      const request = await joinRequestsRepository.findPending(userId, clubId, conn);
      if (request) await joinRequestsRepository.resolve({ id: request.id, status: JOIN_REQUEST_STATUS.APPROVED, reviewedBy: invitation.invited_by }, conn);
      if (clubsCountBefore === 0) await usersRepository.setDefaultClub(userId, clubId, conn);
    });

    const user = await usersRepository.findById(userId);
    await auditRepository.logAction({
      userId,
      clubId,
      action: 'USER_INVITATION_ACCEPTED',
      entityType: 'user',
      entityId: userId,
      changes: { roles: roles.map((r) => r.name) },
    });
    await auditRepository.logActivity({ userId, clubId, description: 'Se unió al club aceptando una invitación' });
    if (invitation.invited_by) {
      this._notify({
        userId: invitation.invited_by,
        clubId,
        type: 'success',
        title: 'Invitación aceptada',
        message: `${user.username} aceptó la invitación y ya es parte de ${club.name}.`,
        link: `/users/${userId}`,
      });
    }
    return { clubId };
  }

  async reject(userId, invitationId) {
    const invitation = await this._ownInvitation(userId, invitationId);
    if (!(await clubUserInvitationsRepository.claimDelete(invitation.id))) throw AppError.notFound('Invitación no encontrada.');
    const user = await usersRepository.findById(userId);
    const club = await clubsRepository.findActiveById(invitation.club_id);
    await auditRepository.logAction({ userId, clubId: invitation.club_id, action: 'USER_INVITATION_REJECTED', entityType: 'user', entityId: userId });
    if (invitation.invited_by && club) {
      this._notify({
        userId: invitation.invited_by,
        clubId: club.id,
        type: 'warning',
        title: 'Invitación rechazada',
        message: `${user.username} rechazó la invitación a ${club.name}.`,
        link: null,
      });
    }
  }

  /** Mejor esfuerzo: un fallo al notificar no debe deshacer la acción ya hecha. */
  _notify(data) {
    notificationsService.notifyUser(data).catch((error) => logger.error('[clubUserInvitations] Error notificando', { error: error.message }));
  }
}

module.exports = new ClubUserInvitationsService();
