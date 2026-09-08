const invitationsRepository = require('../repositories/invitations.repository');
const rolesRepository = require('../repositories/roles.repository');
const auditRepository = require('../repositories/audit.repository');
const AppError = require('../helpers/AppError');
const { parsePagination, buildMeta } = require('../helpers/pagination');
const { generateShortCode } = require('../helpers/tokenUtils');
const env = require('../config/env');
const permissionService = require('./permission.service');
const { FUNCTIONS } = require('../config/constants');

const SORTABLE = ['created_at', 'expires_at', 'uses_count', 'status'];

class InvitationsService {
  toDto(row) {
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
      requiresMemberProfile: !!row.requires_member_profile,
      note: row.note,
      createdBy: row.created_by,
      creatorName: row.creator_username ?? null,
      createdAt: row.created_at,
      shareUrl: `${env.clientUrl}/join?code=${row.code}`,
    };
  }

  async create(clubId, { maxUses, expiresAt, defaultRoleId, note, requiresMemberProfile }, actorId) {
    // Elegir el rol con el que entrará quien use la invitación es, en la práctica,
    // asignar un rol: exige el mismo permiso (ASSIGN_USER_ROLES) que hacerlo a mano
    // desde el perfil de un usuario. Si el actor no lo tiene, se ignora lo que haya
    // mandado el cliente en vez de confiar en que el frontend ocultó el selector.
    const authContext = await permissionService.buildAuthorizationContext(actorId, clubId);
    const canAssignRoles = permissionService.hasFunction(authContext, FUNCTIONS.ASSIGN_USER_ROLES);
    defaultRoleId = canAssignRoles ? defaultRoleId : null;

    if (defaultRoleId) {
      const role = await rolesRepository.findById(defaultRoleId);
      if (!role || role.club_id !== clubId) throw AppError.badRequest('El rol predeterminado no pertenece a este club.');
    }

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
      requiresMemberProfile: requiresMemberProfile ? 1 : 0,
      note: note || null,
    });

    await auditRepository.logAction({
      userId: actorId,
      clubId,
      action: 'INVITATION_CREATED',
      entityType: 'invitation',
      entityId: id,
      changes: { maxUses: maxUses || null, expiresAt: expiresAt || null },
    });

    return this.toDto(await invitationsRepository.findById(id));
  }

  async listForClub(clubId, query) {
    const { limit, offset, sortBy, sortOrder, page } = parsePagination(query, SORTABLE);
    await invitationsRepository.expireOutdated();
    const { rows, total } = await invitationsRepository.paginateByClub(clubId, { limit, offset, sortBy, sortOrder, status: query.status });
    return { items: rows.map((r) => this.toDto(r)), meta: buildMeta({ page, limit, total }) };
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
