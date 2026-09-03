/**
 * Constantes globales del dominio. Evita "magic strings" repartidos por el código.
 */
module.exports = {
  GLOBAL_ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN',
    DEVELOPER: 'DEVELOPER',
    SUPPORT: 'SUPPORT',
  },

  USER_STATUS: {
    ACTIVE: 'active',
    SUSPENDED: 'suspended',
    PENDING: 'pending',
    BLOCKED: 'blocked',
  },

  CLUB_STATUS: {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    SUSPENDED: 'suspended',
  },

  USER_CLUB_STATUS: {
    ACTIVE: 'active',
    SUSPENDED: 'suspended',
    PENDING: 'pending',
  },

  INVITATION_STATUS: {
    ACTIVE: 'active',
    REVOKED: 'revoked',
    EXPIRED: 'expired',
    EXHAUSTED: 'exhausted',
  },

  JOIN_REQUEST_STATUS: {
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
  },

  ROLE_SCOPE: {
    GLOBAL: 'global',
    CLUB: 'club',
  },

  NOTIFICATION_TYPE: {
    INFO: 'info',
    SUCCESS: 'success',
    WARNING: 'warning',
    ERROR: 'error',
  },

  TOKEN_TYPE: {
    VERIFY_EMAIL: 'verify_email',
    RESET_PASSWORD: 'reset_password',
  },

  FUNCTIONS: {
    // Plataforma / global
    MANAGE_PLATFORM: 'MANAGE_PLATFORM',
    VIEW_ALL_CLUBS: 'VIEW_ALL_CLUBS',
    EDIT_ALL_CLUBS: 'EDIT_ALL_CLUBS',
    VIEW_ALL_FUNCTIONS: 'VIEW_ALL_FUNCTIONS',
    VIEW_PLATFORM_SETTINGS: 'VIEW_PLATFORM_SETTINGS',
    EDIT_PLATFORM_SETTINGS: 'EDIT_PLATFORM_SETTINGS',

    // Usuarios
    VIEW_USERS: 'VIEW_USERS',
    CREATE_USERS: 'CREATE_USERS',
    EDIT_USERS: 'EDIT_USERS',
    DELETE_USERS: 'DELETE_USERS',
    SUSPEND_USERS: 'SUSPEND_USERS',
    ASSIGN_USER_ROLES: 'ASSIGN_USER_ROLES',

    // Roles
    VIEW_ROLES: 'VIEW_ROLES',
    CREATE_ROLE: 'CREATE_ROLE',
    EDIT_ROLE: 'EDIT_ROLE',
    DELETE_ROLE: 'DELETE_ROLE',

    // Funcionalidades
    VIEW_FUNCTIONS: 'VIEW_FUNCTIONS',

    // Club
    VIEW_CLUB: 'VIEW_CLUB',
    EDIT_CLUB: 'EDIT_CLUB',
    MANAGE_SETTINGS: 'MANAGE_SETTINGS',
    DELETE_CLUB: 'DELETE_CLUB',

    // Invitaciones
    VIEW_INVITATIONS: 'VIEW_INVITATIONS',
    CREATE_INVITATIONS: 'CREATE_INVITATIONS',
    REVOKE_INVITATIONS: 'REVOKE_INVITATIONS',
    MANAGE_JOIN_REQUESTS: 'MANAGE_JOIN_REQUESTS',

    // Dashboard / auditoría
    VIEW_DASHBOARD: 'VIEW_DASHBOARD',
    VIEW_AUDIT_LOGS: 'VIEW_AUDIT_LOGS',

    // Notificaciones
    VIEW_NOTIFICATIONS: 'VIEW_NOTIFICATIONS',
    MANAGE_NOTIFICATIONS: 'MANAGE_NOTIFICATIONS',
  },

  PAGINATION: {
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 20,
    MAX_LIMIT: 100,
  },
};
