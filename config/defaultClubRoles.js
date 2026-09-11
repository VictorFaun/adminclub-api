const { FUNCTIONS } = require('./constants');

/**
 * Plantilla de roles que se crean automáticamente al registrar un club nuevo.
 * "Administrador" es un rol de sistema (is_system) y no puede eliminarse,
 * ya que todo club necesita al menos un administrador. Es el único rol por
 * defecto: el resto de los roles del club los define el propio administrador
 * según lo que necesite (ver role-form.page.ts / POST /clubs/:clubId/roles).
 *
 * Esta lista es solo DOCUMENTACIÓN/fallback — la barrera real contra incluir una funcionalidad
 * de plataforma acá es `functionsRepository.findClubAssignableGrouped` (filtra por
 * `is_club_assignable = 1` en la base de datos), usado por
 * `roles.service.js#seedDefaultRolesForClub`. Aun así, se mantiene sincronizada a mano con las
 * 10 funcionalidades `is_club_assignable = 0` (ver `sql/002_seed_functions_and_roles.sql` y
 * migraciones posteriores) para que esta constante siga siendo una fuente de verdad legible sin
 * tener que consultar la base de datos.
 */
const ALL_CLUB_FUNCTIONS = Object.values(FUNCTIONS).filter(
  (code) =>
    ![
      'MANAGE_PLATFORM',
      'VIEW_ALL_CLUBS',
      'EDIT_ALL_CLUBS',
      'VIEW_ALL_FUNCTIONS',
      'VIEW_PLATFORM_SETTINGS',
      'EDIT_PLATFORM_SETTINGS',
      'VIEW_ALL_USERS',
      'EDIT_ALL_USERS',
      'SUSPEND_ALL_USERS',
      'DELETE_ALL_USERS',
    ].includes(code)
);

module.exports = [
  {
    name: 'Administrador',
    description: 'Control total sobre la administración del club',
    color: '#DC2626',
    isSystem: true,
    functionCodes: ALL_CLUB_FUNCTIONS,
  },
];
