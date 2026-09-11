const rolesRepository = require('../repositories/roles.repository');
const functionsRepository = require('../repositories/functions.repository');
const membersRepository = require('../repositories/members.repository');
const memberGroupsRepository = require('../repositories/memberGroups.repository');
const auditRepository = require('../repositories/audit.repository');
const AppError = require('../helpers/AppError');
const { withTransaction } = require('../config/database');
const DEFAULT_CLUB_ROLES = require('../config/defaultClubRoles');
const { ROLE_SCOPE } = require('../config/constants');
const { diffValue, diffArray, buildDiff } = require('../helpers/auditDiff');

class RolesService {
  toDto(
    role,
    functionCodes = [],
    memberScope = { memberIds: [], groupIds: [] },
    paymentScope = { memberIds: [], groupIds: [] }
  ) {
    return {
      id: role.id,
      uuid: role.uuid,
      clubId: role.club_id,
      name: role.name,
      description: role.description,
      scope: role.scope,
      color: role.color,
      isSystem: !!role.is_system,
      functions: functionCodes,
      memberScope,
      paymentScope,
      createdAt: role.created_at,
    };
  }

  /** Valida que memberIds/groupIds (scope de VIEW_MEMBERS_SCOPED o VIEW_PAYMENTS_SCOPED, misma
   * forma para ambos) pertenezcan al club del rol — mismo criterio que invitations.service.js
   * validando defaultRoleId. Reusado tal cual para los dos scopes: ambos son "miembros y/o
   * grupos", solo cambia qué tabla los persiste (ver setMemberScope/setPaymentScope). */
  async _resolveScope(clubId, scope) {
    if (!scope) return null;
    const memberIds = scope.memberIds ?? [];
    const groupIds = scope.groupIds ?? [];

    if (memberIds.length) {
      const found = await membersRepository.findByIds(memberIds, clubId);
      if (found.length !== memberIds.length) throw AppError.badRequest('Uno o más miembros del alcance no pertenecen a este club.');
    }
    if (groupIds.length) {
      const found = await memberGroupsRepository.findByIds(groupIds, clubId);
      if (found.length !== groupIds.length) throw AppError.badRequest('Uno o más grupos del alcance no pertenecen a este club.');
    }
    return { memberIds, groupIds };
  }

  /** Crea el rol por defecto (Administrador) para un club recién creado. */
  async seedDefaultRolesForClub(clubId, conn) {
    // `findClubAssignableGrouped` (no `findAllGrouped`) es la barrera real: filtra por
    // `is_club_assignable = 1` en la propia base de datos, así que aunque
    // `defaultClubRoles.js#ALL_CLUB_FUNCTIONS` quedara desactualizado (como pasaba antes de
    // este fix — su lista hardcodeada excluía solo 3 de las 10 funcionalidades de plataforma
    // reales, dejando que el "Administrador" de CUALQUIER club nuevo quedara con VIEW_ALL_USERS,
    // VIEW_PLATFORM_SETTINGS, etc., viendo/editando datos de TODA la plataforma) un código de
    // plataforma nunca resuelve a un id acá y `.filter(Boolean)` de abajo lo descarta solo.
    const allFunctions = await functionsRepository.findClubAssignableGrouped(conn);
    const functionIdByCode = new Map(allFunctions.map((f) => [f.code, f.id]));
    let adminRoleId = null;

    for (const template of DEFAULT_CLUB_ROLES) {
      // eslint-disable-next-line no-await-in-loop
      const roleId = await rolesRepository.createRole(
        {
          clubId,
          name: template.name,
          description: template.description,
          scope: ROLE_SCOPE.CLUB,
          color: template.color,
          isSystem: template.isSystem,
        },
        conn
      );
      const functionIds = template.functionCodes.map((code) => functionIdByCode.get(code)).filter(Boolean);
      // eslint-disable-next-line no-await-in-loop
      await rolesRepository.setFunctions(roleId, functionIds, conn);
      if (template.name === 'Administrador') adminRoleId = roleId;
    }

    return adminRoleId;
  }

  async listForClub(clubId) {
    const roles = await rolesRepository.findClubRoles(clubId);
    return Promise.all(
      roles.map(async (r) =>
        this.toDto(
          r,
          await rolesRepository.getFunctionCodes(r.id),
          await rolesRepository.getMemberScope(r.id),
          await rolesRepository.getPaymentScope(r.id)
        )
      )
    );
  }

