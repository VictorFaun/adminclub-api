const { FUNCTIONS } = require('./constants');

/**
 * Plantilla de roles que se crean automáticamente al registrar un club nuevo.
 * "Administrador" es un rol de sistema (is_system) y no puede eliminarse,
 * ya que todo club necesita al menos un administrador. Es el único rol por
 * defecto: el resto de los roles del club los define el propio administrador
 * según lo que necesite (ver role-form.page.ts / POST /clubs/:clubId/roles).
 */
const ALL_CLUB_FUNCTIONS = Object.values(FUNCTIONS).filter(
  (code) => !['MANAGE_PLATFORM', 'VIEW_ALL_CLUBS', 'EDIT_ALL_CLUBS'].includes(code)
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
