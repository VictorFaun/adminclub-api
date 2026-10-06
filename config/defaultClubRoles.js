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

const F = FUNCTIONS;
const BASE = [F.VIEW_DASHBOARD, F.VIEW_CLUB, F.VIEW_NOTIFICATIONS];

/**
 * Roles sugeridos (no de sistema): se crean con cada club nuevo para que pueda invitar a su
 * directiva de inmediato, y se pueden agregar a un club existente desde Roles ("Agregar roles
 * sugeridos"). El club los edita o borra como cualquier otro rol.
 */
const SUGGESTED_CLUB_ROLES = [
  {
    name: 'Tesorería',
    description: 'Cobros, pagos, gastos, cuentas y comprobantes del club.',
    color: '#16A34A',
    isSystem: false,
    functionCodes: [
      ...BASE, F.VIEW_MEMBERS, F.VIEW_MEMBERS_DASHBOARD, F.VIEW_MEMBER_GROUPS,
      F.VIEW_TREASURY_DASHBOARD, F.VIEW_CHARGES, F.CREATE_CHARGES, F.EDIT_CHARGES, F.DELETE_CHARGES,
      F.VIEW_PAYMENTS, F.CREATE_PAYMENTS, F.EDIT_PAYMENTS, F.DELETE_PAYMENTS, F.EXEMPT_PAYMENTS,
      F.VIEW_TREASURY_SETTINGS, F.EDIT_TREASURY_SETTINGS, F.VIEW_EXPENSES, F.CREATE_EXPENSES, F.EDIT_EXPENSES, F.DELETE_EXPENSES,
    ],
  },
  {
    name: 'Secretaría',
    description: 'Fichas de miembros, grupos, inscripciones, entrenamientos y asistencia.',
    color: '#2563EB',
    isSystem: false,
    functionCodes: [
      ...BASE, F.VIEW_MEMBERS, F.VIEW_MEMBERS_DASHBOARD, F.CREATE_MEMBERS, F.EDIT_MEMBERS, F.DELETE_MEMBERS, F.LINK_MEMBER_USER,
      F.VIEW_MEMBER_GROUPS, F.MANAGE_MEMBER_GROUPS, F.VIEW_MEMBER_FIELDS, F.CREATE_MEMBER_FIELDS, F.EDIT_MEMBER_FIELDS, F.DELETE_MEMBER_FIELDS,
      F.VIEW_SENSITIVE_MEMBER_FIELDS, F.MANAGE_BIRTHDAY_TEMPLATE, F.VIEW_INVITATIONS, F.CREATE_INVITATIONS,
      F.VIEW_TRAININGS, F.CREATE_TRAININGS, F.EDIT_TRAININGS, F.VIEW_ATTENDANCE, F.MARK_ATTENDANCE, F.VIEW_TRAINING_SETTINGS, F.EDIT_TRAINING_SETTINGS,
    ],
  },
  {
    name: 'Entrenador',
    description: 'Ve las fichas (incluida la información de salud) y pasa la asistencia de los entrenamientos.',
    color: '#F59E0B',
    isSystem: false,
    functionCodes: [F.VIEW_DASHBOARD, F.VIEW_NOTIFICATIONS, F.VIEW_MEMBERS, F.VIEW_MEMBER_GROUPS, F.VIEW_SENSITIVE_MEMBER_FIELDS, F.VIEW_TRAININGS, F.VIEW_ATTENDANCE, F.MARK_ATTENDANCE],
  },
  {
    name: 'Directiva (solo lectura)',
    description: 'Consulta todo el club sin poder modificar nada.',
    color: '#9333EA',
    isSystem: false,
    functionCodes: [
      ...BASE, F.VIEW_MEMBERS, F.VIEW_MEMBERS_DASHBOARD, F.VIEW_MEMBER_GROUPS, F.VIEW_TREASURY_DASHBOARD, F.VIEW_CHARGES,
      F.VIEW_PAYMENTS, F.VIEW_EXPENSES, F.VIEW_TRAININGS, F.VIEW_ATTENDANCE, F.VIEW_AUDIT_LOGS,
    ],
  },
];

module.exports = [
  {
    name: 'Administrador',
    description: 'Control total sobre la administración del club',
    color: '#DC2626',
    isSystem: true,
    functionCodes: ALL_CLUB_FUNCTIONS,
  },
  ...SUGGESTED_CLUB_ROLES,
];
module.exports.SUGGESTED_CLUB_ROLES = SUGGESTED_CLUB_ROLES;