  async listGlobalRoles() {
    const roles = await rolesRepository.findGlobalRoles();
    return Promise.all(roles.map(async (r) => this.toDto(r, await rolesRepository.getFunctionCodes(r.id))));
  }

  async getById(roleId, clubId) {
    const role = await rolesRepository.findById(roleId);
    if (!role || role.club_id !== clubId) throw AppError.notFound('Rol no encontrado.');
    const [functionCodes, memberScope, paymentScope] = await Promise.all([
      rolesRepository.getFunctionCodes(roleId),
      rolesRepository.getMemberScope(roleId),
      rolesRepository.getPaymentScope(roleId),
    ]);
    return this.toDto(role, functionCodes, memberScope, paymentScope);
  }

  async create(clubId, { name, description, color, functionCodes, memberScope, paymentScope }, actorId) {
    const existing = await rolesRepository.findByNameInScope(name, clubId);
    if (existing) throw AppError.conflict('Ya existe un rol con este nombre en el club.');

    const validFunctions = await this._resolveFunctionIds(functionCodes);
    const resolvedMemberScope = await this._resolveScope(clubId, memberScope);
    const resolvedPaymentScope = await this._resolveScope(clubId, paymentScope);

    const roleId = await withTransaction(async (conn) => {
      const id = await rolesRepository.createRole(
        { clubId, name, description: description || null, scope: ROLE_SCOPE.CLUB, color: color || '#6366F1', isSystem: false },
        conn
      );
      await rolesRepository.setFunctions(id, validFunctions.ids, conn);
      if (resolvedMemberScope) await rolesRepository.setMemberScope(id, resolvedMemberScope.memberIds, resolvedMemberScope.groupIds, conn);
      if (resolvedPaymentScope) await rolesRepository.setPaymentScope(id, resolvedPaymentScope.memberIds, resolvedPaymentScope.groupIds, conn);
      return id;
    });

    await auditRepository.logAction({ userId: actorId, clubId, action: 'ROLE_CREATED', entityType: 'role', entityId: roleId, changes: { name, functionCodes } });

    return this.getById(roleId, clubId);
  }

  async update(roleId, clubId, { name, description, color, functionCodes, memberScope, paymentScope }, actorId) {
    const role = await rolesRepository.findById(roleId);
    if (!role || role.club_id !== clubId) throw AppError.notFound('Rol no encontrado.');

    if (name && name !== role.name) {
      const existing = await rolesRepository.findByNameInScope(name, clubId);
      if (existing && existing.id !== roleId) throw AppError.conflict('Ya existe un rol con este nombre en el club.');
    }

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (color !== undefined) updates.color = color;

    // Se pide ANTES de aplicar los cambios: es la única forma de poder mostrar después
    // "de X a Y" en el detalle de auditoría en vez de solo el valor final.
    const previousFunctionCodes = functionCodes !== undefined ? await rolesRepository.getFunctionCodes(roleId) : undefined;
    const previousMemberScope = memberScope !== undefined ? await rolesRepository.getMemberScope(roleId) : undefined;
    const previousPaymentScope = paymentScope !== undefined ? await rolesRepository.getPaymentScope(roleId) : undefined;
    const resolvedMemberScope = memberScope !== undefined ? await this._resolveScope(clubId, memberScope) : undefined;
    const resolvedPaymentScope = paymentScope !== undefined ? await this._resolveScope(clubId, paymentScope) : undefined;

    await withTransaction(async (conn) => {
      if (Object.keys(updates).length) await rolesRepository.updateById(roleId, updates, conn);
      if (functionCodes !== undefined) {
        const { ids } = await this._resolveFunctionIds(functionCodes);
        await rolesRepository.setFunctions(roleId, ids, conn);
      }
      if (resolvedMemberScope !== undefined) {
        await rolesRepository.setMemberScope(roleId, resolvedMemberScope.memberIds, resolvedMemberScope.groupIds, conn);
      }
      if (resolvedPaymentScope !== undefined) {
        await rolesRepository.setPaymentScope(roleId, resolvedPaymentScope.memberIds, resolvedPaymentScope.groupIds, conn);
      }
    });

    const changes = buildDiff({
      name: name !== undefined ? diffValue(role.name, name) : undefined,
      description: description !== undefined ? diffValue(role.description, description) : undefined,
      color: color !== undefined ? diffValue(role.color, color) : undefined,
      functionCodes: functionCodes !== undefined ? diffArray(previousFunctionCodes, functionCodes) : undefined,
      memberScopeIds: resolvedMemberScope !== undefined ? diffArray(previousMemberScope.memberIds, resolvedMemberScope.memberIds) : undefined,
      memberScopeGroupIds: resolvedMemberScope !== undefined ? diffArray(previousMemberScope.groupIds, resolvedMemberScope.groupIds) : undefined,
      paymentScopeIds: resolvedPaymentScope !== undefined ? diffArray(previousPaymentScope.memberIds, resolvedPaymentScope.memberIds) : undefined,
      paymentScopeGroupIds: resolvedPaymentScope !== undefined ? diffArray(previousPaymentScope.groupIds, resolvedPaymentScope.groupIds) : undefined,
    });
    if (changes) {
      await auditRepository.logAction({ userId: actorId, clubId, action: 'ROLE_UPDATED', entityType: 'role', entityId: roleId, changes });
    }

    return this.getById(roleId, clubId);
  }

