-- ============================================================================
-- Seed: catálogo de funcionalidades + roles globales de plataforma
-- Idempotente (usa INSERT ... ON DUPLICATE KEY UPDATE / INSERT IGNORE).
-- ============================================================================
USE `admin_club`;

-- ----------------------------------------------------------------------------
-- functions: catálogo global de funcionalidades del sistema
-- ----------------------------------------------------------------------------
INSERT INTO `functions` (`code`, `name`, `description`, `category`) VALUES
  ('MANAGE_PLATFORM',    'Administrar plataforma',        'Acceso total a la administración de la plataforma', 'plataforma'),
  ('VIEW_ALL_CLUBS',     'Ver todos los clubes',           'Ver todos los clubes existentes en la plataforma',   'plataforma'),
  ('EDIT_ALL_CLUBS',     'Editar todos los clubes',        'Editar la información y configuración de cualquier club de la plataforma, sea o no miembro de él', 'plataforma'),

  ('VIEW_USERS',         'Ver usuarios',                   'Listar y ver el detalle de usuarios',                'usuarios'),
  ('CREATE_USERS',       'Crear usuarios',                 'Crear nuevos usuarios',                              'usuarios'),
  ('EDIT_USERS',         'Editar usuarios',                'Editar datos de usuarios',                           'usuarios'),
  ('DELETE_USERS',       'Eliminar usuarios',              'Elimina al usuario de este club', 'usuarios'),
  ('SUSPEND_USERS',      'Suspender usuarios',             'Suspender o reactivar usuarios',                     'usuarios'),
  ('ASSIGN_USER_ROLES',  'Asignar roles a usuarios',        'Asignar o quitar roles a usuarios',                  'usuarios'),

  ('VIEW_ROLES',         'Ver roles',                      'Listar y ver el detalle de roles',                   'roles'),
  ('CREATE_ROLE',        'Crear roles',                    'Crear nuevos roles',                                 'roles'),
  ('EDIT_ROLE',          'Editar roles',                   'Editar roles existentes y sus funcionalidades',      'roles'),
  ('DELETE_ROLE',        'Eliminar roles',                 'Eliminar roles',                                     'roles'),

  ('VIEW_FUNCTIONS',     'Ver funcionalidades',            'Listar el catálogo de funcionalidades del sistema',  'funcionalidades'),

  ('VIEW_CLUB',          'Ver club',                       'Ver la información del club',                        'club'),
  ('EDIT_CLUB',          'Editar club',                    'Editar nombre, logo, banner, colores y tema',        'club'),
  ('MANAGE_SETTINGS',    'Administrar configuración',      'Editar la configuración general del club',           'club'),
  ('DELETE_CLUB',        'Eliminar club',                  'Eliminar el club',                                   'club'),

  ('VIEW_INVITATIONS',   'Ver invitaciones',               'Listar invitaciones del club',                       'invitaciones'),
  ('CREATE_INVITATIONS', 'Crear invitaciones',             'Crear nuevas invitaciones',                          'invitaciones'),
  ('REVOKE_INVITATIONS', 'Revocar invitaciones',           'Revocar invitaciones activas',                       'invitaciones'),
  ('MANAGE_JOIN_REQUESTS','Gestionar solicitudes de acceso','Aprobar o rechazar solicitudes de acceso al club',  'usuarios'),

  ('VIEW_DASHBOARD',     'Ver dashboard',                  'Acceder al dashboard administrativo',                'dashboard'),
  ('VIEW_AUDIT_LOGS',    'Ver auditoría',                  'Ver el registro de auditoría del club',              'auditoria'),

  ('VIEW_NOTIFICATIONS', 'Ver notificaciones',             'Ver notificaciones propias',                         'notificaciones'),
  ('MANAGE_NOTIFICATIONS','Enviar notificaciones',         'Enviar notificaciones a miembros del club',          'notificaciones')
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `description` = VALUES(`description`), `category` = VALUES(`category`);

-- ----------------------------------------------------------------------------
-- roles globales de plataforma (club_id IS NULL, scope = 'global')
-- ----------------------------------------------------------------------------
INSERT INTO `roles` (`uuid`, `club_id`, `name`, `description`, `scope`, `color`, `is_system`)
SELECT UUID(), NULL, 'SUPER_ADMIN', 'Control total de la plataforma y de todos los clubes', 'global', '#DC2626', 1
WHERE NOT EXISTS (SELECT 1 FROM `roles` WHERE `club_id` IS NULL AND `name` = 'SUPER_ADMIN');

INSERT INTO `roles` (`uuid`, `club_id`, `name`, `description`, `scope`, `color`, `is_system`)
SELECT UUID(), NULL, 'DEVELOPER', 'Acceso técnico completo para soporte y mantenimiento', 'global', '#7C3AED', 1
WHERE NOT EXISTS (SELECT 1 FROM `roles` WHERE `club_id` IS NULL AND `name` = 'DEVELOPER');

INSERT INTO `roles` (`uuid`, `club_id`, `name`, `description`, `scope`, `color`, `is_system`)
SELECT UUID(), NULL, 'SUPPORT', 'Acceso de solo lectura para soporte a clubes', 'global', '#0891B2', 1
WHERE NOT EXISTS (SELECT 1 FROM `roles` WHERE `club_id` IS NULL AND `name` = 'SUPPORT');

-- DEVELOPER: todas las funcionalidades (soporte técnico con acceso total).
INSERT IGNORE INTO `role_functions` (`role_id`, `function_id`)
SELECT r.id, f.id FROM `roles` r CROSS JOIN `functions` f
WHERE r.club_id IS NULL AND r.name = 'DEVELOPER';

-- SUPER_ADMIN: SOLO las funcionalidades de plataforma. Administrar el contenido de un
-- club puntual (usuarios, roles, config, etc.) depende de tener un rol propio asignado
-- en ESE club, igual que cualquier otro usuario — EXCEPTO que tenga EDIT_ALL_CLUBS, que
-- le da edición total sobre cualquier club sin necesidad de rol propio ahí — ver
-- permission.service.js.
INSERT IGNORE INTO `role_functions` (`role_id`, `function_id`)
SELECT r.id, f.id FROM `roles` r CROSS JOIN `functions` f
WHERE r.club_id IS NULL AND r.name = 'SUPER_ADMIN' AND f.code IN ('MANAGE_PLATFORM', 'VIEW_ALL_CLUBS', 'EDIT_ALL_CLUBS');

-- SUPPORT: solo funcionalidades de lectura
INSERT IGNORE INTO `role_functions` (`role_id`, `function_id`)
SELECT r.id, f.id FROM `roles` r CROSS JOIN `functions` f
WHERE r.club_id IS NULL AND r.name = 'SUPPORT'
  AND f.code IN ('VIEW_ALL_CLUBS','VIEW_USERS','VIEW_ROLES','VIEW_FUNCTIONS','VIEW_CLUB','VIEW_INVITATIONS','VIEW_DASHBOARD','VIEW_AUDIT_LOGS','VIEW_NOTIFICATIONS');
