const usersRepository = require('../repositories/users.repository');
const rolesRepository = require('../repositories/roles.repository');
const membersRepository = require('../repositories/members.repository');
const joinRequestsRepository = require('../repositories/joinRequests.repository');
const membersService = require('./members.service');
const memberGuardiansRepository = require('../repositories/memberGuardians.repository');
const AppError = require('../helpers/AppError');
const { USER_CLUB_STATUS, JOIN_REQUEST_STATUS } = require('../config/constants');

/**
 * Único punto por el que una CUENTA entra (o vuelve) a un club — lo usan los tres caminos:
 * código de invitación (clubs.service.js#joinByCode), invitación por correo
 * (clubUserInvitations.service.js#accept) y solicitud de acceso aprobada
 * (clubs.service.js#resolveJoinRequest). Así todos aplican las mismas reglas:
 *  - quien ya está activo no "vuelve a entrar", y un suspendido NO se reactiva solo por usar
 *    otro camino (eso lo decide la directiva);
 *  - los roles quedan EXACTAMENTE los del camino (un retirado que vuelve no arrastra los viejos);
 *  - si venía retirado se reactiva su ficha; `linkMemberId` vincula una ficha que ya existía
 *    (creada por la directiva o desde el link público) en vez de pedirle crear otra;
 *  - se pide completar ficha solo si se pidió y no tiene una ya vinculada;
 *  - se cierran los otros caminos pendientes de esa persona en ese club (su solicitud de acceso
 *    y las invitaciones por correo), para que no queden colgando en Usuarios / Solicitudes.
 * Debe correr dentro de una transacción (`conn`).
 */
class ClubEntryService {
  /** Lanza si la persona no puede entrar por ningún camino (ya está, o está suspendida). */
  assertCanEnter(membership) {
    if (membership?.status === USER_CLUB_STATUS.ACTIVE) throw AppError.conflict('Ya perteneces a este club.');
    if (membership?.status === USER_CLUB_STATUS.SUSPENDED) {
      throw AppError.forbidden('Tu acceso a este club está suspendido. Habla con la directiva del club.');
    }
  }

  async enter(conn, { userId, clubId, roleIds = [], requiresProfile = false, linkMemberId = null, guardianOf = [], guardianRelation = null, actorId = null }) {
    const existing = await usersRepository.findMembership(userId, clubId, conn);
    this.assertCanEnter(existing);

    const clubsBefore = await usersRepository.countClubsForUser(userId, conn);
    await usersRepository.addToClub({ userId, clubId, status: USER_CLUB_STATUS.ACTIVE, isDefault: clubsBefore === 0 }, conn);

    // Roles: exactamente los del camino por el que entra.
    await conn.query('DELETE FROM user_roles WHERE user_id = ? AND club_id = ?', [userId, clubId]);
    for (const roleId of [...new Set(roleIds.filter(Boolean))]) {
      await rolesRepository.assignToUser({ userId, roleId, clubId, assignedBy: actorId ?? userId }, conn);
    }

    // Ficha: la suya, una existente para vincular, o ninguna (y se le pide si corresponde).
    let member = await membersRepository.findByUserId(userId, clubId, conn);
    if (!member && linkMemberId) {
      const target = await membersRepository.findActiveById(linkMemberId, conn);
      // Si mientras tanto la vincularon a otra cuenta o la eliminaron, simplemente no se vincula.
      if (target && target.club_id === clubId && !target.user_id) {
        await membersRepository.updateById(target.id, { user_id: userId }, conn);
        member = await membersRepository.findActiveById(target.id, conn);
      }
    }
    if (member && member.status !== 'active' && existing?.status === USER_CLUB_STATUS.WITHDRAWN) {
      await membersService.reactivateOnReturn(member, actorId ?? userId, conn);
    }
    // Apoderado: las fichas que tendrá a cargo (si siguen existiendo en el club).
    for (const id of guardianOf) {
      const child = await membersRepository.findActiveById(id, conn);
      if (child && child.club_id === clubId && child.user_id !== userId) {
        await memberGuardiansRepository.add({ memberId: child.id, userId, relation: guardianRelation, createdBy: actorId }, conn);
      }
    }
    // Quien entra solo como apoderado no necesita ficha propia.
    await usersRepository.setRequiresProfileCompletion(userId, clubId, !member && !!requiresProfile && !guardianOf.length, conn);

    // Otros caminos pendientes de esta persona en este club: quedan resueltos.
    const request = await joinRequestsRepository.findPending(userId, clubId, conn);
    if (request) await joinRequestsRepository.resolve({ id: request.id, status: JOIN_REQUEST_STATUS.APPROVED, reviewedBy: actorId }, conn);
    await conn.query('DELETE FROM club_user_invitations WHERE club_id = ? AND user_id = ?', [clubId, userId]);

    if (clubsBefore === 0) await usersRepository.setDefaultClub(userId, clubId, conn);
    return { reactivated: existing?.status === USER_CLUB_STATUS.WITHDRAWN, memberId: member?.id ?? null };
  }
}

module.exports = new ClubEntryService();