  async remove(roleId, clubId, actorId) {
    const role = await rolesRepository.findById(roleId);
    if (!role || role.club_id !== clubId) throw AppError.notFound('Rol no encontrado.');
    if (role.is_system) throw AppError.forbidden('Este rol es un rol de sistema y no puede eliminarse.');

    const usersCount = await rolesRepository.countUsersWithRole(roleId);
    if (usersCount > 0) {
      throw AppError.conflict(`No se puede eliminar: ${usersCount} usuario(s) tienen este rol asignado.`);
    }

    await rolesRepository.deleteRole(roleId);
    // El rol ya no existe para cuando alguien lea este log, así que la auditoría no puede
    // resolver su nombre por id (ver audit.repository.js#_withEntityNames) — se guarda acá
    // como respaldo, dentro de cambios que igual ya se registraban.
    await auditRepository.logAction({ userId: actorId, clubId, action: 'ROLE_DELETED', entityType: 'role', entityId: roleId, changes: { name: role.name } });
  }

  async duplicate(roleId, clubId, actorId) {
    const original = await rolesRepository.findById(roleId);
    if (!original || original.club_id !== clubId) throw AppError.notFound('Rol no encontrado.');

    const [functionCodes, memberScope, paymentScope] = await Promise.all([
      rolesRepository.getFunctionCodes(roleId),
      rolesRepository.getMemberScope(roleId),
      rolesRepository.getPaymentScope(roleId),
    ]);
    let newName = `${original.name} (copia)`;
    let suffix = 2;
    // eslint-disable-next-line no-await-in-loop
    while (await rolesRepository.findByNameInScope(newName, clubId)) {
      newName = `${original.name} (copia ${suffix})`;
      suffix += 1;
    }

    return this.create(
      clubId,
      { name: newName, description: original.description, color: original.color, functionCodes, memberScope, paymentScope },
      actorId
    );
  }

  /**
   * Resuelve codes -> ids para asignarlos a un rol de CLUB (este service solo crea/edita
   * roles con scope 'club'; los roles globales se siembran aparte). Usa `findAllGrouped`
   * (sin filtrar por categoría) para poder dar un mensaje de error específico, pero igual
   * rechaza cualquier funcionalidad no marcada `is_club_assignable` — un club nunca debe
   * poder asignarse a sí mismo una funcionalidad de plataforma, ni siquiera pegándole
   * directo a la API.
   */
  async _resolveFunctionIds(functionCodes = []) {
    const allFunctions = await functionsRepository.findAllGrouped();
    const map = new Map(allFunctions.map((f) => [f.code, f]));
    const invalid = functionCodes.filter((code) => !map.has(code));
    if (invalid.length) throw AppError.badRequest(`Funcionalidades inválidas: ${invalid.join(', ')}`);

    const notClubAssignable = functionCodes.filter((code) => !map.get(code).is_club_assignable);
    if (notClubAssignable.length) {
      throw AppError.badRequest(`Funcionalidades no disponibles para roles de club: ${notClubAssignable.join(', ')}`);
    }

    return { ids: functionCodes.map((code) => map.get(code).id) };
  }
}

module.exports = new RolesService();
