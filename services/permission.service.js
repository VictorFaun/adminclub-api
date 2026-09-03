const functionsRepository = require('../repositories/functions.repository');
const usersRepository = require('../repositories/users.repository');
const rolesRepository = require('../repositories/roles.repository');
const { GLOBAL_ROLES } = require('../config/constants');

/**
 * Servicio único responsable de resolver qué puede hacer un usuario.
 * Es la única fuente de verdad de permisos en todo el backend: nada se
 * calcula ni se confía desde el frontend.
 */
class PermissionService {
  async getGlobalRoleCodes(userId) {
    return usersRepository.findGlobalRoleCodes(userId);
  }

  isSuperAdmin(globalRoleCodes) {
    return globalRoleCodes.includes(GLOBAL_ROLES.SUPER_ADMIN);
  }

  /** Codes de funcionalidades habilitadas para el usuario dentro de un club (o null = sin club). */
  async getPermissionCodes(userId, clubId) {
    if (!clubId) {
      return functionsRepository.findGlobalPermissionCodes(userId);
    }
    return functionsRepository.findUserPermissionCodes(userId, clubId);
  }

  async getRolesForContext(userId, clubId) {
    const globalRoles = await rolesRepository.findRolesForUser(userId, null);
    const clubRoles = clubId ? await rolesRepository.findRolesForUser(userId, clubId) : [];
    return [...globalRoles, ...clubRoles];
  }

  /**
   * Construye el bloque {roles, functions} que el frontend usa para armar el menú dinámico.
   *
   * Ser Super Admin YA NO da acceso implícito total ("*") en cualquier club. Su poder real
   * es la UNIÓN de: (a) las funcionalidades de su rol GLOBAL (hoy, solo las de plataforma:
   * MANAGE_PLATFORM/VIEW_ALL_CLUBS — ver seed), que aplican en todo club por ser globales, y
   * (b) el rol que tenga asignado DENTRO de ese club específico, si es miembro — igual que
   * cualquier otro usuario. Administrar el contenido de un club puntual depende de tener un
   * rol propio ahí, no de ser Super Admin. `getPermissionCodes` ya arma esa unión.
   *
   * VIEW_ALL_CLUBS y EDIT_ALL_CLUBS, en cambio, SÍ se mezclan siempre con lo anterior: dan
   * acceso sobre CUALQUIER club, sea o no miembro de él, sea o no que tenga un rol propio ahí.
   * No reemplazan sus permisos reales (si tiene un rol de club que además borra algo, lo sigue
   * pudiendo hacer) — cada una garantiza un piso:
   *   - VIEW_ALL_CLUBS: piso de solo lectura (todas las `VIEW_*`).
   *   - EDIT_ALL_CLUBS: piso de administración completa (todas las funcionalidades asignables a
   *     un club, las mismas que tendría el Administrador de ESE club — ver defaultClubRoles.js).
   * Por eso un Super Admin que es miembro de un club pero sin rol asignado igual ve o edita la
   * información del club según cuál de las dos tenga.
   */
  async buildAuthorizationContext(userId, clubId) {
    const [globalRoleCodes, permissionCodes, roles] = await Promise.all([
      this.getGlobalRoleCodes(userId),
      this.getPermissionCodes(userId, clubId),
      this.getRolesForContext(userId, clubId),
    ]);

    const isSuperAdmin = this.isSuperAdmin(globalRoleCodes);
    let functions = permissionCodes;

    if (clubId) {
      const membership = await usersRepository.findMembership(userId, clubId);
      const isActiveMember = !!membership && membership.status === 'active';

      if (!isActiveMember) {
        // No es miembro activo de este club (nunca lo fue, o fue suspendido/removido): cualquier
        // rol de club que hubiera quedado colgado en user_roles no debe contar. Solo sus
        // funcionalidades genuinamente globales aplican como base.
        functions = await functionsRepository.findGlobalPermissionCodes(userId);
      }

      if (functions.includes('EDIT_ALL_CLUBS')) {
        const allFunctions = await functionsRepository.findAllGrouped();
        const clubAssignableCodes = allFunctions.filter((f) => f.is_club_assignable).map((f) => f.code);
        functions = Array.from(new Set([...functions, ...clubAssignableCodes]));
      } else if (functions.includes('VIEW_ALL_CLUBS')) {
        const allFunctions = await functionsRepository.findAllGrouped();
        const viewOnlyCodes = allFunctions.filter((f) => f.code.startsWith('VIEW_')).map((f) => f.code);
        functions = Array.from(new Set([...functions, ...viewOnlyCodes]));
      }
    }

    return {
      isSuperAdmin,
      globalRoles: globalRoleCodes,
      roles: roles.map((r) => ({ id: r.id, name: r.name, scope: r.scope, color: r.color })),
      functions,
    };
  }

  hasFunction(authorizationContext, code) {
    return authorizationContext.functions.includes(code);
  }

  hasAnyFunction(authorizationContext, codes) {
    return codes.some((code) => authorizationContext.functions.includes(code));
  }
}

module.exports = new PermissionService();
